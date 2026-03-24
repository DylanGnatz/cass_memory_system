# V1 Prototype Architecture: Weekend CASS Fork

## What We're Building

A persistent memory system for LLM-assisted development on a large enterprise SaaS platform. It automatically captures knowledge from coding and chat sessions, organizes it by user-defined topics into verbose knowledge pages, and makes it queryable by both the LLM (at session start and mid-session) and the human (via a searchable Electron app). The system should work well with zero user configuration, but offer granular control to users who want it.

**Weekend goal:** A working prototype that demonstrates persistent memory across sessions. Monday morning, you start a Claude Code session and the agent already knows what you worked on last week.

---

## Fork Strategy

**We are forking CASS, not extracting parts.** The dependency graph is too interconnected for clean extraction — `orchestrator.ts` imports from 12 local modules, `curate.ts` depends on `semantic.ts`, everything depends on `utils.ts`. It's faster and safer to fork the whole repo and strip what we don't need.

Of CASS's ~25,000 lines of source code:
- **~15,000 lines are immediately useful** with no or minimal changes
- **~5,000 lines need adaptation** for our knowledge management use case
- **~2,000 lines get deleted** (trauma system, starter playbooks, guard scripts)
- **~3,000 lines of tests** to update incrementally

This is a 60% direct reuse rate. We're inheriting a working pipeline with battle-tested quality controls, not dragging along irrelevant code.

---

## What We're Forking From CASS

### Keeping as-is
- **scoring.ts** (230 lines) — Confidence decay calculation, maturity progression, promotion/demotion thresholds. Operates purely on PlaybookBullet and FeedbackEvent types. No file paths or CASS-specific assumptions.
- **sanitize.ts** (244 lines) — PII/secret removal before LLM calls. Pure string-in, string-out.
- **lock.ts** (273 lines) — File-level locking for concurrent write safety. Generic file paths. Extended to cover knowledge page and digest writes (not just playbook.yaml) to prevent partial reads from the Electron app during background job writes.
- **output.ts** (224 lines) — Terminal output formatting and styling.
- **progress.ts** (268 lines) — Progress reporting. Used by the periodic background job to surface status in the Electron app.
- **llm.ts** (835 lines) — Multi-provider LLM abstraction via Vercel AI SDK (Anthropic, OpenAI, Google, Ollama). Structured output, retries, fallbacks. Depends on `cost.ts` for budget checking — both kept together.
- **cost.ts** (221 lines) — LLM cost tracking with per-model pricing, daily/monthly budget limits. Essential guardrail for the unsupervised periodic background job. `llm.ts` imports `checkBudget` and `recordCost` directly — cannot be dropped without modifying `llm.ts`. Budget caps prevent runaway LLM costs from the daily reflection cycle.
- **playbook.ts** (702 lines) — Playbook CRUD, load/save/merge YAML, bullet management. We keep playbooks, so this works unchanged.
- **gap-analysis.ts** (298 lines) — Categorizes rules into archetypes, detects coverage gaps. Operates on Playbook type with keyword matching. Useful for review queue. Also adaptable for topic suggestion seeding — can identify topic coverage gaps without an LLM call.
- **rule-validation.ts** (313 lines) — Semantic validation, category mismatch detection. Operates on playbook bullets via semantic.ts and gap-analysis.ts. Useful for review queue.

### Keeping and modifying
- **types.ts** (906 lines) — All Zod schemas and TypeScript interfaces. Add new schemas: SessionNote, KnowledgePage, Topic, DailyDigest, TopicSuggestion, and new delta types. Extend ConfigSchema with new fields for our directory paths, periodic job interval, and knowledge base settings. Change `semanticSearchEnabled` default from `false` to `true`.
- **utils.ts** (3,420 lines) — Core utility library: path helpers, hashing, tokenization, Jaccard similarity, keyword extraction, file operations, logging. 22 modules depend on it. Light modification: `resolveGlobalDir()` hardcodes `~/.memory-system` (rename to `~/.memory-system`), `resolveRepoDir()` looks for `.cass/` directories. Change these path constants to match our directory layout.
- **config.ts** (305 lines) — Zod-validated YAML config loading/saving. Delegates to ConfigSchema so parsing mostly works once types.ts is updated, but needs adjustments for new default values (e.g., periodic job interval, knowledge base paths) and to handle our renamed global directory.
- **reflect.ts** (315 lines) — Core Reflector. Split into two sequential LLM calls: (1) structural/extractive call producing playbook bullets + topic suggestions, (2) generative/narrative call producing knowledge page prose + digest content. Both receive the diary entry + session note as input. Two calls rather than one because multi-objective prompts degrade on all axes — bullet extraction rewards compression while knowledge prose rewards verbosity and specificity.
- **validate.ts** (321 lines) — Validator/evidence gate. Modified to search full session note text (not just abstracts) and knowledge pages instead of external cass binary. Uses `semantic.ts` for similarity matching. Adds source count heuristic: knowledge backed by N≥3 independent sessions gets higher base confidence regardless of Validator results. This prevents bootstrapping problems where early errors become entrenched as "established knowledge."
- **curate.ts** (723 lines) — Deterministic Curator. Extended with new delta types for knowledge page appends (with confidence metadata), digest writes, and topic suggestions. Knowledge page deduplication uses source session ID as primary signal: if two sections cite the same source session, run semantic dedup. If they cite different sessions, always keep both — the user can merge via review queue. This avoids silent information loss from aggressive semantic dedup on prose where `all-MiniLM-L6-v2`'s 256-token limit can't distinguish "same topic, different facts" from "same facts, different wording." Jaccard similarity remains the primary measure for bullet deduplication (already tuned and tested).
- **diary.ts** (660 lines) — Session diary generation. Adapted to generate structured diary entries *from session notes* (not raw transcripts). Diary entries become an internal intermediate format optimized for Reflector input, not a user-facing artifact.
- **orchestrator.ts** (454 lines) — Pipeline orchestration. Extended with new steps: check for modified transcripts → update session notes → generate diary entries from notes → reflect → curate (bullets + knowledge pages + digests).
- **cass.ts** (1,175 lines) — Stub out external binary calls (`cassSearch`, `cassExport`, `cassTimeline`). Keep session discovery and format parsing logic. Replace binary-based search with knowledge base search.
- **semantic.ts** (780 lines) — Local embeddings via Transformers.js (`all-MiniLM-L6-v2`). Used for `cm_context` retrieval quality improvement, Curator deduplication, and Validator evidence matching. **Runs locally, no API calls, no token cost.** Previously deferred to v2 but keeping it since it's already implemented and adds meaningful retrieval quality.
- **outcome.ts** (517 lines) — Session outcome recording. Adapted to also track knowledge page section usefulness — when `cm_context` serves a section and the session succeeds, that's a positive signal.
- **tracking.ts** (546 lines) — Event tracking. Extended with new event types: `knowledge_page_created`, `digest_generated`, `session_note_added`, `topic_suggested`.
- **commands/serve.ts** (728 lines) — MCP server. Extended with new tools (`cm_snapshot`, `cm_detail`).
- **commands/context.ts** (932 lines) — Context retrieval. Extended with single-pass FTS + semantic ranking, topic/knowledge page querying, full unprocessed session note inclusion.
- **commands/playbook.ts** (1,108 lines) — Playbook management CLI. Kept for playbook operations.
- **commands/reflect.ts** (402 lines) — Reflection trigger. Modified for new two-call pipeline. Imports `getUsageStats` and `formatCostSummary` from `cost.ts` to display token usage after reflection — another reason cost.ts is kept.
- **cm.ts** (1,197 lines) — Main CLI entry point. Registers all commands via Commander.js. Must be updated when commands are added or removed (e.g., removing guard, starters, quickstart; adding new knowledge/topic commands). This file is the spine of the CLI and was missing from the original plan.
- **audit.ts** (90 lines) + **commands/audit.ts** — Rule validation against session history. Currently coupled to cass binary via `scanSessionsForViolations`. Adapted to validate against knowledge base + SQLite FTS instead.
- **info.ts** (255 lines) — System status information. Useful for onboarding and the `/status` slash command.
- **examples.ts** (130 lines) — Usage example generation. Useful for onboarding and help text.

### Also keeping and modifying (useful tools we were initially ignoring)
- **undo.ts** (481 lines) — History rollback for playbook changes. Valuable safety net when the Curator produces bad output from a reflection job. Extend for knowledge page rollback.
- **commands/doctor.ts** (1,510 lines) — Diagnostics and repair. The check/fix framework (`HealthCheck`, `FixableIssue`, `runSelfTest`) is reused directly, but the checks themselves are hardcoded to CASS's file structure (playbook.yaml, .cass/ dir, cass binary, trauma patterns). Needs new checks added for: session-notes/ directory and frontmatter validity, knowledge/ pages with valid confidence metadata, SQLite search.db ↔ session note file consistency, state.json offset validity, topics.json ↔ knowledge page filename consistency, diary/ ↔ session note cross-references, embedding cache integrity (stale entries for modified files). Remove trauma and cass binary checks.
- **similar.ts** (235 lines) — Find similar bullets using semantic search. Useful for deduplication and discovery.
- **stale.ts** (281 lines) — Find stale bullets needing revalidation. Useful for review queue.
- **why.ts** (385 lines) — Explain a bullet's confidence score. Useful for the UI when users want to understand why something is rated a certain way.
- **stats.ts** (241 lines) — Playbook statistics. Useful for the status dashboard.

### Dropping
- **trauma.ts** (455 lines) — Catastrophic action detection. Not relevant.
- **trauma_guard_script.ts** (301 lines) — Git safety hooks. Not relevant.
- **commands/guard.ts** (274 lines) — Install trauma guard hooks. Not relevant.
- **starters.ts** (390 lines) — Bundled starter playbooks. We start empty.
- **commands/starters.ts** (45 lines) — List/init starters. Not relevant.
- **commands/quickstart.ts** (186 lines) — Interactive walkthrough using starters. Replace with our own onboarding.
- **onboard-state.ts** (240 lines) — Onboarding state tracking. Replace with our own.

---

## Key Architectural Decisions: Resolving CASS Conflicts

### Session Notes vs Diary Entries

**Conflict:** CASS generates structured JSON diary entries (accomplishments, decisions, challenges, key learnings) designed as compact Reflector input. We generate verbose markdown session notes designed for human reading. These are fundamentally different artifacts.

**Resolution:** Keep both, as a two-stage pipeline. Session notes are the primary user-facing artifact, written during/after sessions. When the periodic job runs reflection, it generates a compact diary entry *from the session note* — a cheap LLM call since the note is already a summary.

**The Reflector receives both the diary entry and the session note.** The diary entry provides structural scaffolding — what happened, what was decided, what topics were covered — which the Reflector uses to orient itself. The session note provides the detail — specific config paths, exact error messages, architectural specifics — which the Reflector draws from when writing verbose knowledge page prose. Without the session note, the diary entry's compressed bullet points would be insufficient for generating detailed knowledge pages. Without the diary entry, the Reflector would waste effort parsing unstructured prose to understand the session's structure.

Reflector Call 1 prompt instructs: "Use the diary entry to identify what topics were covered and what patterns to extract as rules." Reflector Call 2 prompt instructs: "Use the session note to write detailed knowledge page sections with specific facts, configurations, and references. Use the diary entry for structural context."

```
Raw transcript → Session note (verbose, human-facing, stored as .md)
                      ↓
                 Diary entry (compact, structured JSON, internal scaffold)
                      ↓
                 Reflector Call 1 (structural/extractive):
                   Input: diary entry + topics + playbook
                   Produces: bullets + topic suggestions
                      ↓
                 Reflector Call 2 (generative/narrative):
                   Input: diary entry + session note + relevant knowledge pages
                   Produces: knowledge page prose + digest content
```

Token cost: two calls rather than one increases total tokens by ~40%, but each call is focused on one generation mode. The session note (typically 1000-3000 tokens) is only included in Call 2 where its detail is needed. Session notes are already compressed relative to raw transcripts (a 200k-token session produces a ~2000-token note).

### Validator Without the cass Binary

**Conflict:** `validate.ts` uses the external cass binary to search historical sessions for evidence supporting proposed rules. The current evidence gate looks for SUCCESS_PATTERNS ("fixed", "successfully", "solved") and FAILURE_PATTERNS ("failed", "error:", "broken") in raw session content. Knowledge pages are curated prose — they won't contain these raw signals.

**Resolution:** Replace cass binary search with a three-source evidence model:

1. **Full session note text** (primary source) — Search the complete text of session notes, not just their abstracts. Session notes preserve enough raw detail (error messages, config paths, outcomes) for the SUCCESS/FAILURE pattern matching to work. This is the closest substitute for raw cass search.
2. **Knowledge pages** (secondary source) — Semantic search via `semantic.ts` for corroborating or contradicting established knowledge.
3. **SQLite FTS** (fallback source) — When available, search raw transcript content indexed by the periodic job for primary-source evidence.

Add a **source count heuristic**: knowledge backed by N≥3 independent sessions gets higher base confidence regardless of Validator pattern-matching results. This provides a multi-attestation signal and prevents the bootstrapping problem where early Validator errors become entrenched as "established knowledge" that the Validator treats as ground truth.

### Curator Deduplication for Prose vs Bullets

**Conflict:** `curate.ts` uses Jaccard similarity thresholds tuned for terse playbook bullets. Knowledge page sections are paragraphs of prose where the same thresholds won't work. Additionally, `all-MiniLM-L6-v2` has a 256-token max sequence length — knowledge page sections can easily exceed this, causing truncation that makes two sections with different second paragraphs appear identical.

**Resolution:** Deduplicate knowledge page sections by **source session ID** as the primary signal. If two knowledge sections cite the same source session, run semantic dedup. If they cite different sessions, always keep both and let the user merge via the review queue. This is conservative but avoids silent information loss that aggressive semantic dedup causes on domain-specific technical prose. Jaccard similarity remains the primary measure for bullet deduplication (already tuned and tested). The Curator applies different dedup strategies based on delta type.

### Split Reflector Into Two Calls

**Decision:** The original plan asked one LLM call to produce four output types (bullets, knowledge page prose, digest content, topic suggestions). These are fundamentally different generation tasks — bullet extraction rewards compression, knowledge page writing rewards verbosity and specificity, digest writing rewards chronological narrative coherence, topic suggestion rewards taxonomic reasoning. Multi-objective prompts degrade on all axes.

**Resolution:** Split into two sequential calls:
1. **Structural/extractive call** — Produces playbook bullet proposals + topic suggestions. Input: diary entry + existing topics + existing playbook. Optimized for compression and classification.
2. **Generative/narrative call** — Produces knowledge page prose additions + digest content. Input: diary entry + session note + existing knowledge pages for relevant topics. Optimized for verbosity, specificity, and narrative coherence.

Token cost increase is modest (~40% more than single call) and quality improvement is significant. Also makes debugging much easier when output quality is poor on one axis.

**Reflector Call 2 prompt guardrail:** The prompt explicitly states: "Your primary source is the session note. The existing knowledge page is reference context for avoiding redundancy, detecting contradictions, and maintaining coherence. Extract new information from the session — do not paraphrase existing knowledge page content." This anchors each run to primary-source material and prevents stylistic/factual drift from accumulated self-generated prose.

**Drift telemetry:** After each Reflector Call 2 run, compute semantic similarity between each new section and all existing sections on the same topic page. If a new section is >0.9 similar to an existing section from a *different* source session, flag it — that's likely echo/drift rather than independent corroboration. Log these flags alongside the Curator acceptance/rejection ratio for early warning of Reflector quality degradation.

### SQLite FTS5 as Search Index Layer

**Decision:** Add SQLite as a derived search index alongside flat files. Don't replace flat files — they're the right source of truth for user-editable markdown content. SQLite replaces three things that will become problems:

1. **In-memory file search in the Electron app** — won't scale past a few hundred files
2. **Manually-maintained `index.json`** — synchronization bug surface between index and actual files
3. **Lack of raw transcript search** — the biggest retrieval gap after removing the cass binary

**Implementation:** A single `search.ts` module, ~200-300 lines. FTS virtual tables for full-text search across knowledge pages, session notes, digests, user notes, and raw transcripts. Structured tables replacing `index.json` and `topics.json` for filtered queries. Results return file paths; callers read actual files for display. The periodic job already touches every file that needs indexing — add an `updateSearchIndex()` call at the end.

**Transcript indexing** piggybacks on existing work: as the periodic job reads each transcript chunk from offsets to generate session notes, it also inserts the chunk into `fts_transcripts`. Same pass, same offset tracking, one additional write. For first-launch bootstrap with existing transcripts, run a one-time indexing job with a progress bar.

**The boundary to protect:** SQLite is the search index, files are the data. Don't let this creep into storing knowledge page sections as rows with confidence columns and foreign keys. That path leads to rebuilding the entire data model around SQL, which defeats human-editable markdown files.

### Raw Transcript Access

**Decision:** Removing the cass binary is correct — we don't want to maintain a forked Rust project in a TypeScript stack. But removing transcript *access* is different, and wrong.

Session notes are 99% compressions of raw transcripts. Even good compression is lossy. The "I know we discussed this" problem — searching for a specific error message, config value, or colleague's name mentioned in passing — is the most common complaint in knowledge management systems, and our pipeline has no way to surface what the session note generator judged unimportant.

With SQLite FTS, transcript search becomes the fallback layer. `cm_search` hits curated content first (knowledge pages, session notes, digests), and falls through to `fts_transcripts` when results are insufficient or the query looks like a literal string. The Validator also gains a primary-source evidence path for checking specific claims.

Keep transcript results visually distinct in the UI — ranked below curated content, behind a "search raw transcripts" expandable section. The user should feel the difference between "the system knows this" and "this was mentioned once in a conversation three weeks ago."

### Topic Cold-Start Solution

**Problem:** When a user creates a topic on day 5, days 1-4 had sessions touching that subject. The knowledge page starts empty despite the system having relevant content.

**Resolution:** When a new topic is created, run a semantic search over existing knowledge pages and session notes and *suggest* relevant existing content for the new topic. This doesn't require re-running the Reflector — just a retrieval pass with user confirmation via the review queue. `gap-analysis.ts` can also be adapted to identify topic coverage gaps without an LLM call, seeding initial suggestions.

### File Locking for Knowledge Base Writes

**Problem:** `lock.ts` currently locks `playbook.yaml` during writes. The periodic background job writes to knowledge pages, session notes, `search.db`, `state.json`, `topics.json`, and digests — potentially while the Electron app is reading them. Without locking, partial reads produce corrupted markdown.

**Resolution:** Extend `withLock()` usage to all file writes performed by the periodic job. Use `atomicWrite` (already in `utils.ts` — write to temp file then rename) for all knowledge base file mutations. The Electron app should handle `ENOENT` gracefully for the brief window during atomic rename.

### Outcome Tracking for Knowledge Pages

**Improvement from CASS:** `outcome.ts` already tracks whether playbook rules were useful in practice. We extend this to knowledge page sections. When `cm_context` serves a knowledge page section and the session outcome is positive, that section's confidence gets a boost. When the outcome is negative, it gets flagged for review. This gives us usage-based quality signals on top of the extraction-based confidence tiers.

Additionally, `outcome.ts` already parses `// [cass: helpful b-xyz] reason` inline comments from session transcripts — the orchestrator extracts these automatically during reflection. Instruct the agent (via system prompt) to emit these comments when using knowledge from `cm_context`, giving automatic feedback with zero user intervention.

### Confidence Bridge Between Bullets and Prose

**Problem:** Playbook bullets and knowledge page sections are two different content types with two different confidence systems (scoring.ts decay vs verified/inferred/uncertain tiers). When a bullet says "Always check staging secrets after production key rotation" and a knowledge section describes the specific incident, there's an implicit evidential relationship — but no mechanism to propagate confidence changes between them.

**Resolution:** The Curator links related artifacts at write time. Both outputs come from the same Reflector run on the same session, so the Curator knows which bullets and knowledge sections share provenance. Bullets get `relatedSections: ["sec-xyz"]` in their metadata. Knowledge sections get `related_bullets: ["b-xyz"]` in their HTML comment. When either artifact receives harmful/invalid feedback, the review queue surfaces its counterparts. This is ~30 lines in the Curator's delta-application logic.

### Session Note Generation: Prompt Specification

**Problem:** The most critical LLM call in the pipeline — transforming raw transcripts into session notes — was underspecified. This compression boundary is where knowledge dies. The prompt design determines what's "important enough" to survive.

**Specification:**

The session note generator prompt instructs:

1. **Inclusion criteria (what survives compression):**
   - Specific facts: file paths, config values, API endpoints, error messages, version numbers
   - Decisions and their reasoning: why option A was chosen over B
   - Discovered behaviors: "X actually works like Y, not like the docs say"
   - Commands that worked (or didn't) and why
   - People mentioned and their roles/opinions
   - Links, ticket numbers, PR numbers, channel names
   - Unresolved questions and open threads

2. **Exclusion criteria (what gets dropped):**
   - Verbose back-and-forth debugging that led nowhere
   - Repeated attempts at the same fix
   - Boilerplate code generation that worked first try
   - Standard tool invocations with expected results

3. **Multi-topic sessions:** When a session touches multiple topics (billing + auth + deployment), the note generator inserts topic transition headers: `### [Topic shift: Auth Service]`. This gives the diary generator clean boundaries for structured extraction and helps the Reflector route knowledge correctly.

4. **Append coherence:** When extending an existing note from a new offset, the generator reads the last 500 tokens of the existing note for context continuity. It does NOT re-summarize existing content. It adds a date header if the day changed, then continues the narrative from where it left off.

5. **Invalidation detection:** When new transcript content contradicts something stated earlier in the same note (or in the existing note being extended), the generator wraps the contradicted statement in `[INVALIDATED {date} (effective {date}): {reason}]` and adds the corrected understanding. For chained invalidation (same fact invalidated twice), the entire annotation block is rewritten to the current best understanding.

---

## Confidence Model

### Playbook Bullets
Inherit CASS's existing confidence system directly via `scoring.ts`:
- New bullets start as **candidates**
- Confidence calculated from helpful/harmful feedback, weighted by 4x harmful multiplier
- Decays with 90-day half-life if not revalidated
- Maturity progression: candidate → established → proven
- Bullets with repeated harmful feedback auto-invert into anti-patterns
- Session outcome tracking (via `outcome.ts`) provides additional signal
- **Cross-reference:** Bullets store `relatedSections: ["sec-a1b2c3d4"]` linking to the knowledge page sections that share their source session. When a bullet is marked harmful, its related sections are flagged for review. When a section is invalidated, its related bullets are flagged.

### Knowledge Page Sections
Each section appended to a knowledge page gets a **stable ID** (e.g., `sec-a1b2c3d4`) in its metadata comment. This ID is assigned by the Curator at write time and never changes. It serves three purposes: (1) cross-referencing with related playbook bullets via `related_bullets`, (2) enabling future decomposition into atomic claims without losing provenance, and (3) allowing `cm_feedback` to target specific sections.

Each section also gets a confidence tier:
- **Verified** — human confirmed (via verify action in UI), or user wrote/edited directly
- **Inferred** — Reflector extracted it, Validator found no contradictions. Default for system-generated content.
- **Uncertain** — Validator found something concerning: contradicts existing knowledge, single-source with low confidence, or Reflector expressed uncertainty. Shows up in review queue.

Confidence stored as an HTML comment in the section metadata:
```markdown
## Webhook Configuration
<!-- confidence: inferred | source: session-2026-03-20-001 | added: 2026-03-20 -->

The billing service exposes webhooks at...
```

Invalidation annotations include an optional `effective_date` — the time a fact *was true* differs from the time you *learned* it changed. "The webhook config changed on March 15th" is different from "we discovered on March 20th that the config had changed." This is a lightweight version of Zep/Graphiti's bi-temporal modeling without building a full temporal knowledge graph:
```markdown
[INVALIDATED March 20 (effective March 15): The staging config path
changed from /etc/billing/webhook.conf to /opt/billing/staging.yaml
as part of the infrastructure migration.]
```

No time-based decay on knowledge page sections in v1. Staleness handled by contradiction detection when new sessions discover changes. Usage-based confidence signals from outcome tracking provide indirect revalidation.

### Session Notes
No confidence assigned. Session notes are historical records, not claims about the world. Confidence applies to knowledge extracted from them.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App (UI)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │Encyclopedia│ │ Recent  │ │ Starred  │ │ My Notes  │  │
│  │(topics)   │ │(digests)│ │(pinned)  │ │(user own) │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Fast Search Bar (FTS)                  │ │
│  └─────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Claude Dialog Bar                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  Content rendering: react-markdown + remark-gfm         │
│  Edit mode: toggle between rendered view and editor     │
│  All markdown files editable by user                    │
└─────────────────────┬───────────────────────────────────┘
                      │ reads files + queries MCP
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   MCP Server (Bun)                       │
│                                                         │
│  Tools:                                                 │
│  ├── cm_context    (get relevant knowledge for a task)  │
│  ├── cm_snapshot   (write/revise session note)          │
│  ├── cm_detail     (get full content of a specific doc) │
│  ├── cm_feedback   (mark knowledge helpful/harmful)     │
│  ├── cm_search     (keyword + semantic search)          │
│  └── cm_reflect    (trigger reflection manually)        │
│                                                         │
│  Resources:                                             │
│  ├── cm://playbook            (current rules)           │
│  ├── cm://topics              (topic list + descriptions)│
│  ├── cm://knowledge/{topic}   (full knowledge page)     │
│  ├── cm://digest/{date}       (daily digest)            │
│  ├── cm://today               (today's unprocessed notes)│
│  └── cm://status              (system health/stats)     │
│                                                         │
│  Background:                                            │
│  └── Periodic job (every 4 hrs + on launch + manual):   │
│      0. Run doctor health checks + budget check         │
│      1. Scan transcripts for new activity               │
│      2. Update session notes for modified sessions      │
│      3. Generate diary entries from session notes        │
│      4. Run reflection pipeline (two Reflector calls)   │
│      5. Route knowledge to topic pages                  │
│      6. Generate/update daily digests                   │
│      7. Update SQLite search index                      │
│      8. Invalidate stale embedding cache entries        │
│      9. Log Reflector quality telemetry                 │
│                                                         │
└─────────────────────┬───────────────────────────────────┘
                      │ reads/writes
                      ▼
┌─────────────────────────────────────────────────────────┐
│                 Flat File Storage                        │
│                                                         │
│  ~/.memory-system/                                      │
│  ├── config.yaml            (system config)             │
│  ├── topics.json            (user-defined + suggested)  │
│  ├── playbook.yaml          (terse rules, from CASS)    │
│  ├── session-notes/         (one .md per session)       │
│  │   └── {session-id}.md    (frontmatter + prose)       │
│  ├── diary/                 (internal, not user-facing)  │
│  │   └── {session-id}.json  (structured Reflector input) │
│  ├── knowledge/             (one .md per topic)         │
│  │   └── {topic-slug}.md    (cumulative prose)          │
│  ├── digests/               (one .md per day)           │
│  │   └── {YYYY-MM-DD}.md   (daily summary)             │
│  ├── notes/                 (user-authored, protected)  │
│  │   └── {note-id}.md      (never modified by system)   │
│  ├── search.db              (SQLite FTS5 search index)  │
│  ├── state.json             (processing offsets/times)  │
│  └── .embedding-cache.json  (from CASS semantic.ts)     │
│                                                         │
│  Note: index.json replaced by SQLite search.db.         │
│  SQLite is the search index; files are the data.        │
│  All writes use withLock() + atomicWrite() for safety.  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Data Formats

### Session Note (`session-notes/{session-id}.md`)

Session notes use **append-and-annotate** — content is only added, never removed by the system. Invalidated knowledge is annotated inline rather than deleted. If the same fact is invalidated twice (chained invalidation), the entire annotation block is rewritten cleanly to the current best understanding.

Temporal markers are added automatically: when the periodic job or a manual snapshot extends a note on a different day than the last extension, a date header is inserted. Invalidation annotations are stamped with the date of invalidation.

```markdown
---
id: session-2026-03-20-001
source_session: ~/.claude/sessions/abc123.jsonl
last_offset: 4327
created: 2026-03-20T09:15:00
last_updated: 2026-03-24T14:30:00
abstract: "Investigated billing webhook retry failures; discovered HMAC validation using wrong secret key in staging. Later verified fix in production."
topics_touched: ["billing-service", "webhooks"]
processed: false
user_edited: false
---

## March 20, 2026

### 09:15 - Initial investigation

Started looking into why billing webhooks are failing intermittently
in staging. The error logs in Splunk show 401 responses from the
webhook consumer...

### 10:30 - Root cause identified

[INVALIDATED March 20 (effective March 20): Initially suspected the
retry logic was using a fixed delay instead of exponential backoff.
This was incorrect — the retry logic is fine.]

The actual issue is the HMAC signature validation. The staging
environment is using the production secret key, which was rotated
last week. The staging config at `/etc/billing/webhook.conf` still
has the old key...

### 11:30 - Resolution and follow-up

Updated the staging config with the correct key. Confirmed webhooks
are now succeeding. Filed JIRA-4521 to add secret key rotation to
the staging deployment playbook...

## March 24, 2026 (resumed)

### 14:30 - Production verification

Returned to verify the fix in production. The staging config update
resolved the issue but production has a different config path at
`/opt/billing/conf.d/webhook.yaml`. Confirmed production is using
the correct rotated key...
```

### Diary Entry (`diary/{session-id}.json`) — Internal Only

Generated from session notes, not user-facing. Structured format optimized for Reflector consumption. Follows CASS's existing DiaryEntry schema so the Reflector prompt requires minimal modification.

```json
{
  "id": "diary-session-2026-03-20-001",
  "sessionPath": "session-notes/session-2026-03-20-001.md",
  "timestamp": "2026-03-20T11:42:00",
  "agent": "claude",
  "workspace": "billing-service",
  "status": "success",
  "accomplishments": [
    "Identified root cause of billing webhook failures in staging",
    "Fixed HMAC secret key mismatch in staging config"
  ],
  "decisions": [
    "Filed JIRA-4521 to automate staging secret key rotation"
  ],
  "challenges": [
    "Initial hypothesis about retry logic was incorrect"
  ],
  "keyLearnings": [
    "Staging and production use different config paths for billing webhooks",
    "Secret key rotation does not automatically propagate to staging"
  ],
  "tags": ["billing-service", "webhooks", "HMAC", "staging"]
}
```

### Knowledge Page (`knowledge/{topic-slug}.md`)
```markdown
---
topic: Billing Service
description: "Billing platform, payment processing, invoicing, webhooks"
source: user
created: 2026-03-18
last_updated: 2026-03-20
---

## Webhook Configuration
<!-- id: sec-a1b2c3d4 | confidence: verified | source: session-2026-03-20-001 | added: 2026-03-20 | related_bullets: b-20260320-x7k -->

The billing service exposes webhooks at `/api/v2/hooks/billing`.
Consumers must validate requests using HMAC-SHA256 signatures.
The signing secret is environment-specific and managed via the
config at `/etc/billing/webhook.conf` (staging) or
`/opt/billing/conf.d/webhook.yaml` (production).

**Known issue (2026-03-20, verified):** When production secrets are
rotated, the staging environment config must be updated manually.
There is no automated sync. See JIRA-4521.

Source: [Billing webhook docs](https://docs.internal/billing/webhooks)
Learned: Session 2026-03-20-001

## Retry Logic
<!-- id: sec-e5f6g7h8 | confidence: inferred | source: session-2026-03-19-003 | added: 2026-03-19 -->

Webhook delivery uses exponential backoff with a 5-minute cap.
Failed deliveries are retried up to 8 times over approximately
24 hours before being sent to the dead letter queue.

Source: [Event bus runbook](https://docs.internal/eventbus/retries)
Learned: Session 2026-03-19-003
```

### Topic Configuration (`topics.json`)

Topics can be user-defined (stable, never removed by system) or system-suggested (proposed by Reflector when knowledge doesn't fit existing topics). System-suggested topics appear in the review queue for the user to approve, rename, or dismiss.

When no topics are defined, the Reflector generates topic names freely and all topics start as system-suggested. As the user approves and customizes topics, routing becomes more precise.

```json
{
  "topics": [
    {
      "slug": "billing-service",
      "name": "Billing Service",
      "description": "Billing platform, payment processing, invoicing, webhooks, subscription management",
      "source": "user",
      "created": "2026-03-18"
    },
    {
      "slug": "notification-service",
      "name": "Notification Service",
      "description": "Push notifications, email delivery, SMS, in-app messaging, notification preferences",
      "source": "system",
      "created": "2026-03-20"
    }
  ]
}
```

### Session Note Index (SQLite `search.db`)

Replaces the original `index.json` design. Session metadata is stored in SQLite structured tables alongside FTS5 virtual tables for full-text search. This eliminates the synchronization bug surface between a JSON index and actual files.

```sql
-- Structured session metadata (replaces index.json)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  abstract TEXT,
  filepath TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  last_offset INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE session_topics (
  session_id TEXT REFERENCES sessions(id),
  topic_slug TEXT,
  PRIMARY KEY (session_id, topic_slug)
);

-- FTS5 virtual tables for full-text search
CREATE VIRTUAL TABLE fts_knowledge USING fts5(topic, section_title, content);
CREATE VIRTUAL TABLE fts_sessions USING fts5(id, abstract, content);
CREATE VIRTUAL TABLE fts_transcripts USING fts5(session_id, chunk_offset, content);
CREATE VIRTUAL TABLE fts_notes USING fts5(id, title, content);
CREATE VIRTUAL TABLE fts_digests USING fts5(date, content);
```

The boundary: SQLite is the search index, files are the data. Knowledge page sections are NOT stored as rows with confidence columns. All confidence metadata lives in the markdown files.

### Daily Digest (`digests/2026-03-20.md`)
```markdown
---
date: 2026-03-20
sessions: 3
topics_touched: ["billing-service", "auth-service", "deployment"]
---

## March 20, 2026

In the morning, you investigated billing webhook failures in staging
and traced them to an HMAC secret key mismatch after the production
key rotation. The staging config at `/etc/billing/webhook.conf`
needed manual updating — there's no automated sync (JIRA-4521 filed).

In the afternoon, you reviewed the auth service migration PR (#2847)
and identified a missing index on the sessions table that would cause
slow lookups under load. Left review comments and discussed with the
platform team in #auth-migration.

You also had a short session exploring the notification service
architecture for the first time, mapping out the dependency on the
shared event bus and noting that it uses the same retry configuration
as billing.
```

### User Notes (`notes/{note-id}.md`)

User-authored markdown files. The system never modifies these. Optionally tagged with topics in frontmatter for cross-referencing in Encyclopedia view. If opted in for ingestion, the Reflector can extract knowledge from the note and route it to topic pages, but the note itself remains immutable.

```markdown
---
id: note-001
title: "Auth service quirks"
created: 2026-03-19
topics: ["auth-service"]
ingest: true
starred: false
---

The auth service docs say tokens expire after 24 hours but in practice
the refresh endpoint returns a new token with a 48-hour TTL. Sarah on
the platform team confirmed this is intentional but undocumented.
Don't trust the docs on token TTL.
```

---

## Session Note Lifecycle

### Automatic Updates (Periodic Job)

The periodic job checks all known session transcript files for new activity by comparing file modification times against the last processed offset stored in `state.json`. For each modified transcript, it reads from the last offset onward and generates or extends the session note.

```
Periodic job fires (every 4 hrs / on launch / manual)
        │
        ▼
For each session transcript with new content since last offset:
        │
        ▼
Read transcript from last_offset onward
        │
        ▼
Generate/extend session note:
  - If no note exists: create new note from transcript chunk
  - If note exists: append new knowledge to existing note
  - If different day from last update: add date header
  - Annotate any invalidated content with [INVALIDATED {date}: ...]
  - If same fact invalidated twice: rewrite cleanly (no nesting)
  - Never remove valid existing content (append-only)
  - Skip if user_edited: true (only manual snapshot can update)
        │
        ▼
Update SQLite sessions table with current abstract and metadata
Update state.json with new offset
```

### Manual Snapshot (`cm_snapshot`)

Agent or user triggers `cm_snapshot` during a session. The agent writes the session note from its current context window, producing a richer note than the async job because it has synthesized understanding, not just raw transcript. Follows the same append-and-annotate rules.

### Session Note Generator Specification

The session note generator is the most critical LLM call in the pipeline — it's the compression boundary where information either survives or dies. Every downstream artifact (diary entries, knowledge pages, bullets, digests) is derived from session notes. A bad note generator produces a bad everything.

**Prompt framing:** "Write for someone who needs to pick up this work tomorrow. Include the specific details they'd need — paths, configs, error messages, ticket numbers — not the process of how you found them."

**Inclusion criteria:**
- **Always include:** Specific facts discovered (config paths, error messages, root causes, API endpoints), decisions made and rationale, things that contradicted expectations, concrete outcomes, external references (JIRA tickets, PRs, doc links, Slack threads, people mentioned by name)
- **Include if instructive:** Dead ends that taught something ("initially suspected retry logic, was actually HMAC key mismatch") — these prevent future agents from repeating the same investigation
- **Omit:** Iterative debugging steps that didn't lead anywhere, routine code generation output, tool invocation details, meta-conversation about approach, the code itself (capture *what* was built and *why*, not the implementation listing)

Borrow CASS diary prompt language: "Be SPECIFIC and ACTIONABLE. Avoid generic statements like 'wrote code' or 'fixed bug'. Include specific file names, function names, error messages, commands run."

**Multi-topic sessions:** One note per session, multiple topics in `topics_touched` frontmatter. Use section headers within the note for different work streams. The Reflector handles routing knowledge to the correct topic pages — that's its job, not the note generator's.

**Appending to existing notes:** When the periodic job extends a note from new transcript content, the generator reads the **full existing note** as context. This allows it to:
- Know exactly what's already been covered and avoid redundancy
- Reference earlier findings naturally ("as identified earlier, the HMAC key was the root cause")
- Detect when new content contradicts what was already noted
- Maintain narrative coherence across appends

The prompt for appends: "Here is the session note so far and new transcript content. Append only what is genuinely new. Reference earlier findings where relevant. Do not repeat what is already covered."

Each append starts with a context resumption sentence: "Continuing investigation into billing webhook failures." Regenerate the frontmatter `abstract` after each append to cover the full note.

**Invalidation:** The session note generator does NOT annotate invalidations in the note. Invalidation is a nuanced judgment (was the old claim wrong, or did circumstances change?) that should not be automated at the note generation stage. Instead:
- The generator always appends new information as new sections
- The Validator detects contradictions between new and existing content during reflection
- Contradictions surface in the review queue for the user to decide
- Exception: if the transcript itself contains an explicit self-correction ("actually, I was wrong earlier — the issue is X not Y"), the generator captures the correction because the user already made the call

**No minimum session threshold.** Short sessions can contain the highest signal-to-noise ratio facts ("auth tokens expire after 48 hours despite docs saying 24"). Short transcript = cheap note generation. If a session is truly empty, the generator produces a one-line note, the diary is thin, the Reflector extracts nothing. The pipeline handles it naturally with no special casing.

**Reflector extraction filter:** Even though all sessions produce notes, the Reflector prompt includes criteria for what's worth extracting into knowledge pages: "Only extract knowledge that would be valuable to a future agent working on this codebase. Skip ephemeral facts (locally installed versions, current environment state, one-off debugging output) and information only relevant to a specific moment in time."

### Reflection Pipeline

```
Session notes marked processed: false
        │
        ▼
Generate diary entry from session note (cheap LLM call,
structured JSON, follows CASS DiaryEntry schema)
        │
        ▼
Reflector Call 1 — Structural/Extractive:
  Input: diary entry + existing topics + existing playbook
  Produces:
    1. Playbook bullet proposals (terse rules)
    2. New topic suggestions (when knowledge doesn't fit existing topics)
        │
        ▼
Reflector Call 2 — Generative/Narrative:
  Input: diary entry + session note + existing knowledge pages for relevant topics
  Produces:
    3. Knowledge page additions (verbose prose, routed to matching topics)
    4. Daily digest content (chronological narrative summary)
        │
        ▼
Validator checks proposals (three-source evidence model):
  - Search full session note text for SUCCESS/FAILURE patterns
  - Search knowledge pages via semantic.ts embeddings for contradictions
  - Search SQLite fts_transcripts for primary-source evidence (when available)
  - Source count heuristic: N≥3 independent sessions → higher base confidence
  - Contradicts existing knowledge? → flag as uncertain, review queue
  - Supported by multiple sessions? → assign verified confidence
  - Single source, no contradictions? → assign inferred confidence
        │
        ▼
Curator applies deterministically:
  - Dedup bullets via Jaccard similarity (existing CASS logic)
  - Dedup knowledge sections by source session ID (same source → semantic dedup,
    different sources → always keep both, user merges via review queue)
  - Append knowledge sections to topic pages with confidence metadata
  - Write/update daily digest
  - Add topic suggestions to topics.json (source: "system")
  - Record outcome tracking metadata
  - Mark session note as processed: true
```

---

## cm_context: How New Sessions Get Knowledge

```
Agent calls cm_context(task: "fix billing webhook auth in production")
        │
        ▼
Single pass — no LLM, all local computation:
  - SQLite FTS query across knowledge pages, session notes, digests
  - Text match task description against topic names + descriptions
  - Text match against playbook bullet content
  - Semantic similarity via semantic.ts embeddings (local, no API cost)
  - Include unprocessed session notes (full text, not just abstract —
    these haven't been through the Reflector yet, so the full note is the
    only way to access recently discovered facts before the next periodic job)
  - Rank all candidates by combined FTS + semantic score
  - Return top-15 results
        │
        ▼
Assemble response:
  {
    playbook_bullets: [...],           # 5-15 relevant rules (~500 tokens)
    topic_excerpts: [                   # relevant knowledge page section previews (~500 tokens)
      { topic: "Billing Service",
        sections: ["Webhook Configuration (first line...)", "Retry Logic (first line...)"] }
    ],
    related_topics: [...],              # from similar.ts — "Auth Service", "API Gateway"
    recent_sessions: [                  # unprocessed full session notes (~1000-3000 tokens)
      { date: "2026-03-20", note_text: "...", id: "..." }
    ],
    suggested_deep_dives: [             # pointers for full content retrieval via cm_detail
      "knowledge/billing-service.md#webhook-configuration",
      "session-notes/session-2026-03-20-001.md"
    ]
  }
        │
        ▼
Total initial hydration: ~1500-2500 tokens (higher due to full unprocessed notes)
Agent can call cm_detail(path) for any deep dive item to get full content on demand
Zero LLM cost per retrieval — pure local computation.
```

**Deferred to v2: LLM selection pass.** When content volume grows (hundreds of knowledge sections), add a lightweight LLM call that filters and annotates results with relevance explanations ("this section describes the exact config path you'll need to modify"). For v1's content volume, FTS + semantic ranking is sufficient and avoids the risk of a feedback loop where bad LLM selections → bad sessions → bad knowledge → worse selections.

### cm_search: Direct Knowledge Base Search

Used by the Electron app's search bar and by agents that want to find specific content without the task-oriented framing of `cm_context`. Takes a query string and queries SQLite FTS5 across all content (knowledge pages, session notes, digests, user notes), then supplements with `semantic.ts` embeddings for conceptual matches. Returns ranked results with titles, document type badges, and snippet previews. No LLM call — pure FTS + vector matching for instant results.

**Transcript fallback:** When curated results are insufficient or the query looks like a literal string (error message, config value, function name), `cm_search` falls through to `fts_transcripts` for raw transcript matches. Transcript results are ranked below curated content and visually distinct — the user should feel the difference between "the system knows this" and "this was mentioned once in a conversation three weeks ago."

### cm_feedback: Record Helpful/Harmful Signals

Records whether a knowledge page section or playbook bullet was helpful or harmful in the current session. Maps to `outcome.ts` tracking. When the agent discovers a knowledge page section was wrong or misleading, it calls `cm_feedback(path, section, "harmful", reason)`. When a section was critical to solving the problem, `cm_feedback(path, section, "helpful")`. Feeds into confidence adjustments: helpful signals boost confidence over time, harmful signals flag items for the review queue.

---

## Electron App

### Markdown Rendering & Editing

All content rendered using **react-markdown** with **remark-gfm** for GitHub-flavored markdown (tables, strikethrough, task lists) and **rehype-highlight** for syntax highlighting in code blocks.

Every markdown document has a **toggle between rendered view and edit mode**. Rendered view is the default — clean, formatted, readable. Edit mode swaps to a text editor showing raw markdown. Save writes back to the file on disk.

**All files are editable by the user**, including system-generated content (knowledge pages, session notes, digests). When a user edits a session note, `user_edited: true` is set in frontmatter, preventing the periodic job from overwriting their changes. For knowledge pages, user edits are safe because the Curator only appends — it never rewrites existing content.

### Layout
```
┌─────────────────────────────────────────────────────────────┐
│  [Search bar — instant FTS + semantic search]               │
├────────────┬────────────────────────────────────────────────┤
│            │                                                │
│  Sidebar   │            Main Content Area                   │
│            │                                                │
│ Encyclopedia│  Rendered markdown with:                      │
│   Topic A  │  - Confidence indicators (●/○/◐)              │
│   Topic B  │  - Source links                                │
│   Topic C  │  - Temporal annotations                        │
│   Topic D  │  - Section-level action toolbar:               │
│            │    [Verify] [Invalidate] [Flag] [Star]         │
│ Recent     │                                                │
│   Today    │  Invalidate action opens dialog:               │
│   Yesterday│  "Why is this incorrect?" → reason text field  │
│   Mar 18   │  → wraps section in [INVALIDATED] annotation   │
│            │                                                │
│ Starred    │  Edit mode (toggled):                          │
│   ★ Item 1 │  - Raw markdown editor                         │
│   ★ Item 2 │  - Save/cancel buttons                         │
│            │                                                │
│ My Notes   │                                                │
│   Note 1   │                                                │
│   + New    │                                                │
│            │                                                │
│ ───────    │                                                │
│ Review (3) │                                                │
│            │                                                │
├────────────┴────────────────────────────────────────────────┤
│  [Claude dialog — natural language queries + /commands]     │
└─────────────────────────────────────────────────────────────┘
```

### Sidebar Tabs

**Encyclopedia** — Knowledge pages listed flat and alphabetically with a filter/search bar at top. Clicking a topic shows its knowledge page in the main area. No sub-hierarchy, no lenses in v1.

**Recent** — Daily digests in reverse chronological order. Clicking a day shows that day's digest. Can expand to see individual session notes from that day. Provides a chronological work journal.

**Starred** — User-pinned items (any knowledge page, session note, or user note). One-click star/unstar from any content view.

**My Notes** — User-authored markdown notes. Create (+ New button), edit, delete. Never modified by the system. Optionally tagged with topics for cross-referencing in Encyclopedia view.

**Review queue** — Badge count showing items needing attention:
- System-suggested topics awaiting approval (from topics.json where source: "system")
- Knowledge sections flagged as uncertain by the Validator
- Stale bullets identified by `stale.ts`
- Items manually flagged by the user
- Items with category mismatches detected by `rule-validation.ts`
- Knowledge pages exceeding bloat threshold (~5000 words) with suggestion to consolidate
- Each item includes a confidence explanation from `why.ts` — "why is this flagged?" and what would resolve it
- Triage actions: approve, reject, edit, dismiss
- Implementation: dynamically assembled by scanning topics.json, knowledge page confidence metadata, and playbook state via SQLite queries. No separate data store needed.

### Search

**Fast search bar** (top of app) — SQLite FTS5 search across all content (knowledge pages, session notes, digests, user notes, raw transcripts), supplemented by `semantic.ts` embeddings for conceptual matching. Instant results as you type (FTS is fast). Semantic results appear with a slight delay. Each result shows title/first line, document type badge (knowledge/session/note/digest/transcript), and source info. Transcript results ranked below curated content, behind an expandable "search raw transcripts" section. Click to navigate.

**Claude dialog** (bottom of app) — Natural language queries for synthesis. Connected to MCP server. "How does data flow from billing to the notification service?" → Claude traverses knowledge base via cm_context and cm_detail, composes answer with citations.

**Slash commands** in dialog: `/reflect` (trigger reflection now), `/snapshot` (trigger session note update), `/topic add [name] [description]` (create topic), `/status` (system health), `/undo` (rollback last reflection).

**Related Topics panel** — When viewing a knowledge page, a sidebar panel shows related topics discovered via `similar.ts` semantic search. "This page is related to: Auth Service, API Gateway, Deployment." Zero new code — `similar.ts` already does semantic similarity across playbook bullets; point it at knowledge page sections instead.

**Undo as first-class UI surface** — `undo.ts` (481 lines) has full snapshot/restore with history. For a periodic background job that runs unsupervised daily, automatic pre-reflection snapshots + one-click rollback is a key trust-building feature. Show last reflection timestamp, "Undo last reflection" button, and "Run Reflection Now" button prominently, not buried in slash commands.

### User Actions on Content

Available on all content views via a section-level action toolbar (appears on hover or persistently at section headers):

- **Verify** — bumps confidence to "verified" in the section's metadata comment. For playbook bullets, records helpful feedback via `outcome.ts`. One click, no dialog.
- **Invalidate** — opens a small dialog: "Why is this incorrect?" with a text field. On submit, wraps section in `[INVALIDATED {date}: {reason}]` annotation. For playbook bullets, records harmful feedback. For deeper corrections, user can ask Claude via the dialog bar to research and propose an update.
- **Flag** — adds a flag entry to the file's frontmatter; item appears in review queue. Optional reason in a dialog.
- **Star** — pins to Starred tab. Stored as `starred: true` in frontmatter. One click.
- **Edit** — toggles to raw markdown editor for the file. User edits tracked (`user_edited: true` for session notes).

---

## Periodic Background Job

### Trigger Conditions
- **Wall-clock timer:** every 24 hours, based on `lastRunTimestamp` in `state.json`
- **On app launch:** check `if (now - lastRunTimestamp > 24h)` — fires immediately if overdue (e.g., laptop was closed for 6 days → runs on first launch). This is a wall-clock check, not accumulated app-open time.
- **Manual button in Electron app:** prominent "Run Reflection Now" button in the UI, always available regardless of timer state. Equivalent to CLI `cm reflect`.
- **Manual CLI:** user runs `cm reflect` command
- **Never depends on cron or system scheduler** — runs inside the app process

The 24-hour cadence (vs the original 4-hour design) reflects how session notes are actually captured: agents call `cm_snapshot` during conversations, so notes accumulate throughout the day. One daily reflection pass processes all of them in batch, which is more cost-efficient (single preflight check, single index rebuild) and avoids partial-day knowledge fragmentation.

### Job Steps
```
0. PREFLIGHT — Run doctor health checks (via doctor.ts framework) to catch
   file corruption, missing directories, or stale indexes before doing work.
   Check LLM budget via cost.ts — if daily/monthly limit is reached, skip
   LLM-dependent steps (diary gen, reflection) and only run scan + index.

1. SCAN — Check all known session transcript files for modifications
   since last processed offset (stored in state.json)

2. UPDATE SESSION NOTES — For each modified transcript:
   - Read new content from last offset
   - Insert transcript chunk into SQLite fts_transcripts (same pass, same offset)
   - Skip if session note has user_edited: true (user can still manually
     trigger cm_snapshot to append, but automatic updates are paused to
     protect user-authored content)
   - If note exists: append new knowledge with date headers if day changed,
     annotate invalidations with date stamps (with effective_date)
   - If no note exists: create new one
   - All writes use withLock() + atomicWrite() for Electron safety
   - Update SQLite sessions table with current abstract and metadata
   - Update state.json offset

3. GENERATE DIARY ENTRIES — For each session note with processed: false:
   - Generate structured diary entry from session note (cheap LLM call)
   - Store in diary/ directory (internal, not user-facing)

4. REFLECT — For each new diary entry:
   - Snapshot playbook + knowledge pages via undo.ts (pre-reflection safety)
   - Reflector Call 1: structural/extractive (bullets + topic suggestions)
   - Reflector Call 2: generative/narrative (knowledge prose + digest)
   - Run Validator (three-source evidence: full session notes + knowledge pages +
     SQLite fts_transcripts; source count heuristic for multi-attestation)
   - Run Curator (deterministic merge into playbook, knowledge pages, digest files;
     source-session-ID dedup for knowledge sections)
   - Mark session note as processed: true
   - Log Reflector quality telemetry: ratio of Curator-accepted vs rejected deltas
     (spike in rejection rate = early warning of Reflector behavior change)

5. INDEX — Update SQLite FTS search index:
   - Re-index modified knowledge pages, session notes, digests
   - Invalidate embedding cache entries for files with modification times
     newer than their cache timestamps (prevents stale semantic search results)

6. CLEANUP — Prune stale system-suggested topics ignored for 30+ days.
   Surface knowledge pages exceeding ~5000 words in review queue with
   suggestion to consolidate.
   Apply tiered transcript retention: transcripts >30 days old are
   re-indexed at paragraph-level granularity (instead of chunk-level)
   to keep fts_transcripts query performance bounded as the corpus grows.
   A year of heavy use (~250M tokens of raw transcript) stays searchable
   without degrading FTS5 latency.
```

### Token Cost Estimate (per run)
- Session note generation from transcript: ~500 output tokens per session with new activity
- Diary entry from session note: ~300 input + ~200 output tokens per session
- Reflector Call 1 (structural): ~600 input + ~400 output tokens per session
- Reflector Call 2 (narrative): ~800 input + ~600 output tokens per session
- Validator: ~500 tokens per session (semantic search is local, only LLM call for ambiguous cases)
- Curator: zero LLM tokens (deterministic)
- Semantic embeddings: zero API tokens (local model via Transformers.js)
- SQLite indexing: zero API tokens (local)
- **Estimated total per daily run (5 active sessions): ~15,000-22,000 tokens**
- Compare to: re-reading full documentation from scratch each session (50,000-200,000 tokens)
- With 24-hour cadence, cost is predictable: one run per day, budget consumed in a single batch
- Budget guardrail: configurable daily/monthly limit via `cost.ts` (default $0.50/day, $10.00/month). Job skips LLM steps if budget exceeded. Manual "Run Reflection Now" button respects the same budget.

---

## What We're Taking From Where (V1)

| Concept | Source | V1 Implementation |
|---------|--------|-------------------|
| Reflector/Validator/Curator pipeline | **CASS** | Reused, Reflector split into two calls (structural + narrative) |
| Deterministic Curator (no LLM) | **CASS** | Reused, extended with knowledge page + digest delta types |
| Confidence decay + harmful weighting | **CASS** | scoring.ts reused directly (playbook bullets) |
| Anti-pattern inversion | **CASS** | Reused directly |
| Local semantic embeddings | **CASS** | semantic.ts with Transformers.js — local, zero API cost |
| MCP server | **CASS** | serve.ts reused and extended with new tools + resources |
| Context retrieval | **CASS** | context.ts extended with single-pass FTS + semantic ranking, SQLite-backed search |
| Type system (Zod schemas) | **CASS** | types.ts extended with new types |
| Config + sanitization + locking | **CASS** | Reused; locking extended to cover all knowledge base writes |
| LLM abstraction (Vercel AI SDK) | **CASS** | Reused directly |
| LLM budget tracking | **CASS** | cost.ts kept as guardrail for unsupervised periodic job |
| Outcome tracking | **CASS** | outcome.ts extended for knowledge page usefulness + inline feedback |
| Undo/rollback capability | **CASS** | undo.ts promoted to first-class UI surface (pre-reflection snapshots) |
| Diagnostics/repair | **CASS** | doctor.ts runs as preflight check before each periodic job |
| Stale detection | **CASS** | stale.ts feeds review queue |
| Gap analysis | **CASS** | gap-analysis.ts adapted for topic suggestion seeding |
| Semantic similarity | **CASS** | similar.ts powers Related Topics panel in UI |
| Confidence explanation | **CASS** | why.ts provides "why is this flagged?" in review queue |
| CLI entry point | **CASS** | cm.ts modified for new/removed commands |
| Session notes (append + annotate) | **Letta** (concept) | New — periodic + manual capture, append-only with annotations |
| Effective date on invalidations | **Zep/Graphiti** (concept) | New — lightweight bi-temporal: when fact was true vs when learned |
| User-defined topics with routing | **A-MEM** (concept) | New — topics guide the Reflector's output routing |
| System-suggested topics | **A-MEM** (concept) | New — Reflector proposes topics for unmatched knowledge |
| Topic cold-start content | **Original** | New — semantic search over existing content when topic created |
| Confidence tiers on knowledge sections | **Original** | New — verified/inferred/uncertain per section |
| Knowledge page prose generation | **Original** | New — Reflector produces verbose topic documents |
| Daily digests | **Original** | New — chronological narrative work journal |
| Single-pass context retrieval | **MAGMA** (concept, simplified) | FTS + semantic ranking, no LLM call. LLM selection deferred to v2. |
| Unprocessed note inclusion in context | **Original** | Full note text served before reflection runs (not just abstracts) |
| Reflector prompt guardrail | **Original** | Primary-source anchoring prevents prose drift from self-generated context |
| Drift telemetry | **Original** | Semantic similarity monitoring flags echo/drift in new sections |
| SQLite FTS5 search index | **Original** | New — derived index over all content including raw transcripts |
| Source-session-ID dedup | **Advisor** | New — conservative prose dedup avoids silent info loss |
| Split Reflector (two calls) | **Advisor** | New — separate structural/extractive from generative/narrative |
| Reflector quality telemetry | **Advisor** | New — acceptance/rejection ratio as early warning |
| Stable section IDs (atomic claims path) | **Reviewer** | New — `sec-xyz` IDs on sections for future decomposition |
| Session note generator specification | **Reviewer** | New — inclusion criteria, full-note context, multi-topic handling, no auto-invalidation |
| Full note text for unprocessed sessions | **Reviewer** | New — cm_context serves full notes, not just abstracts, before reflection |
| Tiered transcript retention | **Reviewer** | New — 30-day full resolution, older at paragraph-level |

---

## Build Sequence

### Phase 1: Fork + Strip + Data Foundation
**Goal:** Clean fork with extended type system and SQLite search infrastructure. Existing tests pass.

**Step 1 — Delete modules and clean up imports (atomic commit)**
- Delete source files: trauma.ts, trauma_guard_script.ts, starters.ts, onboard-state.ts, commands/guard.ts, commands/starters.ts, commands/quickstart.ts
- Delete test files: trauma.test.ts, trauma-guard-script.test.ts, cli-trauma.e2e.test.ts, cli-guard.e2e.test.ts, starters.test.ts, cli-starters.e2e.test.ts, quickstart.test.ts, cli-quickstart.e2e.test.ts, onboard-state.test.ts
- Surgery on cm.ts: remove 4 imports (lines 19-20, 28-29), remove command registrations (starters, quickstart, guard, trauma), remove audit --trauma option (lines 507, 514-515), update hasJsonFlag() Set, update help text
- Surgery on commands/init.ts: remove imports from guard.ts, trauma.ts, starters.ts; remove guard installation prompts, trauma scanning, starter seeding flows. Keep core init (directories, config, playbook).
- Surgery on commands/audit.ts: remove scanForTraumas import and --trauma mode
- Surgery on commands/context.ts: remove loadTraumas/findMatchingTrauma import and "Pain Injection" trauma warning (lines 554-585)
- Fix test files: commands-basic.test.ts, cm.test.ts, cli-audit.e2e.test.ts, cli-onboard.e2e.test.ts — remove references to deleted modules
- **Checkpoint:** `bun test` passes with no references to deleted modules

**Step 2 — Rename paths (atomic commit)**
- utils.ts: `~/.memory-system` → `~/.memory-system` (line 1071 + all other references), `.cass/` → `.memory-system/` in resolveRepoDir
- config.ts: `~/.memory-system/config.json` → `~/.memory-system/config.json` (lines 162, 303), `.cass/config.*` → `.memory-system/config.*` (lines 128-130)
- types.ts ConfigSchema: update playbookPath and diaryDir defaults
- Update ensureGlobalStructure() subdirectories to include new dirs: session-notes/, knowledge/, digests/, notes/
- **Checkpoint:** `bun test` passes, paths are consistent

**Step 3 — Add new types (atomic commit)**
- Add new Zod types to types.ts: SessionNote, KnowledgePage, Topic, DailyDigest, TopicSuggestion
- Add new delta types: KnowledgePageDelta, DigestDelta, TopicSuggestionDelta
- Update ConfigSchema with new fields for periodic job interval, knowledge base settings
- Change semanticSearchEnabled default from false to true
- **Checkpoint:** types compile, existing tests pass

**Step 4 — Implement search.ts and directory structure (atomic commit)**
- Create src/search.ts (~200-300 lines): SQLite FTS5 module with schema creation, indexing, and query functions
- Create runtime directory structure helper for new file types
- **Checkpoint:** SQLite creates tables, basic indexing and query tests pass

**cass.ts approach — DO NOT STUB.** The cass binary is already optional — the codebase has graceful degradation everywhere (safeCassSearch, handleSessionExportFailure, handleCassUnavailable). Leave cass.ts untouched in Phase 1. The binary calls become naturally dead code as replacements (search.ts SQLite FTS, direct file reading) come online in later phases. Clean up in a later phase once nothing needs the binary path.

### Phase 2: Session Note Generation
**Goal:** Raw transcripts produce human-readable session notes. The compression boundary works.

- Implement session note generation from transcript (offset-based reading, append-and-annotate, temporal markers with effective_date)
- Implement periodic transcript scanner (check modification times, read from offset, insert chunks into fts_transcripts)
- Implement `cm_snapshot` MCP tool in serve.ts
- Write and iterate on the session note generator prompt (see Session Note Generator Specification)
- **Checkpoint:** feed real Claude Code session transcripts through the generator, manually review note quality. This is the most important checkpoint — if notes are bad, everything downstream is bad. Iterate on the prompt until notes capture the right level of detail.

### Phase 3: Reflection Pipeline
**Goal:** Session notes flow through diary → Reflector → Validator → Curator and produce knowledge pages + bullets.

#### Implementation Decisions (decided 2026-03-23)

**Knowledge page section metadata format: HTML comments.**
Analyzed 6 alternatives (HTML comments, YAML per section, custom markdown syntax, `<details>` tags, sidecar JSON, heading attributes). HTML comments win on: invisible rendering in all markdown renderers (`react-markdown`, GitHub, Obsidian), simple regex parsing (~30 lines, isomorphic to `parseSessionNote`), roundtrip safety, zero new dependencies, extensibility via `| new_field: value`. One hardening: parser scans forward up to 3 lines past heading for the metadata comment (handles blank lines users may insert). `related_bullets` stored as comma-separated, not YAML array.

```markdown
## Section Title
<!-- id: sec-a1b2c3d4 | confidence: verified | source: session-2026-03-20-001 | added: 2026-03-20 | related_bullets: b-20260320-x7k,b-20260321-abc -->

Section prose content here.
```

**Orchestrator strategy: Modified Option A (in-place refactor with surgical seams).**
Analyzed 3 approaches (in-place refactor, parallel function, pipeline architecture extraction). In-place wins because: (a) any session generating both playbook bullets and knowledge sections must go through a single pipeline run — two functions means double LLM cost or split-brain, (b) reflect.ts and curate.ts have zero cass imports already, (c) diary.ts already has `generateDiaryFromContent()` as a clean binary-free seam, (d) all 3 orchestrator tests use `options.session` direct injection + `CASS_MEMORY_LLM=none` so they're unaffected by discovery/LLM path changes.

Build order (each step is additive until Step 4):
1. Add `generateDiaryFromNote()` in diary.ts — new function, zero test impact
2. Add `evidenceCountGateFromNotes()` in validate.ts — new code path gated on searchDbPath, zero test impact
3. Add `reflectOnSessionTwoCalls()` in reflect.ts — new function alongside existing, zero test impact
4. Modify `orchestrateReflection()` to wire the new functions together — targeted test impact

**Prompt strategy: draft multiple options per LLM call, review with user, iterate.**

#### Build Steps

- Extend types.ts with Reflector output schemas (`ReflectorCall1OutputSchema`, `ReflectorCall2OutputSchema`, `DiaryFromNoteOutputSchema`, `ReflectorQualityTelemetrySchema`)
- Implement `generateDiaryFromNote()` in diary.ts (reads session note, calls `generateDiaryFromContent` seam)
- Add diary-from-note prompt + LLM function in llm.ts (`diaryFromNote` prompt, `extractDiaryFromNote()`)
- Split Reflector into two calls in reflect.ts:
  - `reflectOnSessionTwoCalls()` orchestrates both calls
  - Call 1: structural/extractive (bullets + topic suggestions)
  - Call 2: generative/narrative (knowledge page prose + digest content, with prompt guardrail)
- Add two new prompts + LLM functions in llm.ts (`reflectorCall1`, `reflectorCall2`)
- Extend Validator in validate.ts with three-source evidence model:
  - Source 1: Full session note text (SUCCESS/FAILURE patterns)
  - Source 2: Knowledge page semantic search via semantic.ts
  - Source 3: SQLite fts_transcripts (when available)
  - Source count heuristic: N≥3 independent sessions → higher base confidence
- Extend Curator in curate.ts with new delta handlers:
  - `knowledge_page_append`: append section to topic page with HTML comment metadata + stable `sec-{id}` IDs, source-session-ID dedup
  - `digest_update`: write/append to daily digest file
  - `topic_suggestion`: add to topics.json with source: "system"
- Implement knowledge page file I/O: parser (heading + HTML comment scan, 3-line lookahead), serializer, read/write with `withLock()` + `atomicWrite()`
- Wire orchestrator.ts: replace cass-dependent discovery/export/diary/reflection/validation with session-note-based equivalents, add knowledge delta routing + merge, add preflight budget check, SQLite re-indexing, quality telemetry logging, drift detection, embedding cache invalidation
- All file writes use withLock() + atomicWrite()
- Tests for each new function + integration test for full pipeline
- **Checkpoint:** end-to-end — session transcript → session note → diary entry → reflection → knowledge page + playbook bullet. Manually review knowledge page prose quality and bullet relevance.

### Phase 4: Context Retrieval + Topic System
**Goal:** `cm_context` serves relevant knowledge to new sessions. The memory loop is closed.

- Implement topics.json management (add, remove, list, user vs system source)
- Implement topic cold-start: semantic search over existing content when new topic created, suggest via review queue
- Extend cm_context in context.ts: SQLite FTS query, topic/knowledge page section previews, semantic matching, related topics via similar.ts, full text for unprocessed session notes
- Implement `cm_detail` tool in serve.ts
- Add MCP resources: cm://knowledge/{topic}, cm://digest/{date}
- Single-pass retrieval: FTS + semantic ranking, return top-15 (no LLM call)
- Wire SQLite indexing into periodic job
- Implement periodic job timer (24-hour wall-clock interval + on-launch catch-up check) with budget guardrails via cost.ts
- Add "Run Reflection Now" manual trigger (Electron button + CLI `cm reflect`)
- **Checkpoint:** call cm_context with a task description, verify relevant knowledge returned across all layers including transcript fallback. Start a new Claude Code session, verify the agent receives useful context from previous sessions.

### Phase 5: Electron App
**Goal:** Human-readable UI for browsing, searching, editing, and reviewing the knowledge base.

- Scaffold Electron app with `--json` CLI flag as primary data API (lower integration surface than full MCP client)
- Install react-markdown + remark-gfm + rehype-highlight
- Build fast search bar: SQLite FTS5 queries via better-sqlite3 (in-process, sub-100ms), instant results. Transcript results behind expandable section.
- Build sidebar: Encyclopedia (topics list with filter), Recent (digests + session notes), Starred, My Notes (+ New), Review queue (badge count with why.ts explanations)
- Build main content renderer: formatted markdown with confidence indicators, source links, section-level action toolbar, Related Topics panel (via similar.ts)
- Build invalidation dialog (text field for reason + optional effective_date)
- Build edit mode toggle: rendered view ↔ raw markdown editor, save/cancel
- Build user notes: create, edit, delete, optional topic tagging
- Build Claude dialog bar: text input that calls MCP server
- Build review queue view: system-suggested topics + uncertain items + stale bullets + bloated pages + approve/reject/edit/dismiss
- Build undo UI: last reflection timestamp + "Undo last reflection" button (prominently visible, not just in slash commands)
- Wire up all user actions: verify, invalidate, flag, star, edit
- **Checkpoint:** open Electron app, verify content is searchable and browsable, test edit mode, review queue actions work.

### Phase 6: Integration Testing
**Goal:** Full loop validated with real usage.

- Run several real Claude Code sessions using the system
- Verify session notes get created automatically by periodic job
- Verify transcript chunks indexed in SQLite fts_transcripts
- Trigger reflection, verify knowledge pages and digest generated (two Reflector calls)
- Check Reflector quality telemetry logged (acceptance/rejection ratio + drift detection)
- Open Electron app, verify content is searchable and browsable (including transcript fallback)
- Test edit mode on knowledge pages and user notes
- Review queue: approve a system-suggested topic, verify a knowledge section, check why.ts explanation
- Start new session, verify cm_context returns knowledge from previous sessions including semantic matches
- Verify unprocessed session notes served as full text in cm_context (not just abstracts)
- Test undo after a bad reflection (via UI button)
- Create a new topic, verify cold-start semantic search suggests existing relevant content
- Verify budget tracking logged in cost-tracking.jsonl

---

## What V1 Does NOT Include (Deferred to V2+)

- **Atomic claims decomposition** — v1 stores knowledge as prose sections on topic pages (wiki model). Each section has a stable ID (`sec-xyz`) and cross-references to related bullets, preserving the migration path. V2 decomposes sections into atomic facts with typed relationships, where topic pages become views over a claim graph rather than containers. This enables cross-topic queries, automated consolidation, and the entity-centric architecture explored by Graphiti and AKGM.
- **Typed links between notes** — no knowledge graph edges, just topic routing (subsumed by atomic claims in v2)
- **Automated memory evolution** — Curator appends new sections but never rewrites existing prose. True revision of old content deferred to v2. Pages exceeding ~5000 words are surfaced in review queue for manual consolidation.
- **Source staleness detection** — no re-verification of external docs
- **Lenses** — deferred; flat topic list with filter is sufficient for v1
- **Full backfill job for new topics** — when a new topic is added, semantic search suggests existing relevant content (cold-start solution), but past sessions aren't re-processed through the Reflector. Full re-reflection backfill in v2.
- **Bi-temporal querying** — `effective_date` stored on invalidation annotations but not queryable temporally. Full Zep/Graphiti-style temporal queries in v2.
- **Project workspace scoping** — everything is global for v1
- **Multi-user / team sharing** — local single-user only. Cross-machine knowledge sharing would require playbook federation (the remote cass SSH pattern is a usable template) or shared storage backend. See Untapped CASS Features below for existing building blocks.
- **Company-specific fork** — generic first, fork later
- **Split-pane WYSIWYG markdown editor** — v1 uses toggle between rendered view and textarea. Milkdown or similar in v2.
- **Confidence decay on knowledge pages** — only playbook bullets decay in v1. Knowledge page staleness handled by contradiction detection and outcome tracking.
- **ChromaDB / external vector database** — semantic.ts with local embeddings + SQLite FTS5 is sufficient for v1 scale
- **Automated knowledge page consolidation** — v1 only appends; v2 adds LLM-powered section merging for bloated pages
- **cm_context LLM selection pass** — v1 uses single-pass FTS + semantic ranking (zero LLM cost, no feedback loop risk). V2 adds a lightweight LLM call that filters and annotates results with relevance explanations when content volume makes unfiltered results too noisy.
- **Confidence bridge (bullets ↔ prose)** — cross-references between playbook bullets and knowledge page sections that propagate invalidation/harmful signals. Deferred until both systems are running with real data to inform the linkage design.

---

## Risks to Monitor Post-Launch

### Reflector Quality Drift
The Reflector is the heart of the system, and its output quality will vary by LLM provider, model version, and prompt sensitivity. Two telemetry signals:

1. **Curator acceptance ratio:** After each reflection run, log the ratio of Curator-accepted vs Curator-rejected deltas. If rejection rate spikes (e.g., from 10% baseline to 40%+), something changed in the Reflector's behavior — model update, prompt regression, or data distribution shift.

2. **Prose drift detection:** After each Reflector Call 2 run, compute semantic similarity between each new knowledge section and all existing sections on the same topic page. If a new section is >0.9 similar to an existing section from a *different* source session, flag it — that's likely echo/drift rather than independent corroboration. The Reflector prompt guardrail ("your primary source is the session note, not the existing knowledge page") is the first line of defense; this telemetry detects when the guardrail isn't working.

### Knowledge Page Bloat
The Curator only appends, never rewrites. Over months, knowledge pages for active topics will grow long, with potentially redundant sections from different sessions that weren't caught by source-session-ID dedup (because they came from different sessions). Monitor page lengths. When a topic page exceeds ~5000 words, surface it in the review queue with a suggestion to consolidate. Automated consolidation is a v2 feature, but human-prompted consolidation is a v1 UI action.

### Embedding Cache Staleness
`semantic.ts` caches embeddings in `.embedding-cache.json`. When a knowledge page section is edited by the user or annotated as invalidated, the cached embedding for that section is stale. The periodic job invalidates cache entries for files with modification times newer than their cache timestamps. Otherwise semantic search returns results based on content that no longer exists in that form.

### SQLite Index Drift
If the Electron app or a user directly edits markdown files outside the periodic job cycle, the SQLite index becomes stale until the next job run. Mitigate by having the Electron app's save action also update the relevant SQLite rows (single-file reindex is cheap). Raw file reads remain the fallback for display — SQLite is never the source of truth.

### Budget Overruns on Large Session Backlogs
If the system hasn't run for several days, the next periodic job may find dozens of unprocessed sessions. With two Reflector calls per session, this can blow through the daily budget. The preflight budget check prevents overspending, but users may not understand why some sessions aren't processed. Surface "N sessions skipped due to budget limit" in the UI with guidance to increase the daily limit or run `/reflect` manually.

### Transcript Corpus Growth
A heavy user (10-15 sessions/day, enterprise SaaS context) generates ~250M tokens of raw transcript per year. FTS5 handles this volume, but query latency degrades past a few hundred thousand rows at fine chunk granularity. The tiered retention policy (30 days full resolution, older at paragraph-level) keeps this bounded. Monitor `fts_transcripts` row count and average query latency in telemetry.

### Knowledge Page as Wiki Anti-Pattern
Topic-scoped pages are essentially a wiki model. Technical knowledge doesn't always decompose cleanly into topics — a fact about webhook HMAC validation belongs to "Billing Service," "Security Practices," "Staging Environment," and "Deployment Gaps." The Related Topics panel and cross-references via `related_bullets`/`relatedSections` partially mitigate this. The stable section IDs (`sec-xyz`) preserve the option to decompose into atomic claims in v2 without losing provenance. If users report difficulty finding cross-cutting knowledge, that's the signal to accelerate the atomic claims migration.

---

## Untapped CASS Features to Leverage

These features already exist in the codebase and provide significant value with minimal or no new code:

### Cross-Agent Learning (Single-Machine)
CASS has a complete cross-agent privacy system: `crossAgent.enabled`, consent management, agent allowlists, audit logging in `privacy-audit.jsonl`, and related session discovery in `diary.ts`. When enabled, diary generation automatically searches for sessions from other agents (Claude, Cursor, Codex, etc.) on the same machine and attaches relevant snippets as `relatedSessions`. This means the Reflector can learn from all your agents, not just the one that produced the current session. Privacy controls: double-gate (enabled + consent), per-agent allowlist, audit trail. Surface the `cm privacy` commands in the Electron app settings.

### Cross-Machine Knowledge (Building Blocks)
CASS has SSH-based remote cass search: configure remote hosts in `config.remoteCass.hosts`, and `cm context` queries those machines in parallel via SSH, merging results by score. This currently searches raw sessions, not playbooks or knowledge pages. For true cross-machine knowledge sharing, the SSH transport pattern is a clean template — same mechanism, but run `cm playbook export --json` on the remote instead of `cass search`. Alternatively, shared storage (git repo, S3, shared drive) for the flat-file knowledge base is straightforward given the file-based architecture.

### `--json` Flag as Electron API
Every CLI command supports `--json` for structured output. Instead of building a full MCP client integration for the Electron app, shell out to the CLI with `--json` for data reads. This dramatically reduces the Electron integration surface and reuses all existing validation, error handling, and output formatting.

**Exception for search:** The search bar needs sub-100ms keystroke-driven results. CLI subprocess spawning adds ~50-100ms overhead per invocation, which is too slow for instant search. Use `better-sqlite3` (synchronous Node native binding) in-process for the Electron app's search queries. This is the one place where the Electron app bypasses the CLI and queries `search.db` directly.

### Inline Feedback Parsing
`outcome.ts` already parses `// [cass: helpful b-xyz] reason` comments from session transcripts. The orchestrator extracts these automatically during reflection. Instruct the agent (via system prompt) to emit these comments when using knowledge from `cm_context` — automatic feedback with zero user intervention. Extend the comment format for knowledge page sections: `// [memory: helpful knowledge/billing-service#webhook-config] saved 30 min`.

### Progress Reporting for Background Job
`progress.ts` has a `ProgressReporter` protocol. The periodic background job can emit progress events that the Electron app surfaces as a status indicator — "Reflecting on 3 sessions..." or "Indexing complete."