// src/periodic-job.ts
// Periodic job: timer, lock, full pipeline runner.
// Orchestrates the complete reflection pipeline on a schedule.

import fs from "node:fs/promises";
import path from "node:path";
import { Config, ReviewQueueItem } from "./types.js";
import { expandPath, ensureDir, log, warn } from "./utils.js";
import { loadProcessingState, saveProcessingState, processAllTranscripts } from "./session-notes.js";
import { orchestrateReflection } from "./orchestrator.js";
import { appendReviewItems } from "./review-queue.js";
import { listTopicsWithMetadata, loadTopics } from "./knowledge-page.js";

// ============================================================================
// LOCK FILE
// ============================================================================

interface LockPayload {
  pid: number;
  startedAt: string;
}

const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

function lockFilePath(config: Config): string {
  const baseDir = path.dirname(expandPath(config.stateJsonPath));
  return path.join(baseDir, ".periodic-job.lock");
}

/**
 * Try to acquire the periodic job lock.
 * Non-blocking — fails fast if lock is held by a live process.
 */
export async function tryAcquirePeriodicJobLock(
  config: Config
): Promise<{ acquired: boolean; reason?: string }> {
  const lockPath = lockFilePath(config);
  await ensureDir(path.dirname(lockPath));

  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    const payload: LockPayload = JSON.parse(raw);

    // Check staleness
    const age = Date.now() - new Date(payload.startedAt).getTime();
    if (age > STALE_THRESHOLD_MS) {
      log(`Stale lock detected (started ${Math.round(age / 60000)}m ago, pid ${payload.pid}). Removing.`);
      await fs.unlink(lockPath).catch(() => {});
      // Fall through to acquire
    } else {
      return { acquired: false, reason: `Lock held by pid ${payload.pid} (started ${Math.round(age / 1000)}s ago)` };
    }
  } catch {
    // No lock file exists — proceed to acquire
  }

  // Write lock file
  const payload: LockPayload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  try {
    await fs.writeFile(lockPath, JSON.stringify(payload), { flag: "wx" }); // wx = fail if exists
    return { acquired: true };
  } catch {
    // Race condition: another process acquired between our read and write
    return { acquired: false, reason: "Lock acquired by another process" };
  }
}

/**
 * Release the periodic job lock.
 */
export async function releasePeriodicJobLock(config: Config): Promise<void> {
  const lockPath = lockFilePath(config);
  try {
    await fs.unlink(lockPath);
  } catch {
    // Already removed or never existed
  }
}

// ============================================================================
// TIMER
// ============================================================================

/**
 * Check whether the periodic job should run based on wall-clock time.
 */
export async function shouldRunPeriodicJob(config: Config): Promise<boolean> {
  const state = await loadProcessingState(config);
  if (!state.lastPeriodicJobRun) return true;

  const lastRun = new Date(state.lastPeriodicJobRun).getTime();
  const intervalMs = (config.periodicJobIntervalHours ?? 24) * 60 * 60 * 1000;
  return Date.now() - lastRun >= intervalMs;
}

// ============================================================================
// FULL PIPELINE
// ============================================================================

export interface PeriodicJobResult {
  success: boolean;
  transcriptsProcessed: number;
  reflectionResult?: Awaited<ReturnType<typeof orchestrateReflection>>;
  cleanupItems: number;
  errors: string[];
  skippedReason?: string;
}

/**
 * Run the full periodic job pipeline:
 * 1. Acquire lock
 * 2. Preflight budget check
 * 3. Process transcripts → session notes
 * 4. Reflection pipeline (orchestrateReflection)
 * 5. Re-index (handled inside orchestrateReflection)
 * 6. Cleanup: prune stale topics, flag bloated pages → review queue
 * 7. Update lastPeriodicJobRun
 * 8. Release lock
 */
export async function runPeriodicJob(
  config: Config,
  options?: { dryRun?: boolean; verbose?: boolean }
): Promise<PeriodicJobResult> {
  const errors: string[] = [];
  let transcriptsProcessed = 0;
  let reflectionResult: PeriodicJobResult["reflectionResult"];
  let cleanupItems = 0;

  // Step 0: Acquire lock
  const lockResult = await tryAcquirePeriodicJobLock(config);
  if (!lockResult.acquired) {
    return {
      success: false,
      transcriptsProcessed: 0,
      cleanupItems: 0,
      errors: [],
      skippedReason: lockResult.reason || "Lock held",
    };
  }

  try {
    // Step 1: Budget check
    try {
      const { checkBudget } = await import("./cost.js");
      const budget = await checkBudget(config);
      if (budget.exceeded) {
        return {
          success: false,
          transcriptsProcessed: 0,
          cleanupItems: 0,
          errors: [`Budget exceeded: ${budget.message}`],
          skippedReason: "Budget exceeded",
        };
      }
    } catch {
      // Budget module may not be available — proceed
    }

    // Step 2: Process transcripts → session notes
    try {
      const result = await processAllTranscripts(config);
      transcriptsProcessed = result.processed;
      if (options?.verbose) {
        log(`Periodic job: processed ${result.processed} transcripts, ${result.skipped} skipped`);
      }
    } catch (err: any) {
      errors.push(`Transcript processing failed: ${err?.message || String(err)}`);
    }

    // Step 3: Run reflection pipeline
    if (!options?.dryRun) {
      try {
        reflectionResult = await orchestrateReflection(config, {
          dryRun: false,
          verbose: options?.verbose,
        });
        if (options?.verbose) {
          log(`Periodic job: reflection processed ${reflectionResult.sessionsProcessed} sessions`);
        }
      } catch (err: any) {
        errors.push(`Reflection failed: ${err?.message || String(err)}`);
      }
    }

    // Step 4: Cleanup — flag bloated pages + stale topics → review queue
    try {
      const reviewItems: ReviewQueueItem[] = [];
      const topicsWithMeta = await listTopicsWithMetadata(config);

      // Flag bloated pages
      const bloatThreshold = config.knowledgePageBloatThreshold ?? 5000;
      for (const t of topicsWithMeta) {
        if (t.wordCount > bloatThreshold) {
          reviewItems.push({
            id: `rq-bloat-${t.topic.slug}-${Date.now()}`,
            type: "bloated_page",
            status: "pending",
            created: new Date().toISOString(),
            target_topic: t.topic.slug,
            data: { word_count: t.wordCount, section_count: t.sectionCount },
          });
        }
      }

      // Flag stale system topics
      const staleThresholdDays = config.staleTopicIgnoreDays ?? 30;
      const now = Date.now();
      for (const t of topicsWithMeta) {
        if (t.topic.source !== "system") continue;
        const lastUpdated = t.lastUpdated ? new Date(t.lastUpdated).getTime() : new Date(t.topic.created).getTime();
        const daysSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > staleThresholdDays && t.sectionCount === 0) {
          reviewItems.push({
            id: `rq-stale-${t.topic.slug}-${Date.now()}`,
            type: "stale_topic",
            status: "pending",
            created: new Date().toISOString(),
            target_topic: t.topic.slug,
            data: { days_ignored: Math.round(daysSinceUpdate) },
          });
        }
      }

      if (reviewItems.length > 0) {
        const { added } = await appendReviewItems(reviewItems, config);
        cleanupItems = added;
      }
    } catch (err: any) {
      errors.push(`Cleanup failed: ${err?.message || String(err)}`);
    }

    // Step 5: Update lastPeriodicJobRun timestamp
    try {
      const state = await loadProcessingState(config);
      state.lastPeriodicJobRun = new Date().toISOString();
      await saveProcessingState(state, config);
    } catch (err: any) {
      errors.push(`Failed to update state: ${err?.message || String(err)}`);
    }

    return {
      success: errors.length === 0,
      transcriptsProcessed,
      reflectionResult,
      cleanupItems,
      errors,
    };
  } finally {
    // Always release lock
    await releasePeriodicJobLock(config);
  }
}

// ============================================================================
// BACKGROUND TRIGGER (MCP server start)
// ============================================================================

/**
 * Called once at MCP server start. Checks if overdue, runs in background.
 * Fire-and-forget — errors logged, never crash server.
 */
export async function maybeRunPeriodicJobBackground(config: Config): Promise<void> {
  try {
    const overdue = await shouldRunPeriodicJob(config);
    if (!overdue) {
      log("Periodic job: not overdue, skipping");
      return;
    }

    log("Periodic job: overdue, starting background run");
    // Fire and forget — don't await
    runPeriodicJob(config, { verbose: false }).then(result => {
      if (result.skippedReason) {
        log(`Periodic job skipped: ${result.skippedReason}`);
      } else if (result.success) {
        log(`Periodic job completed: ${result.transcriptsProcessed} transcripts, ${result.cleanupItems} cleanup items`);
      } else {
        warn(`Periodic job completed with errors: ${result.errors.join(", ")}`);
      }
    }).catch(err => {
      warn(`Periodic job failed: ${err?.message || String(err)}`);
    });
  } catch (err: any) {
    warn(`Periodic job check failed: ${err?.message || String(err)}`);
  }
}
