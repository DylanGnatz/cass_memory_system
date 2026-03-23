# Codebase Reference

Living document of everything we know about the codebase. **Read this before modifying any file.** Update when you discover new facts.

Last updated: 2026-03-23 (post-Phase 1)

---

## cm.ts — CLI Entry Point (1,088 lines)

### Structure
- **Lines 1–27:** Imports from command modules + utilities
- **Lines 31–38:** Global signal handlers (SIGINT/SIGTERM graceful exit)
- **Line 40–860:** `createProgram()` — builds Commander.js program with all commands
- **Line 865:** `applyGlobalEnvFromArgv()` — environment variable setup from CLI args
- **Lines 924–955:** Help text formatters (`formatMainHelpBanner()`, `formatMainHelpEpilog()`, `formatCommandExamples()`)
- **Line 966:** `inferCommandFromArgv()` — command inference from argv
- **Line 982:** `handleCliError()` — error handling dispatcher (JSON vs human)
- **Line 1059:** Main entry point — handles `--info`/`--examples` flags, creates program, parses async

### Commands (24 active after Phase 1 removals)
All follow the pattern:
```typescript
program.command("<name>")
  .description("...")
  .option(...)
  .action(async (opts: any) => await <commandFunction>(opts))
```

### Removed in Phase 1
`starters`, `quickstart`, `guard`, `trauma` (parent + 5 subcommands), `--trauma` option on audit, `--starter` option on init.

---

## types.ts — All Zod Schemas (1,074 lines)

### Core Enums (lines 7–53)
- `HarmfulReasonEnum`, `SessionStatusEnum` ("success" | "failure" | "mixed")
- `BulletScopeEnum` ("global" | "workspace" | "language" | "framework" | "task")
- `BulletTypeEnum`, `BulletKindEnum`, `BulletSourceEnum`, `BulletStateEnum`
- `BulletMaturityEnum` ("candidate" | "established" | "proven" | "deprecated")
- `LLMProviderEnum` ("openai" | "anthropic" | "google" | "ollama")

### Key CASS Schemas
- **PlaybookBulletSchema (~line 65):** 30+ fields — id, scope, category, content, source, type, kind, state, maturity, helpfulCount, harmfulCount, feedbackEvents, embedding, effectiveScore, etc.
- **FeedbackEventSchema (~line 51):** type (helpful/harmful), timestamp, sessionPath, reason, context, decayedValue
- **PlaybookDeltaSchema (~line 159):** Discriminated union — Add, Helpful, Harmful, Replace, Deprecate, Merge
- **DiaryEntrySchema (~line 266):** id, sessionPath, timestamp, agent, workspace, status, accomplishments[], decisions[], challenges[], keyLearnings[], tags[], searchAnchors[]
- **PlaybookSchema (~line 222):** schema_version, name, description, metadata, deprecatedPatterns[], bullets[]
- **ContextResultSchema:** task, relevantBullets, antiPatterns, historySnippets, deprecatedWarnings, formattedPrompt
- **ValidationResultSchema:** delta, valid, verdict (ACCEPT/REJECT/REFINE/ACCEPT_WITH_CAUTION), confidence, evidence[]

### ConfigSchema (lines 364–429)
Key defaults (post-Phase 1):
- `provider`: "anthropic", `model`: "claude-sonnet-4-20250514"
- `cassPath`: "cass"
- `playbookPath`: "~/.memory-system/playbook.yaml"
- `diaryDir`: "~/.memory-system/diary"
- `semanticSearchEnabled`: **true** (changed from false in Phase 1)
- `budget`: dailyLimit=**0.50**, monthlyLimit=**10.00** (changed from 0.10/2.00 in Phase 1)
- New Phase 1 path fields (lines 416–422): `sessionNotesDir`, `knowledgeDir`, `digestsDir`, `notesDir`, `searchDbPath`, `stateJsonPath`, `topicsJsonPath`
- New Phase 1 tuning fields (lines 424–428): `periodicJobIntervalHours` (4), `knowledgePageBloatThreshold` (5000), `staleTopicIgnoreDays` (30), `transcriptRetentionDays` (30)

### Phase 1 Knowledge System Types (lines 906–1045)
- **`ConfidenceTierEnum`** — "verified" | "inferred" | "uncertain"
- **`TopicSourceEnum`** — "user" | "system"
- **`TopicSchema`** — slug, name, description, source, created
- **`TopicsFileSchema`** — { topics: Topic[] }
- **`SessionNoteSchema`** — id, source_session, last_offset, created, last_updated, abstract, topics_touched, processed, user_edited
- **`KnowledgePageSchema`** — topic, description, source, created, last_updated
- **`DailyDigestSchema`** — date (YYYY-MM-DD), sessions count, topics_touched
- **`UserNoteSchema`** — id, title, created, topics, ingest, starred
- **`TopicSuggestionSchema`** — slug, name, description, source (literal "system"), created, suggested_from_session
- **`KnowledgePageAppendDeltaSchema`** — type "knowledge_page_append", topic_slug, section_id, section_title, content, confidence, source_session, added_date, related_bullets
- **`DigestUpdateDeltaSchema`** — type "digest_update", date, content, sessions_covered
- **`TopicSuggestionDeltaSchema`** — type "topic_suggestion", slug, name, description, suggested_from_session
- **`KnowledgeDeltaSchema`** — discriminated union of the above 3 delta types
- **`ProcessingStateSchema`** — sessions (record of per-session state), lastReflectionRun, lastIndexUpdate

### Delta Type Design
Two discriminated unions on `type` field:
- **`PlaybookDeltaSchema`** — existing CASS deltas (add, helpful, harmful, replace, deprecate, merge)
- **`KnowledgeDeltaSchema`** — new memory system deltas (knowledge_page_append, digest_update, topic_suggestion)

### Schemas Registry (lines 1049–1074)
All schemas exported via `Schemas` const object. Phase 1 additions at lines 1064–1072.

---

## search.ts — SQLite FTS5 Search Index (346 lines) — NEW

### Purpose
SQLite-based full-text search index. **SQLite is the search index, files are the source of truth.** Uses `bun:sqlite` (built-in, zero external deps).

### Key Exports
- **`SearchIndex` class** — main search index implementation
- **`openSearchIndex(dbPath)`** — convenience factory
- **`SearchHit`** interface — { table, id, snippet, rank }
- **`SessionRow`, `KnowledgeRow`, `TranscriptChunk`, `NoteRow`, `DigestRow`** — input types

### Schema (lines 21–72)
```sql
sessions (id, date, abstract, filepath, processed, last_offset, created_at, updated_at)
session_topics (session_id, topic_slug)  -- join table
fts_knowledge (topic, section_title, content)  -- FTS5 with porter stemmer
fts_sessions (id, abstract, content)
fts_transcripts (session_id, chunk_offset, content)
fts_notes (id, title, content)
fts_digests (date, content)
meta (key, value)  -- schema version tracking
```

### SearchIndex Methods
- **Session CRUD:** `upsertSession()`, `setSessionTopics()`, `getSession()`, `getUnprocessedSessions()`
- **FTS Indexing:** `indexKnowledge()`, `indexSession()`, `indexTranscriptChunk()`, `indexNote()`, `indexDigest()`
- **Search:** `search(query, { tables?, limit? })` — cross-table FTS5 search, returns ranked `SearchHit[]`
- **Lifecycle:** `clearAllFts()`, `close()`, `raw` (database accessor)

### Implementation Notes
- WAL mode enabled for concurrent read safety with Electron app
- Porter stemming + unicode61 tokenizer for all FTS5 tables
- FTS query: each word wrapped in quotes to prevent syntax errors
- Dedup on re-index: DELETE existing then INSERT (not upsert for FTS5)

---

## cass.ts — External Binary Interface (1,175 lines)

### Decision: DO NOT TOUCH
Leave untouched. Binary is already optional — graceful degradation handles absence. Binary calls become dead code as search.ts and direct file reading come online.

### Key Exports (binary wrappers)
`cassAvailable`, `handleCassUnavailable`, `cassNeedsIndex`, `cassIndex`, `cassSearch`, `safeCassSearchWithDegraded`, `safeCassSearch`, `cassExport`, `cassExpand`, `cassStats`, `cassTimeline`, `findUnprocessedSessions`

### Non-Binary Exports (KEEP — useful for Phase 2+)
- `handleSessionExportFailure` — direct file reading fallback (.jsonl, .json, .md)
- `formatSessionEntry`, `coerceContent`, `joinMessages` — format parsing
- `parseCassJsonOutput` — robust JSON parsing with NDJSON fallback
- `CassRunner` interface — dependency injection for testability

### Modules Importing from cass.ts (12 after Phase 1 deletions)
orchestrator.ts, validate.ts, diary.ts, audit.ts, commands/context.ts, commands/serve.ts, commands/doctor.ts, commands/audit.ts, commands/onboard.ts, commands/privacy.ts, commands/validate.ts, commands/init.ts

---

## config.ts — Configuration (305 lines)

### Exports
- `getDefaultConfig()` (line 16) — parses {} through ConfigSchema → fully populated Config
- `getSanitizeConfig(config?)` (line 39) — sanitization config with defaults
- `loadConfig(cliOverrides?)` (line 160) — main loader with full precedence chain
- `saveConfig(config)` (line 302) — atomic write to `~/.memory-system/config.json`
- `DEFAULT_CONFIG` (line 37) — deprecated constant, same as `getDefaultConfig()`

### Config Loading Precedence
```
defaults (ConfigSchema) → globalConfig (~/.memory-system/config.json)
→ envOverrides (CASS_PATH, OLLAMA_BASE_URL, *_BASE_URL)
→ repoConfig (.cass/config.json|yaml|yml) with security filters
→ cliOverrides (CLI flags)
```

### Repo Config Security Filters
Repo configs CANNOT override: `cassPath`, `playbookPath`, `diaryDir`, `crossAgent`, `remoteCass`, `apiKey`, `budget`, `sanitization`. Can only add `sanitization.extraPatterns`.

### LLM Config Migration (line 68)
Deprecated `{ llm: { provider, model } }` → canonical `{ provider, model }` at top level. Warns once per process.

---

## utils.ts — Core Utilities (3,423 lines)

### Path Functions
- **`resolveGlobalDir()` (line 1070):** Returns `expandPath("~/.memory-system")`
- **`resolveRepoDir()` (line 1065):** Returns `path.join(gitRoot, ".cass")`
- **`expandPath(p)` (~line 890):** Expands `~` to home dir
- **`ensureGlobalStructure()` (line 1074):** Creates `~/.memory-system/` with subdirs: `diary`, `reflections`, `embeddings`, `cost`, `session-notes`, `knowledge`, `digests`, `notes`. Creates files: `config.json`, `playbook.yaml`, `blocked.log`, `usage.jsonl`.

### File Operations
- `atomicWrite(filePath, content)` — temp file → atomic rename, mode 0o600
- `withLock(filePath, operation)` — async file locking, delegates to `lock.ts`
- `fileExists(filePath)` — async existence check with ~ expansion
- `ensureDir(dir)` — recursive mkdir with ~ expansion

### Text Processing
- `tokenize(text)` — regex tokenizer preserving technical terms
- `jaccardSimilarity(a, b)` / `jaccardSimilaritySets(a, b)` — similarity 0.0-1.0
- `extractKeywords(text)` — top 10 keywords by frequency, stop-word filtered
- `hashContent(content)` — SHA256 truncated to 16 chars
- `truncateForContext(result, options)` — truncates ContextResult with strategies

### ID Generation
- `generateBulletId()` — format: `b-{base36timestamp}-{random6chars}`
- `generateDiaryId(sessionPath, content?)` — format: `diary-{hash}`

### Other Notable Exports
- `getVersion()`, `getCliName()` — CLI metadata
- `scoreBulletRelevance()` — bullet scoring for context retrieval
- `parseInlineFeedback()`, `inlineFeedbackToDeltas()` — `[cass: helpful b-xyz]` annotation parsing
- `setupGracefulShutdown()`, `isShutdownInProgress()`, `onShutdown()`, `getAbortSignal()` — shutdown management
- `normalizeYamlKeys()`, `snakeToCamel()`, `camelToSnakeKeys()` — case conversion
- `log()`, `error()`, `warn()`, `isJsonOutput()`, `printJson()` — output utilities

---

## orchestrator.ts — Pipeline Coordination (454 lines)

### Exports
- `orchestrateReflection(config, options): Promise<ReflectionOutcome>` — lines 79–454
- `ReflectionOptions` interface — days, maxSessions, agent, workspace, session, dryRun, onProgress, io
- `ReflectionOutcome` interface — sessionsProcessed, deltasGenerated, globalResult, repoResult, errors, autoOutcome

### Imports (12 local modules — central hub)
types, playbook, tracking, cass, diary, reflect, validate, llm (type), curate, utils, lock, outcome

### Pipeline Flow
1. Setup — resolve paths, ensure reflections dir
2. Lock — acquire workspace serialization lock via `withLock()`
3. Playbook snapshot — `loadMergedPlaybook(config)` for LLM context
4. Discovery — `findUnprocessedSessions()` or use specific session
5. Reflection loop (per session): generateDiary → cassExport → reflectOnSession → validateDelta → auto-outcome
6. Dry-run check — return early if dryRun
7. Delta preprocessing — decompose "merge" deltas into add/deprecate pairs
8. Delta routing — partition into global vs repo deltas
9. Merge with locking — reload playbooks under lock, `curatePlaybook()`, save
10. Processed log + auto-outcome recording

### Only One Consumer
`src/commands/reflect.ts` is the only file that imports from orchestrator.ts.

---

## Modules Kept As-Is (no Phase 1 changes)

| File | ~Lines | Purpose |
|------|--------|---------|
| `src/scoring.ts` | 230 | Confidence decay, maturity progression |
| `src/sanitize.ts` | 244 | PII/secret removal before LLM calls |
| `src/lock.ts` | 273 | File-level locking for concurrent write safety |
| `src/output.ts` | 224 | Terminal output formatting |
| `src/progress.ts` | 268 | Progress reporting for periodic job |
| `src/llm.ts` | 835 | Multi-provider LLM abstraction (Vercel AI SDK) |
| `src/cost.ts` | 221 | Budget tracking with daily/monthly limits |
| `src/playbook.ts` | 702 | Playbook CRUD, YAML load/save/merge |
| `src/gap-analysis.ts` | 298 | Rule archetype categorization, coverage gaps |
| `src/rule-validation.ts` | 313 | Semantic validation, category mismatch detection |
| `src/semantic.ts` | 780 | Local embeddings (Transformers.js, all-MiniLM-L6-v2) |
| `src/cass.ts` | 1175 | External binary interface (DO NOT TOUCH) |
| `src/onboard-state.ts` | ~240 | Onboarding state (kept — commands/onboard.ts depends on it) |

## Modules to Modify in Future Phases

| File | Phase | Key Changes |
|------|-------|-------------|
| `src/reflect.ts` | 3 | Split into two LLM calls (bullets + prose) |
| `src/validate.ts` | 3 | Three-source evidence model |
| `src/curate.ts` | 3 | New KnowledgeDelta type handlers |
| `src/diary.ts` | 2 | Generate from session notes instead of raw transcripts |
| `src/orchestrator.ts` | 3 | New pipeline steps for knowledge pages |
| `src/outcome.ts` | 3 | Knowledge page section tracking |
| `src/tracking.ts` | 3 | New event types |
| `src/commands/serve.ts` | 4 | New MCP tools for knowledge queries |
| `src/commands/context.ts` | 4 | FTS + semantic ranking, topic/knowledge queries |

---

## Modules Deleted in Phase 1

`src/trauma.ts`, `src/trauma_guard_script.ts`, `src/starters.ts`, `src/commands/guard.ts`, `src/commands/starters.ts`, `src/commands/quickstart.ts`, `src/commands/trauma.ts` + 11 test files.

---

## Dependency Graph

### Key Import Chains
- **orchestrator.ts** → types, playbook, tracking, cass, diary, reflect, validate, llm, curate, utils, lock, outcome (12 modules)
- **curate.ts** → semantic, scoring, types, utils
- **validate.ts** → semantic, cass, types
- **reflect.ts** → llm, types, utils
- **llm.ts** → cost (checkBudget, recordCost)
- **config.ts** → types, utils
- **Everything** → utils, types

### Import Pattern
All internal imports use `.js` extension (ESM): `import { foo } from "./bar.js"`

---

## Test Infrastructure

- **Runner:** Bun test
- **Directory:** `test/` (~130 files post-Phase 1)
- **Setup:** `test/setup.ts`
- **Helpers:** `test/helpers/` — `temp.ts` (isolated HOME environments), `factories.ts` (test data builders), `e2e-logger.ts`, `git.ts`
- **Fixtures:** `test/fixtures/`
- **Naming:** `.e2e.test.ts` (spawn CLI), `.integration.test.ts` (multi-module), `.test.ts` (unit)
- **Baseline:** 2331 pass, 46 fail (all in serve-stats.test.ts — pre-existing), 3 skip
