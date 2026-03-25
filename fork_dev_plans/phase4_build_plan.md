# Phase 4 Build Plan: Context Retrieval + Topic System

## Context

Phases 1-3 built the pipeline from transcripts → session notes → knowledge pages. Phase 4 closes the loop: knowledge flows back into new sessions via `cm_context`. After this phase, starting a new Claude Code session returns relevant knowledge from previous sessions.

---

## Design Decisions (Resolved)

| # | Decision | Choice |
|---|----------|--------|
| D1 | ContextResult evolution | **Extend** with optional fields (backwards-compatible) |
| D2 | `historySnippets` field | **Rename** to `searchResults` with new element type |
| D3 | memory_search → cm_search | **Add** `cm_search` as new tool, keep `memory_search` as deprecated alias |
| D4 | Topic cold-start behavior | **Write** suggestions to `review-queue.json` (persistent for Phase 5 Electron) |
| D5 | Periodic job timer location | **MCP server start** — one-time background check, fire-and-forget |
| D6 | cm reflect --full vs separate | **`--full` flag** on existing `cm reflect` |
| Q1 | similar.ts doesn't exist | Use **`semantic.ts` directly** with topic embedding caching (Option B) |
| Q2 | CLI output modes to update | **json + human** only (toon shares json path; skip markdown) |
| Q3 | Background job visibility | Include **`lastReflectionRun` timestamp** in cm_context response (Option C) |

---

## Review Queue Design (D4-C)

Cold-start suggestions are one of several things that feed the Phase 5 review queue. Design a general-purpose review queue now so Phase 5 can consume it directly.

**File:** `~/.memory-system/review-queue.json`

```json
{
  "items": [
    {
      "id": "rq-a1b2c3",
      "type": "cold_start_suggestion",
      "status": "pending",
      "created": "2026-03-24T10:00:00Z",
      "target_topic": "auth-service",
      "source": {
        "type": "knowledge_section",
        "topic": "api-gateway",
        "section": "JWT Validation",
        "snippet": "The auth service validates JWT tokens using...",
        "similarity": 0.82
      }
    },
    {
      "type": "bloated_page",
      "status": "pending",
      "target_topic": "billing-service",
      "data": { "word_count": 6200, "section_count": 14 }
    },
    {
      "type": "stale_topic",
      "status": "pending",
      "target_topic": "temp-debugging",
      "data": { "days_ignored": 45 }
    }
  ]
}
```

**Design principles:**
- **Zod schema in types.ts** — `ReviewQueueItemSchema` as discriminated union on `type`
- **Status lifecycle:** `pending` → `approved` | `dismissed` (Phase 5 Electron flips these)
- **Dedup by composite key:** `(type, target_topic, source)` prevents duplicates across periodic job runs
- **Append with `withLock()` + `atomicWrite()`** — same file safety as all other writes
- **Phase 4 writes, Phase 5 reads+updates** — clean producer/consumer boundary

**Review queue item types for Phase 4:**
| Type | Producer | When |
|------|----------|------|
| `cold_start_suggestion` | `coldStartTopic()` in Step 2 | User creates a new topic |
| `bloated_page` | Periodic job cleanup in Step 8 | Knowledge page >5000 words |
| `stale_topic` | Periodic job cleanup in Step 8 | System topic ignored >30 days |

---

## Concurrency Guard: Periodic Job Lock

Multiple triggers can fire the periodic job simultaneously (MCP background + manual button + CLI + multiple sessions). Guard with a **try-lock on a dedicated lock file**.

**File:** `~/.memory-system/.periodic-job.lock`

**Behavior:**

| Caller | Lock held? | Action |
|--------|-----------|--------|
| MCP server start (background) | Yes | Silently skip, log "already running" |
| MCP server start (background) | No | Acquire, run in background |
| Electron "Run Now" button (Phase 5) | Yes | Show "Reflection already in progress" |
| Electron "Run Now" button (Phase 5) | No | Acquire, run with progress UI |
| CLI `cm reflect --full` | Yes | Print "already in progress", exit |
| CLI `cm reflect --full` | No | Acquire, run with terminal progress |

**Crash recovery:** Lock file contains `{ pid, startedAt }`. If `startedAt` is older than 15 minutes, consider it stale from a crash — delete and proceed. 15 minutes is generous (heaviest run ~5 min for 10 sessions × 2 reflector calls).

**Implementation:** `tryAcquirePeriodicJobLock(config)` / `releasePeriodicJobLock(config)` in `periodic-job.ts`. Uses try-lock semantics (non-blocking, fails fast).

---

## Build Steps

### Step 1: Types (`src/types.ts`)

**New schemas:**
```typescript
// cm_context response extensions
TopicExcerptSchema = { topic: string, slug: string, sections: { title: string, preview: string }[] }
RecentSessionSchema = { id: string, date: string, abstract: string, note_text: string }
RelatedTopicSchema = { slug: string, name: string, description: string, similarity: number }

// Review queue
ReviewQueueItemSchema = discriminated union on "type":
  - cold_start_suggestion: { target_topic, source: { type, topic?, section?, snippet, similarity }, status, created }
  - bloated_page: { target_topic, data: { word_count, section_count }, status, created }
  - stale_topic: { target_topic, data: { days_ignored }, status, created }
ReviewQueueSchema = { schema_version: z.literal(1), items: ReviewQueueItem[] }

// Search results (replaces CassSearchHit for context)
KnowledgeSearchHitSchema = { type: string, id: string, snippet: string, score: number, title?: string }
```

**Extend existing schemas:**
- `ContextResultSchema` — add optional: `topicExcerpts`, `recentSessions`, `relatedTopics`, `suggestedDeepDives`, `lastReflectionRun`
- `ContextResultSchema` — rename `historySnippets` → `searchResults` (new element type `KnowledgeSearchHit`)
- `ProcessingStateSchema` — add `lastPeriodicJobRun?: string`

**Gotcha:** Renaming `historySnippets` → `searchResults` ripples to ~10 test files. Mechanical find/replace + adjust mock shapes.

### Step 2: Topic Management + Review Queue (`src/knowledge-page.ts`)

Extend existing knowledge-page.ts:

- **`addTopic(slug, name, description, source, config)`** — adds user or system topic
- **`removeTopic(slug, config, { force? })`** — only system topics unless force. Does NOT delete knowledge page file
- **`listTopicsWithMetadata(config)`** — topics.json + knowledge page frontmatter (section count, last_updated)
- **`coldStartTopic(slug, description, config)`** — embed description via `embedText()`, search existing knowledge + session notes by cosine similarity, return top-N matches AND write them to review-queue.json

**Review queue I/O** (also in knowledge-page.ts or a new `review-queue.ts`):
- **`loadReviewQueue(config)`** / **`saveReviewQueue(queue, config)`** — with `withLock()` + `atomicWrite()`
- **`appendReviewItems(items, config)`** — dedup by `(type, target_topic, source)` composite key
- **`dismissReviewItem(id, config)`** / **`approveReviewItem(id, config)`** — status updates

**CLI:** New `src/commands/topic.ts` with `cm topic add|list|remove`. Register in `cm.ts`.

**Reuse:** `loadTopics()`, `saveTopics()` from knowledge-page.ts. `embedText()`, `cosineSimilarity()` from semantic.ts. Topic embedding caching via semantic.ts cache infrastructure.

### Step 3: Redesign `generateContextResult()` (`src/commands/context.ts`)

Core of Phase 4. Changes:

1. **Keep** existing bullet scoring (`scoreBulletsEnhanced()`)
2. **Replace** `safeCassSearchWithDegraded()` → new `searchKnowledgeBase()` function querying SQLite FTS via `search.ts`. Remove cass.ts import. **Combined ranking** (Gap 2): normalize FTS5 rank via `1/(1+abs(rank))`, weight `0.6×FTS + 0.4×cosine`, fallback to FTS-only if semantic unavailable.
3. **Add** topic excerpt assembly: keyword + semantic match against topic names/descriptions → load matching knowledge pages → extract section title + first-line previews (~500 tokens)
4. **Add** related topics: `embedText(task)` vs cached topic description embeddings → top-5 above threshold (0.3). Uses `semantic.ts` directly.
5. **Add** unprocessed session notes: `findUnprocessedSessionNotes()` → full body text, capped at 3 / ~2000 tokens
6. **Add** suggested deep dives: `knowledge/topic.md#section-title` pointers for top hits
7. **Add** `lastReflectionRun` from state.json into response
8. **Update** `buildContextResult()` to assemble extended result
9. **Update** `contextCommand()` CLI formatter — json + human modes only

**Graceful degradation:** search.db missing → skip FTS. Semantic model not cached → keyword-only. No knowledge pages → playbook-only (existing behavior).

**Reuse:** `openSearchIndex()` from search.ts, `embedText()`/`cosineSimilarity()` from semantic.ts, `findUnprocessedSessionNotes()` from session-notes.ts, `loadTopics()`/`loadKnowledgePage()` from knowledge-page.ts, `loadProcessingState()` from session-notes.ts.

### Step 4: `cm_detail` MCP Tool (`src/commands/serve.ts`)

```
cm_detail(path: string, section?: string)
```

- Resolve path under `~/.memory-system/` (knowledge/, session-notes/, digests/)
- Read file, optionally extract specific section from knowledge pages via `parseKnowledgePage()`
- **Security:** validate resolved path stays under `~/.memory-system/`
- Returns `{ path, content_type, content, sections? }`

### Step 5: `cm_search` MCP Tool (`src/commands/serve.ts`)

```
cm_search(query, scope?: "all"|"knowledge"|"sessions"|"digests"|"transcripts"|"playbook", limit?, include_transcripts?)
```

- SQLite FTS via SearchIndex. "all" = knowledge + sessions + notes + digests (not transcripts unless `include_transcripts: true`)
- Supplement with `embedText()` semantic re-ranking if `config.semanticSearchEnabled`
- Transcript results ranked below curated content (0.5x score)
- Playbook scope: existing substring match
- Keep `memory_search` as deprecated alias
- **Update TOOL_DEFS descriptions** (Gap 3): cm_context, cm_feedback, memory_search
- **Extend cm_feedback** (Gap 4): add optional `path` + `section` params for knowledge page section feedback

### Step 6: MCP Resources (`src/commands/serve.ts`)

| URI | Handler |
|-----|---------|
| `cm://topics` | `loadTopics(config)` |
| `cm://knowledge/{topic}` | read `~/.memory-system/knowledge/{topic}.md` |
| `cm://digest/{date}` | read `~/.memory-system/digests/{date}.md` |
| `cm://today` | alias for today's date digest |
| `cm://status` | lastPeriodicJobRun, topic count, page count, unprocessed count, budget |

**Gotcha:** Restructure `handleResourceRead()` from switch-case to prefix-based matching for parameterized URIs.

### Step 7: Complete SQLite Re-Indexing (`src/orchestrator.ts`)

Existing step 7 (lines 553-584) only re-indexes knowledge pages. Add:
- Session notes re-indexing (after marking processed)
- Digest re-indexing (after curation writes digests)
- `lastIndexUpdate` timestamp update in state.json

### Step 8: Periodic Job Timer + Lock (`src/periodic-job.ts` — NEW)

- **`tryAcquirePeriodicJobLock(config)`** → `{ acquired: boolean, reason?: string }` — write `{ pid, startedAt }` to lock file. Non-blocking. Stale lock detection (>15 min).
- **`releasePeriodicJobLock(config)`** — remove lock file
- **`shouldRunPeriodicJob(config)`** — compare `lastPeriodicJobRun` vs `config.periodicJobIntervalHours` (24h)
- **`runPeriodicJob(config, options?)`** — full pipeline:
  - Acquire lock (fail fast if held)
  - Step 0: Preflight — `checkBudget()` from cost.ts
  - Step 1: Scan transcripts
  - Step 2: Update session notes (skip if budget exhausted)
  - Step 3-4: Reflection (skip if budget exhausted)
  - Step 5: Index (already in orchestrator) + `invalidateStaleEmbeddingCache()` (Gap 1)
  - Step 6: Cleanup — prune stale system topics + flag bloated pages → write to review-queue.json
  - Update `lastPeriodicJobRun` in state.json
  - Release lock (in finally block)
- **`maybeRunPeriodicJobBackground(config)`** — called once at MCP server start. Check overdue → fire-and-forget Promise. Errors logged, never crash server.

Wire into serve.ts stdio transport init.

**Reuse:** `loadProcessingState()`/`saveProcessingState()` from session-notes.ts, `checkBudget()` from cost.ts, `orchestrateReflection()` from orchestrator.ts, `processAllTranscripts()` from session-notes.ts, `appendReviewItems()` from Step 2.

### Step 9: `cm reflect --full` Polish (`src/commands/reflect.ts`, `src/cm.ts`)

- Add `--full` flag → invokes `runPeriodicJob()` instead of `orchestrateReflection()`
- Validation: `--full` incompatible with `--session` (print error)
- Display knowledge results alongside playbook delta summary
- Budget usage display after run

### Step 10: Tests

| Test File | Tests | Covers |
|-----------|-------|--------|
| `test/phase4-context.test.ts` | ~15 | generateContextResult with knowledge, topic excerpts, related topics, unprocessed notes, graceful degradation, lastReflectionRun |
| `test/phase4-search.test.ts` | ~10 | cm_search FTS across tables, scope filtering, transcript fallback, playbook scope |
| `test/phase4-topics.test.ts` | ~12 | add/remove/list topics, cold-start suggestions, review queue writes, dedup |
| `test/periodic-job.test.ts` | ~8 | timer should/shouldn't run, budget check, state update, lock acquisition, lock staleness, concurrent guard |

---

## Build Order

```
Step 1 (types)
 └→ Step 2 (topic mgmt + review queue) → CLI topic commands
 └→ Step 3 (context rewrite) — core of the phase
 └→ Step 4 (cm_detail) — independent
 └→ Step 5 (cm_search) — independent
 └→ Step 6 (MCP resources) — independent
 └→ Step 7 (orchestrator re-indexing) → Step 8 (periodic timer + lock) → Step 9 (reflect --full)
 └→ Step 10 (tests) — incremental with each step
```

**Recommended serial order:** 1 → 2 → 3 → 7 → 8 → 4 → 5 → 6 → 9 → 10

---

## Audit Gaps (Added Post-Review)

These gaps were found by auditing the plan against the architecture spec. Each is wired into the relevant build step above.

### Gap 1: Embedding Cache Invalidation (→ Step 8)

The periodic job Step 5 (INDEX) re-indexes files into SQLite, but Transformers.js embedding caches in `semantic.ts` can go stale when knowledge pages or session notes are updated by curation. During the periodic job's index step, invalidate cache entries for files whose modification times are newer than the cache timestamp. Add a `invalidateStaleEmbeddingCache(config)` call before re-indexing.

### Gap 2: Combined Ranking Formula (→ Step 3)

`generateContextResult()` will combine FTS5 rank scores (negative floats, lower = better) with cosine similarity scores (0–1, higher = better). These need normalization before combining:

- **FTS5 normalization:** `1 / (1 + abs(rank))` → 0–1, higher = better
- **Weighting:** `0.6 × fts_normalized + 0.4 × cosine_similarity` (FTS weighted higher because it reflects exact keyword relevance; semantic catches paraphrases)
- **Fallback:** If semantic model unavailable, use FTS score alone (already normalized)

This formula lives in `searchKnowledgeBase()` in `context.ts`.

### Gap 3: MCP Tool Description Updates (→ Step 5)

TOOL_DEFS in `serve.ts` have stale descriptions:
- `cm_context`: "Get relevant rules and history for a task" → update to mention knowledge pages, topic excerpts, related topics
- `cm_feedback`: needs to mention knowledge section support (Gap 4)
- `memory_search`: mark description as deprecated, point to `cm_search`

### Gap 4: cm_feedback Knowledge Section Support (→ Step 5)

Currently `cm_feedback` only accepts `bulletId`. The architecture spec says `cm_feedback(path, section, "harmful", reason)` should also work for knowledge page sections. Add optional `path` and `section` parameters to the cm_feedback tool definition, and ~20 lines in serve.ts handler to record feedback against knowledge sections (write to `~/.memory-system/feedback.json` or inline in knowledge page frontmatter).

### Gap 5: Review Queue Schema Version (→ Step 1)

Add `schema_version: 1` to the top level of `ReviewQueueSchema`. This allows Phase 5 Electron to detect and migrate old queue formats if the schema evolves.

```typescript
ReviewQueueSchema = { schema_version: z.literal(1), items: ReviewQueueItem[] }
```

### Deferred: Tiered Transcript Retention

The architecture spec mentions configurable transcript retention (full/summary/metadata-only per age bucket). This is deferred to a later phase — not needed for Phase 4's context retrieval to function.

---

## Gotchas and Risks

1. **`historySnippets` rename** — ripples to ~10 test files. Mechanical find/replace.
2. **Embedding model download** — first `embedText()` call downloads 23MB. Blocks 5-30s on fresh install during `cm_context`.
3. **Empty knowledge base** — every new feature must handle cold-start (no pages, no notes, no search.db).
4. **search.db may not exist** — every `openSearchIndex()` call site wraps in try/catch.
5. **CLI formatter** — json + human modes only. ~40-60 new lines for human mode.
6. **MCP resource URI matching** — restructure `handleResourceRead()` from switch to prefix matching.
7. **Orchestrator re-indexing gap** — add session notes + digests alongside existing knowledge page re-indexing.
8. **Concurrent periodic jobs** — lock file with try-lock + stale detection (>15 min) prevents double-runs.
9. **Review queue dedup** — composite key `(type, target_topic, source)` prevents duplicates from repeated cold-starts or periodic job runs.
10. **Embedding cache staleness** — semantic.ts caches embeddings but doesn't invalidate when source files change. Periodic job must invalidate before re-indexing.
11. **FTS + semantic score normalization** — FTS5 returns negative rank (lower=better), cosine is 0-1 (higher=better). Must normalize before combining.
12. **cm_feedback schema change** — adding `path`/`section` params is backwards-compatible but tests need updating.

---

## Validation Checklist (End of Phase 4)

```markdown
- [ ] `bun test` — all tests pass (no regressions)
- [ ] New Phase 4 tests pass (~45 new tests)
- [ ] `bun run src/cm.ts context "fix billing webhook"` — returns topic excerpts + related topics
- [ ] `bun run src/cm.ts topic list` — lists topics
- [ ] `bun run src/cm.ts topic add test-topic --name "Test" --description "..."` — creates topic, shows cold-start suggestions, writes to review-queue.json
- [ ] MCP cm_context — returns extended response with searchResults, topicExcerpts, lastReflectionRun
- [ ] MCP cm_detail — retrieves full knowledge page / section
- [ ] MCP cm_search — returns ranked results across content types
- [ ] MCP cm://topics — returns topic list
- [ ] MCP cm://knowledge/{topic} — returns knowledge page
- [ ] MCP cm://status — returns system status with lastPeriodicJobRun
- [ ] After `cm reflect`, SQLite index updated (search finds reflected content)
- [ ] cm_context returns unprocessed session notes as full text
- [ ] Periodic job timer fires at MCP server start when overdue
- [ ] Periodic job lock prevents concurrent runs
- [ ] cm reflect --full runs complete periodic job pipeline
- [ ] cm reflect --full while already running prints "already in progress"
- [ ] cm_feedback accepts knowledge section path + section name
- [ ] review-queue.json has schema_version: 1
- [ ] MCP tool descriptions are up-to-date (cm_context mentions knowledge, cm_feedback mentions sections)
```

---

## Files Summary

| File | Action |
|------|--------|
| `src/types.ts` | Extend ContextResultSchema, ProcessingStateSchema; add ReviewQueueItemSchema, KnowledgeSearchHitSchema, TopicExcerptSchema, etc. |
| `src/commands/context.ts` | **Core rewrite** — replace cass search, add knowledge retrieval |
| `src/commands/serve.ts` | Add cm_detail, cm_search, 5 MCP resources, periodic job trigger at stdio init, update TOOL_DEFS descriptions, extend cm_feedback for knowledge sections |
| `src/knowledge-page.ts` | Add topic CRUD (addTopic, removeTopic, listTopicsWithMetadata), coldStartTopic, review queue I/O |
| `src/commands/topic.ts` | **New** — CLI for topic management |
| `src/periodic-job.ts` | **New** — timer, lock, full pipeline runner |
| `src/orchestrator.ts` | Complete re-indexing (add session notes + digests) |
| `src/commands/reflect.ts` | Add --full flag |
| `src/cm.ts` | Register topic command, reflect --full |
| `test/phase4-*.test.ts` | **New** — ~45 tests |
