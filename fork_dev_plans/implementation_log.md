# Implementation Log

Running record of what was built, what diverged from the plan, and gotchas for future sessions.

Architecture plan: [v1_prototype_architecture.md](v1_prototype_architecture.md)

---

## Current Status

**Phase:** 1 — Fork + Strip + Data Foundation (COMPLETE)
**Last updated:** 2026-03-23

---

## Log Entries

### [Phase 1, Step 1] Delete unused modules and clean up imports
**Date:** 2026-03-23
**Files deleted (source):** `src/trauma.ts`, `src/trauma_guard_script.ts`, `src/starters.ts`, `src/commands/guard.ts`, `src/commands/starters.ts`, `src/commands/quickstart.ts`, `src/commands/trauma.ts`
**Files deleted (test):** `test/trauma.test.ts`, `test/trauma-guard-script.test.ts`, `test/cli-trauma.e2e.test.ts`, `test/cli-guard.e2e.test.ts`, `test/starters.test.ts`, `test/cli-starters.e2e.test.ts`, `test/quickstart.test.ts`, `test/cli-quickstart.e2e.test.ts`, `test/onboard-state.test.ts`, `test/workflow-first-week.e2e.test.ts`
**Files modified (source):** `src/cm.ts` (removed 4 imports, 4 command registrations, flags), `src/commands/init.ts` (removed runTraumaScan, seedStarter, guard installation, 6 imports), `src/commands/audit.ts` (removed trauma scan mode), `src/commands/context.ts` (removed trauma Pain Injection), `src/commands/doctor.ts` (removed trauma system checks)
**Files modified (test):** `test/commands-basic.test.ts`, `test/cm.test.ts`, `test/cli-audit.e2e.test.ts`, `test/e2e-smoke.test.ts`, `test/cli-command-chains.e2e.test.ts`, `test/audit.test.ts`, `test/cli-init.e2e.test.ts`, `test/doctor-command.test.ts`
**Differs from plan:** Yes — `src/onboard-state.ts` was NOT deleted despite being in the original plan, because `src/commands/onboard.ts` imports 6 functions from it. `src/commands/trauma.ts` was added to the delete list (missing from original plan). `test/workflow-first-week.e2e.test.ts` was deleted because it depended entirely on the quickstart+starters flow.
**Gotchas encountered:**
- Deletion cascaded much further than expected: 5 source files had imports from deleted modules (init.ts, audit.ts, context.ts, doctor.ts, cm.ts)
- `src/commands/doctor.ts` was missed initially → caused 128 E2E test failures (import-time crash)
- `onboard-state.ts` must stay — onboard.ts depends on it heavily
- `--starter` flag in cm.ts init command was still registered after starters.ts deletion
**Open questions:** None

### [Phase 1, Step 2] Rename paths (~/.cass-memory → ~/.memory-system)
**Date:** 2026-03-23
**Files changed:** 53 files across `src/` and `test/`, plus docs and `.cass/playbook.yaml`
**Differs from plan:** No
**Gotchas encountered:**
- Bulk sed replace was safe because `.cass-memory` pattern only appears as the dotfile directory name, never as a substring of something else
- Variable names like `cassMemoryDir` were left as-is (internal identifiers, not user-facing paths)
**Open questions:** None

### [Phase 1, Step 3] Add new Zod types and update ConfigSchema
**Date:** 2026-03-23
**Files changed:** `src/types.ts`
**New types added:** `TopicSchema`, `TopicsFileSchema`, `SessionNoteSchema`, `KnowledgePageSchema`, `DailyDigestSchema`, `UserNoteSchema`, `TopicSuggestionSchema`, `KnowledgePageAppendDeltaSchema`, `DigestUpdateDeltaSchema`, `TopicSuggestionDeltaSchema`, `KnowledgeDeltaSchema` (discriminated union), `SessionProcessingStateSchema`, `ProcessingStateSchema`
**New enums:** `ConfidenceTierEnum`, `TopicSourceEnum`
**ConfigSchema additions:** `sessionNotesDir`, `knowledgeDir`, `digestsDir`, `notesDir`, `searchDbPath`, `stateJsonPath`, `topicsJsonPath`, `periodicJobIntervalHours`, `knowledgePageBloatThreshold`, `staleTopicIgnoreDays`, `transcriptRetentionDays`
**Differs from plan:** No
**Gotchas encountered:** None — existing 68 type tests all pass unchanged
**Open questions:** None

### [Phase 1, Step 4] Implement search.ts and update directory structure
**Date:** 2026-03-23
**Files created:** `src/search.ts`, `test/search.test.ts`
**Files changed:** `src/utils.ts` (added `session-notes`, `knowledge`, `digests`, `notes` to `ensureGlobalStructure()`)
**Differs from plan:** Used `bun:sqlite` (built-in) instead of `better-sqlite3` (external package). Zero-dep, FTS5 supported natively.
**Implementation details:**
- `SearchIndex` class wraps bun:sqlite with typed methods for each content type
- Schema: `sessions` table, `session_topics` join table, 5 FTS5 virtual tables (knowledge, sessions, transcripts, notes, digests), `meta` table for version tracking
- WAL mode enabled for concurrent read safety with Electron app
- Porter stemming + unicode61 tokenizer for FTS5
- `openSearchIndex()` convenience factory
- 19 unit tests covering: schema creation, session CRUD, FTS indexing for all 5 content types, cross-table search, limits, edge cases, lifecycle
**Gotchas encountered:** None
**Open questions:** None

### [Phase 1, Step 5] Fix config defaults per architecture plan
**Date:** 2026-03-23
**Files changed:** `src/types.ts`, `test/config.test.ts`, `test/cli-usage.e2e.test.ts`, `test/cli-similar.e2e.test.ts`, `test/commands-basic.test.ts`, `test/helpers/factories.ts`, `test/fixtures/config-default.json`
**Changes:**
- Budget defaults: `dailyLimit` 0.10 → 0.50, `monthlyLimit` 2.00 → 10.00 (architecture plan specifies higher limits for two-call Reflector pipeline)
- `semanticSearchEnabled` default: `false` → `true` (architecture plan specifies semantic search on by default)
- Updated all test assertions and fixtures that hardcoded old default values
**Differs from plan:** No — these were oversights in Step 3 caught during manual verification
**Gotchas encountered:**
- Budget default changes cascaded into ~20 test assertions across config.test.ts and cli-usage.e2e.test.ts (the sed replace missed `.toBe(0.10)` patterns)
- semanticSearchEnabled change broke 3 cli-similar tests and 1 commands-basic test that assumed keyword mode — fixed by explicitly setting `semanticSearchEnabled: false` in those tests (they're testing keyword-mode behavior)
**Open questions:** None

---

## Phase 1 Validation Summary

**Test results:** 2331 pass, 46 fail (all pre-existing serve-stats.test.ts), 3 skip
**Baseline before Phase 1:** 2505 pass, 46 fail
**Delta:** -174 pass (removed tests for deleted modules), +19 pass (new search tests)
**No regressions introduced.**
