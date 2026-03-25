import { describe, it, expect } from "bun:test";
import { withTempCassHome } from "./helpers/temp.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import {
  tryAcquirePeriodicJobLock,
  releasePeriodicJobLock,
  shouldRunPeriodicJob,
} from "../src/periodic-job.js";
import { loadProcessingState, saveProcessingState } from "../src/session-notes.js";

describe("Phase 4 periodic job lock", () => {
  it("acquires lock when no lock exists", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const result = await tryAcquirePeriodicJobLock(config);
      expect(result.acquired).toBe(true);
      // Cleanup
      await releasePeriodicJobLock(config);
    });
  });

  it("fails to acquire when lock is held", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const first = await tryAcquirePeriodicJobLock(config);
      expect(first.acquired).toBe(true);

      const second = await tryAcquirePeriodicJobLock(config);
      expect(second.acquired).toBe(false);
      expect(second.reason).toBeDefined();

      await releasePeriodicJobLock(config);
    });
  });

  it("detects and removes stale locks", async () => {
    await withTempCassHome(async (env) => {
      const config = await loadConfig();

      // Write a stale lock file (started 20 minutes ago)
      const stateDir = path.join(env.cassMemoryDir);
      const lockPath = path.join(stateDir, ".periodic-job.lock");
      const staleDate = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      await writeFile(lockPath, JSON.stringify({ pid: 99999, startedAt: staleDate }));

      // Should detect stale lock and acquire
      const result = await tryAcquirePeriodicJobLock(config);
      expect(result.acquired).toBe(true);

      await releasePeriodicJobLock(config);
    });
  });

  it("release removes the lock file", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      await tryAcquirePeriodicJobLock(config);
      await releasePeriodicJobLock(config);

      // Should be able to acquire again
      const result = await tryAcquirePeriodicJobLock(config);
      expect(result.acquired).toBe(true);
      await releasePeriodicJobLock(config);
    });
  });
});

describe("Phase 4 periodic job timer", () => {
  it("should run when never run before", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const should = await shouldRunPeriodicJob(config);
      expect(should).toBe(true);
    });
  });

  it("should not run when recently run", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const state = await loadProcessingState(config);
      state.lastPeriodicJobRun = new Date().toISOString();
      await saveProcessingState(state, config);

      const should = await shouldRunPeriodicJob(config);
      expect(should).toBe(false);
    });
  });

  it("should run when last run exceeds interval", async () => {
    await withTempCassHome(async () => {
      const config = await loadConfig();
      const state = await loadProcessingState(config);
      // Set last run to 25 hours ago (default interval is 24h)
      state.lastPeriodicJobRun = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await saveProcessingState(state, config);

      const should = await shouldRunPeriodicJob(config);
      expect(should).toBe(true);
    });
  });
});
