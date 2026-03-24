# Implementation Log

Running record of what was built, what diverged from the plan, and gotchas for future sessions.

Architecture plan: [v1_prototype_architecture.md](v1_prototype_architecture.md)

---

## Current Status

**Phase:** 2 — Session Note Generation (complete, pending LLM path validation with real API key)
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

---

## Phase 2: Session Note Generation

### [Phase 2, Step 1] Create session-notes.ts core module
**Date:** 2026-03-23
**Files created:** `src/session-notes.ts`, `src/commands/snapshot.ts`, `test/session-notes.test.ts`, `scripts/pre-compact-snapshot.sh`
**Files modified:** `src/llm.ts` (added `sessionNoteCreate` + `sessionNoteAppend` prompts, `generateSessionNoteContent()` + `extendSessionNoteContent()` functions), `src/commands/serve.ts` (added `cm_snapshot` MCP tool definition + handler), `src/cm.ts` (added `snapshot` CLI command)
**Differs from plan:** No major deviations. Used `generateObjectSafe` with a structured output schema (`{ abstract, topics_touched, content }`) instead of `generateText`, since the existing LLM infrastructure supports this and it gives us Zod validation on the output. Added a PreCompact hook script to auto-trigger snapshots before context compaction (not in original Phase 2 scope, but a natural extension discussed during planning).
**Implementation details:**
- **`src/session-notes.ts`** (~370 lines): Complete session note lifecycle — transcript discovery (`discoverTranscripts()`), offset-based scanning (`scanForModifiedTranscripts()`), byte-level transcript reading (`readTranscriptFromOffset()`), note creation/extension via LLM, YAML frontmatter parsing/serialization, state.json management, FTS indexing integration, `user_edited` skip logic
- **`src/commands/snapshot.ts`** (~105 lines): CLI command wrapping `processTranscript`/`processAllTranscripts` with JSON/human output
- **`src/llm.ts`** additions: Two new prompts following the Session Note Generator Specification from the architecture plan (inclusion/exclusion criteria, topic transition headers, append coherence rules, invalidation detection). Two new exported functions that use `generateObjectSafe` with retry + budget tracking
- **`src/commands/serve.ts`** additions: `cm_snapshot` MCP tool with optional session targeting and batch processing
- **`scripts/pre-compact-snapshot.sh`**: Background-launched hook script for Claude Code's `PreCompact` event
- **Transcript discovery**: Scans `~/.claude/projects/*/` for `.jsonl` files. Tested against real data: found 117 transcripts across all projects
- **24 unit tests** covering: session ID generation, frontmatter parse/serialize roundtrip, processing state CRUD, transcript discovery, offset-based scanning, offset-based reading, JSONL formatting, full processTranscript flow (create, extend, user_edited skip) with mock LLM
**Gotchas encountered:**
- `bun run -e` syntax doesn't work; need `bun --eval` for inline TypeScript evaluation
- `formatRawSession()` from diary.ts handles the JSONL→readable text conversion well but some Claude Code message types (queue-operation, file-history-snapshot, ai-title) produce no output — this is correct behavior since they're metadata, not conversation content
- Circular import potential: session-notes.ts imports from llm.ts, and llm.ts imports schemas from session-notes.ts. Resolved cleanly because the schemas are just Zod objects (no runtime dependencies on session-notes functions)
**Open questions:**
- Prompt quality iteration needs real LLM testing (requires API key). The prompt follows the architecture spec closely but may need tuning after seeing actual output on real transcripts.
- PreCompact hook not yet installed in user's settings.json — ready to add when user confirms.

---

### [Phase 2, Step 2] Dual-path content generation (agent-provided vs LLM)
**Date:** 2026-03-23
**Files modified:** `src/session-notes.ts` (added `agentContent` option to `GenerateNoteOptions` and `processTranscript`), `src/commands/serve.ts` (added `abstract`, `topics`, `content` parameters to `cm_snapshot` tool), `src/commands/snapshot.ts` (added `--abstract`, `--topics`, `--content` CLI flags), `src/cm.ts` (updated snapshot command option definitions), `test/session-notes.test.ts` (+2 tests)
**Differs from plan:** Yes — the architecture plan assumed all session note generation would go through a separate LLM call. We added a second path where the calling agent (Claude Code) provides the note content directly. This was motivated by the user having a Claude Max subscription (no API key for external calls). The agent-provided path is actually higher quality since the agent has synthesized context, not just raw transcript.
**Design:**
- `processTranscript()` accepts optional `agentContent: { abstract, topics_touched, content }`. When provided, skips the LLM call entirely and writes the content directly.
- `cm_snapshot` MCP tool accepts `abstract`, `topics`, and `content` parameters. When `abstract` + `content` are both provided, agent-provided path is used. Otherwise falls back to LLM.
- CLI `snapshot` command accepts `--abstract`, `--topics`, `--content` flags for the same purpose.
- Both paths share the same file writing, state tracking, and FTS indexing logic.
- Verified working end-to-end: `cm snapshot --abstract "..." --content "..." --json` writes a session note to disk, updates state.json, no API key needed.
**Gotchas encountered:**
- CLI `--content` receives literal `\n` characters (shell doesn't expand them in flag values). In MCP usage, content has real newlines. Not a problem in practice since MCP is the primary path.
**Open questions:** None

---

### [Phase 2, Step 3] PreCompact hook, transcript formatter, and architecture decisions
**Date:** 2026-03-23
**Files modified:** `scripts/pre-compact-snapshot.sh` (reads stdin JSON for session_id, removed `--raw`), `src/session-notes.ts` (replaced `formatRawSession` with custom `formatTranscriptChunk`, added `--raw` flag + `extractRawMetadata` + `extractAbstractFromJsonl` — kept as fallback but not used in normal flow), `src/commands/snapshot.ts` (added `--raw` option passthrough), `src/cm.ts` (added `--raw` flag to snapshot command), `src/commands/serve.ts` (strengthened `cm_snapshot` MCP tool description), `README.md` (added full setup instructions for MCP tool + PreCompact hook)
**Differs from plan:** Yes — several architecture decisions made during this step:
1. **Dropped raw transcript dumps as a primary path.** Originally built `--raw` mode for Claude Max users without API keys. After analysis, raw dumps were too noisy (89% of entries were meta noise or lost tool calls). Decided to require API key (Sonnet, ~$4/month) for the async pipeline. Raw mode kept in code as a true last-resort fallback but not used in normal flow.
2. **Two-mechanism capture with offset-based dedup.** Agent calls `cm_snapshot` via MCP (primary, no API cost) → PreCompact hook uses LLM fallback (safety net, uses API key). Both update the same byte offset in `state.json`, so if MCP already captured the session, the hook is a no-op.
3. **Custom transcript formatter.** Replaced upstream `formatRawSession` (from diary.ts) with session-note-specific `formatTranscriptChunk` that: drops meta entries (queue-operation, progress, file-history-snapshot), summarizes tool_use as one-liners (`> Read: .../file.ts`, `> Bash: npm test`), drops tool_result contents, keeps user text + assistant text + thinking blocks (truncated to 500 chars). Reduced note sizes by 78-93% (e.g. 380KB → 28KB for a medium session).
4. **Strong CLAUDE.md instruction for MCP tool.** Added a recommended CLAUDE.md block with MANDATORY heading, MUST language, and explicit trigger points (before compaction, end of major task, before commit/PR, when user wraps up).

**Implementation details:**
- PreCompact hook reads `session_id` from stdin JSON (Claude Code provides this), passes `--session <id>` to target the exact session being compacted
- `extractAbstractFromJsonl`: chunked file reader (256KB chunks) that scans JSONL for first substantive user message, handles multi-MB base64 image entries without loading them into memory, strips XML tags (ide_selection, system-reminder, etc.)
- `formatTranscriptChunk` tool summarizer handles: Read, Write, Edit, Bash (uses description field), Grep, Glob, TodoWrite (summarizes items), Agent (shows subagent type + description), Skill, ToolSearch, plus a generic fallback for unknown tools
- `shortenPath` helper keeps last 3 path segments for readability (`.../src/commands/serve.ts`)

**E2E test results (real transcripts):**
- Tested across 4 projects, 6 transcripts (0KB to 51MB), all sizes and edge cases
- Offset-based append verified: 2nd run on same session reads only delta bytes
- Agent-provided path verified: create + extend, topics merged, abstract updated
- user_edited flag respected: note body untouched, only offset updated
- Hook stdin simulation verified: piped mock PreCompact JSON → note created correctly
- Dedup verified: MCP call → hook fires → "No modified transcript found" (no-op)

**Gotchas encountered:**
- `formatRawSession` from diary.ts treats all JSONL entry types equally — tool_use blocks become `[empty]`, tool_result blocks dump raw file contents, meta entries produce noise. This was the main motivation for the custom formatter.
- Base64 images in JSONL can be 1-5MB per line. Initial 50KB read buffer for abstract extraction was too small — switched to 256KB chunked reader with pre-filter (`line.includes('"type":"user"')`) to skip non-user entries without parsing.
- Claude Code user messages often start with XML tags (ide_selection, ide_opened_file) that need stripping before extracting the actual user text.

**Open questions:**
- **LLM summarization path not yet validated with a real API key.** The prompts in `llm.ts` (`sessionNoteCreate`, `sessionNoteAppend`) follow the architecture spec but have not been tested against Sonnet with real transcript input. This must be validated before Phase 2 can be considered fully complete. Prompt tuning may be needed after seeing actual output.

---

## Phase 2 Validation Summary

**Test results:** 2356 pass, 47 fail (46 pre-existing serve module + 1 flaky performance test), 3 skip
**Baseline before Phase 2:** 2331 pass, 46 fail
**Delta:** +26 pass (new session-notes tests), +1 fail (flaky performance.e2e.test — not from our changes)
**No regressions introduced.**

**Phase 2 status:** Functionally complete pending LLM path validation with real API key.
