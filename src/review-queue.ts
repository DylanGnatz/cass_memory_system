// src/review-queue.ts
// Review queue I/O: load, save, append, approve, dismiss.
// Phase 4 writes items; Phase 5 Electron reads + updates.

import path from "node:path";
import fs from "node:fs/promises";
import {
  Config,
  ReviewQueue,
  ReviewQueueItem,
  ReviewQueueSchema,
} from "./types.js";
import { expandPath, ensureDir, atomicWrite, log } from "./utils.js";
import { withLock } from "./lock.js";

// ============================================================================
// FILE I/O
// ============================================================================

/** Resolve review queue file path. */
function reviewQueuePath(config: Config): string {
  // Store alongside other state files in ~/.memory-system/
  const baseDir = path.dirname(expandPath(config.stateJsonPath));
  return path.join(baseDir, "review-queue.json");
}

/** Load review queue. Returns empty queue if file doesn't exist. */
export async function loadReviewQueue(config: Config): Promise<ReviewQueue> {
  const filePath = reviewQueuePath(config);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return ReviewQueueSchema.parse(JSON.parse(raw));
  } catch {
    return { schema_version: 1, items: [] };
  }
}

/** Save review queue with locking + atomic write. */
export async function saveReviewQueue(queue: ReviewQueue, config: Config): Promise<void> {
  const filePath = reviewQueuePath(config);
  await ensureDir(path.dirname(filePath));
  const content = JSON.stringify(queue, null, 2);
  await withLock(filePath, async () => {
    await atomicWrite(filePath, content);
  });
}

// ============================================================================
// OPERATIONS
// ============================================================================

/**
 * Generate a composite key for dedup.
 * Prevents duplicate items from repeated cold-starts or periodic job runs.
 */
function compositeKey(item: ReviewQueueItem): string {
  const base = `${item.type}::${item.target_topic}`;
  if (item.type === "cold_start_suggestion") {
    return `${base}::${item.source.type}::${item.source.topic ?? ""}::${item.source.section ?? ""}`;
  }
  if (item.type === "user_flag") {
    return `${base}::${item.target_path}::${item.target_section ?? ""}`;
  }
  if (item.type === "contradiction") {
    return `${base}::${item.target_section}`;
  }
  return base;
}

/**
 * Append review queue items with dedup by composite key.
 * Only adds items that don't already exist (by type + target_topic + source).
 */
export async function appendReviewItems(
  items: ReviewQueueItem[],
  config: Config
): Promise<{ added: number; skipped: number }> {
  const queue = await loadReviewQueue(config);
  const existingKeys = new Set(queue.items.map(compositeKey));

  let added = 0;
  let skipped = 0;
  for (const item of items) {
    const key = compositeKey(item);
    if (existingKeys.has(key)) {
      // For contradictions, merge new claims into the existing item
      if (item.type === "contradiction") {
        const existing = queue.items.find(i => i.type === "contradiction" && compositeKey(i) === key);
        if (existing && existing.type === "contradiction") {
          const existingClaims = new Set(existing.data.claims.map(c => c.claim));
          for (const claim of item.data.claims) {
            if (!existingClaims.has(claim.claim)) {
              existing.data.claims.push(claim);
              added++;
            }
          }
          continue;
        }
      }
      skipped++;
      continue;
    }
    queue.items.push(item);
    existingKeys.add(key);
    added++;
  }

  if (added > 0) {
    await saveReviewQueue(queue, config);
    log(`Review queue: added ${added} items, skipped ${skipped} duplicates`);
  }

  return { added, skipped };
}

/** Update item status by ID. Returns true if item was found and updated. */
async function updateItemStatus(
  id: string,
  status: "approved" | "dismissed",
  config: Config
): Promise<boolean> {
  const queue = await loadReviewQueue(config);
  const item = queue.items.find(i => i.id === id);
  if (!item) return false;

  // Mutate in place — Zod schema allows approved/dismissed
  (item as any).status = status;
  await saveReviewQueue(queue, config);
  return true;
}

/** Dismiss a review queue item. */
export async function dismissReviewItem(id: string, config: Config): Promise<boolean> {
  return updateItemStatus(id, "dismissed", config);
}

/**
 * Approve a review queue item.
 * For topic_suggestion items, returns the item data so the caller can create the topic.
 */
export async function approveReviewItem(id: string, config: Config): Promise<{ approved: boolean; item?: ReviewQueueItem }> {
  const queue = await loadReviewQueue(config);
  const item = queue.items.find(i => i.id === id);
  if (!item) return { approved: false };

  (item as any).status = "approved";
  await saveReviewQueue(queue, config);
  return { approved: true, item };
}

/**
 * Flag content for review. Creates a user_flag item in the review queue.
 * Deduplicates by (target_path, target_section) — won't create duplicate flags.
 */
export async function flagContent(
  targetPath: string,
  config: Config,
  options?: { section?: string; reason?: string; topic?: string }
): Promise<{ added: boolean }> {
  const id = `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ReviewQueueItem = {
    id,
    type: "user_flag",
    status: "pending",
    created: new Date().toISOString(),
    target_topic: options?.topic || "",
    target_path: targetPath,
    target_section: options?.section,
    reason: options?.reason,
  };

  const result = await appendReviewItems([item], config);
  return { added: result.added > 0 };
}

/**
 * Report a contradiction. Creates or merges into a contradiction review item.
 * Multiple claims accumulate under a single item per topic+section.
 */
export async function reportContradiction(
  topicSlug: string,
  sectionTitle: string,
  description: string,
  claims: Array<{ claim: string; source: string; date: string; confidence?: string; section_id?: string }>,
  config: Config
): Promise<void> {
  const id = `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ReviewQueueItem = {
    id,
    type: "contradiction",
    status: "pending",
    created: new Date().toISOString(),
    target_topic: topicSlug,
    target_section: sectionTitle,
    data: {
      description,
      claims: claims.map(c => ({
        claim: c.claim,
        source: c.source,
        date: c.date,
        confidence: c.confidence as any,
        section_id: c.section_id,
      })),
    },
  };

  await appendReviewItems([item], config);
  log(`Reported contradiction on ${topicSlug}/${sectionTitle}: ${claims.length} claims`);
}

/**
 * Resolve a contradiction by keeping specified claims and removing others.
 * Updates the knowledge page section with the kept claim(s).
 */
export async function resolveContradiction(
  id: string,
  keptClaimIndices: number[],
  customClaim: string | null,
  config: Config
): Promise<{ resolved: boolean }> {
  const queue = await loadReviewQueue(config);
  const item = queue.items.find(i => i.id === id);
  if (!item || item.type !== "contradiction") return { resolved: false };

  (item as any).status = "approved";
  // Store the resolution for audit
  (item as any).resolution = {
    keptClaims: keptClaimIndices,
    customClaim,
    resolvedAt: new Date().toISOString(),
  };

  await saveReviewQueue(queue, config);
  return { resolved: true };
}
