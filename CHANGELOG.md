# Changelog

All notable changes to **cass-memory** (`cm`) are documented in this file.

- Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)
- Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
- Repository: <https://github.com/Dicklesworthstone/cass_memory_system>
- Each release below that has a corresponding GitHub Release is marked with **(GitHub Release)**.
- Commit links point to `https://github.com/Dicklesworthstone/cass_memory_system/commit/<hash>`.

---

## [Unreleased] — since v0.2.3 (75 commits as of 2026-03-19)

Compare: [`v0.2.3...main`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.3...main)

### Added

- **Ollama LLM provider** — fourth provider alongside OpenAI, Anthropic, and Google, enabling fully local model inference ([`d5766ed`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d5766ed)).
  - `OLLAMA_HOST` env var support, `resolveOllamaBaseUrl` with env-over-config precedence ([`b7ee0dc`](https://github.com/Dicklesworthstone/cass_memory_system/commit/b7ee0dc), [`de1fb2a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/de1fb2a)).
  - Configurable `baseUrl` per provider in config ([`adbcce4`](https://github.com/Dicklesworthstone/cass_memory_system/commit/adbcce4)).
- **TOON output format** — token-optimized output for agents, reducing token consumption in structured responses ([`7dd4424`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7dd4424), [`5e4356a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5e4356a)).
  - `--format toon` support across context, doctor, and global error handling ([`9bab75f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/9bab75f), [`1ca0cf7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/1ca0cf7)).
- **Auto-record rule outcomes** — `cm reflect` now automatically records rule outcomes from processed sessions, closing the feedback loop without manual `cm mark` calls ([`80a4631`](https://github.com/Dicklesworthstone/cass_memory_system/commit/80a4631)).
  - False-positive and double-counting reduction ([`165bf64`](https://github.com/Dicklesworthstone/cass_memory_system/commit/165bf64)).
  - Filtering of internal/auto-generated session types ([`1ae63e6`](https://github.com/Dicklesworthstone/cass_memory_system/commit/1ae63e6)).
- **`playbook add --repo`** — add rules directly to workspace-level playbook ([`9c2b3b5`](https://github.com/Dicklesworthstone/cass_memory_system/commit/9c2b3b5)).
- **Claude Code SKILL.md** — automatic capability discovery for Claude Code agents ([`977a008`](https://github.com/Dicklesworthstone/cass_memory_system/commit/977a008)).
- Homebrew and Scoop package manager installation options in README ([`a6f01ba`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a6f01ba), [`a30c71f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a30c71f)).
- GitHub Actions: ACFS checksum dispatch and notification workflows ([`945cd0d`](https://github.com/Dicklesworthstone/cass_memory_system/commit/945cd0d), [`c6e5cba`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c6e5cba)).
- Comprehensive test suites for init, project, stale, privacy, guard, diary, trauma-guard, onboard, gap analysis, and serve/doctor commands.

### Fixed

- **Context command**: honor `minRelevanceScore` config, exclude embedding vectors from JSON output, correct workspace bullet filtering logic ([`4e8193b`](https://github.com/Dicklesworthstone/cass_memory_system/commit/4e8193b), [`19ce9ee`](https://github.com/Dicklesworthstone/cass_memory_system/commit/19ce9ee), [`46eeedd`](https://github.com/Dicklesworthstone/cass_memory_system/commit/46eeedd)).
- **Orchestrator**: ensure reflections directory exists before lock acquisition ([`7c4ef37`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7c4ef37)).
- **MCP server**: wrap `tools/call` responses in MCP-required content array ([`837a460`](https://github.com/Dicklesworthstone/cass_memory_system/commit/837a460)).
- **LLM**: deduplicate `LLMProvider` type, fix Ollama availability check ([`2bd55b3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2bd55b3)).
- Missing FTS table error handling ([`64d0feb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/64d0feb)).
- Playbook: show target playbook name in add success messages ([`29c3e04`](https://github.com/Dicklesworthstone/cass_memory_system/commit/29c3e04)).
- Guard/trauma-guard script invocation and error handling ([`7ec97d8`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7ec97d8), [`5eb8b2f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5eb8b2f)).
- MCP server docs: show HTTP transport instead of stdio ([`a08ac87`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a08ac87)).

### Changed

- License updated to MIT with OpenAI/Anthropic Rider ([`470d3fd`](https://github.com/Dicklesworthstone/cass_memory_system/commit/470d3fd)).
- CLI argument ordering improved for safety ([`f4f878c`](https://github.com/Dicklesworthstone/cass_memory_system/commit/f4f878c)).
- GitHub Actions: caching, timeouts, and workflow consolidation ([`113309d`](https://github.com/Dicklesworthstone/cass_memory_system/commit/113309d)).

---

## [0.2.3] — 2026-01-07 **(GitHub Release)**

Tag: [`v0.2.3`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.2.3) ·
Compare: [`v0.2.2...v0.2.3`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.2...v0.2.3)

### Added

- Unit tests for `infoCommand`, `validateDelta`, `examples.ts`, Codex CLI JSONL diary format ([`d6f57d9`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d6f57d9), [`cc9006f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/cc9006f), [`88bf9f1`](https://github.com/Dicklesworthstone/cass_memory_system/commit/88bf9f1), [`72948cf`](https://github.com/Dicklesworthstone/cass_memory_system/commit/72948cf)).
- E2E tests for diary, onboard, outcome, serve, validate, audit, undo commands ([`fbc1743`](https://github.com/Dicklesworthstone/cass_memory_system/commit/fbc1743), [`d7059ea`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d7059ea), [`dd68326`](https://github.com/Dicklesworthstone/cass_memory_system/commit/dd68326), [`b93cdfa`](https://github.com/Dicklesworthstone/cass_memory_system/commit/b93cdfa)).
- Diary: handle array content blocks in session formatting ([`2e8d31b`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2e8d31b)).

### Fixed

- **Guard installation**: require explicit user consent instead of auto-installing ([`13260e3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/13260e3)).
- **Security**: avoid static secret scanner false positives in source code ([`bfaa57b`](https://github.com/Dicklesworthstone/cass_memory_system/commit/bfaa57b)).
- Nested array content handling in `coerceContent`/`coerceRawContent` ([`701c4db`](https://github.com/Dicklesworthstone/cass_memory_system/commit/701c4db)).
- Validate optimization and multiple small improvements ([`3a1b9a4`](https://github.com/Dicklesworthstone/cass_memory_system/commit/3a1b9a4), [`e108758`](https://github.com/Dicklesworthstone/cass_memory_system/commit/e108758)).

### Changed

- Optimized `Map` update pattern to reduce redundant lookups ([`a204602`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a204602)).
- Expanded README documentation for undocumented features ([`6eb91ba`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6eb91ba)).

---

## [0.2.2] — 2026-01-05 **(GitHub Release)**

Tag: [`v0.2.2`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.2.2) ·
Compare: [`v0.2.1...v0.2.2`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.1...v0.2.2)

A focused patch release improving the curl-based installer.

### Fixed

- **Installer: redirect-based version resolution** — replaces GitHub API calls with HTTP redirect following (`/releases/latest` redirect), eliminating rate-limit failures and cross-platform `grep`/`sed` differences ([`c694251`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c694251)).
- **Installer: concurrent install lock** — lock file path was using PID expansion, creating per-process lock files that defeated concurrency protection; now uses static `/tmp/cass-memory-install.lock` ([`6bfdd6a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6bfdd6a)).

---

## [0.2.1] — 2026-01-02 **(GitHub Release)**

Tag: [`v0.2.1`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.2.1) ·
Compare: [`v0.2.0...v0.2.1`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.0...v0.2.1)

Major bug-fix and test-coverage release. Fixes critical `cm reflect` session discovery issues.

### Added

- **Trauma/guard system** — `cm guard` with pre-commit hook for trauma pattern detection, `heal`/`remove`/`import` subcommands ([`22b4f09`](https://github.com/Dicklesworthstone/cass_memory_system/commit/22b4f09), [`d3f9a95`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d3f9a95), [`79386e3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/79386e3)).
- `--info` flag for system diagnostics ([`86f9171`](https://github.com/Dicklesworthstone/cass_memory_system/commit/86f9171)).
- `--examples` global flag for curated workflow examples ([`8ba4e9a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/8ba4e9a)).
- `CASS_PATH` environment variable override for cass binary location ([`febe6d8`](https://github.com/Dicklesworthstone/cass_memory_system/commit/febe6d8)).
- `playbook add --repo` flag for workspace playbook targeting ([`6ac7ba7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6ac7ba7)).
- MCP: `memory_reflect` tool and `cm://stats` analytics resource ([`7e63df4`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7e63df4)).
- MCP: HTTP auth and hardened config against repo-level overrides ([`c6d165e`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c6d165e)).
- Onboard: `mark-done` updates reflection processed log ([`e98a5d2`](https://github.com/Dicklesworthstone/cass_memory_system/commit/e98a5d2)).
- Serve: richer delta info in MCP dry-run responses ([`6596deb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6596deb)).
- Comprehensive E2E and integration test suites across guard, trauma, progress, starters, validate, onboard, outcome, undo, info, usage, quickstart, context, doctor, mark, playbook, config cascade, pipeline, and reflect commands.

### Fixed

- **Critical**: `timeline.groups.flatMap` error in `cm reflect` — cass timeline returns groups as object, not array; also fixed `--since Nd` format ([`7390a7b`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7390a7b)).
- **Critical**: Codex CLI session parsing — handle nested `payload.content` format, fallback to direct JSONL when >50% UNKNOWN entries ([`7390a7b`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7390a7b)).
- Cass fallback session parsing: add size limit to prevent OOM ([`3b88720`](https://github.com/Dicklesworthstone/cass_memory_system/commit/3b88720)).
- Privacy: file locking for concurrent config access ([`0fe7523`](https://github.com/Dicklesworthstone/cass_memory_system/commit/0fe7523)).
- Lock: UUID-based ownership verification to prevent race conditions ([`2fcf92e`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2fcf92e)).
- Curate: prevent resurrection of deprecated/blocked rules, improve conflict detection ([`c6977e9`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c6977e9), [`63ee4c0`](https://github.com/Dicklesworthstone/cass_memory_system/commit/63ee4c0)).
- Curate: prevent array aliasing when inverting harmful rules to anti-patterns ([`6f27c44`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6f27c44)).
- Validate: count unique sessions instead of hits for evidence signals ([`27e09a2`](https://github.com/Dicklesworthstone/cass_memory_system/commit/27e09a2)).
- Outcome: idempotent feedback recording across replays ([`234bd6f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/234bd6f)).
- Security: validate SSH targets in `remoteCass` hosts, ReDoS protection for deprecated pattern matching ([`15b29a7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/15b29a7), [`c98994a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c98994a)).
- Mark: enforce exactly one of `--helpful` or `--harmful` ([`3b09ffb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/3b09ffb)).
- Budget: treat 0 limits as unlimited ([`50926df`](https://github.com/Dicklesworthstone/cass_memory_system/commit/50926df)).
- Various modules: use `getActiveBullets()` consistently for filtering ([`ad9f4f5`](https://github.com/Dicklesworthstone/cass_memory_system/commit/ad9f4f5)).

### Performance

- Curate: O(1) Map lookups for deduplication, pre-computed token sets ([`c2ac055`](https://github.com/Dicklesworthstone/cass_memory_system/commit/c2ac055), [`1fc6da0`](https://github.com/Dicklesworthstone/cass_memory_system/commit/1fc6da0)).
- Tracking: batch append for `ProcessedLog` entries ([`dcde300`](https://github.com/Dicklesworthstone/cass_memory_system/commit/dcde300)).
- Audit/trauma: batch operations optimization ([`fe98a72`](https://github.com/Dicklesworthstone/cass_memory_system/commit/fe98a72)).
- Onboard: parallelized session sampling ([`31e295a`](https://github.com/Dicklesworthstone/cass_memory_system/commit/31e295a)).
- Diary: scan workspace logs for faster diary lookup ([`dc4d5d5`](https://github.com/Dicklesworthstone/cass_memory_system/commit/dc4d5d5)).
- Sanitize: fast path for exact matches in `isSemanticallyBlocked` ([`3e8b97f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/3e8b97f)).
- Stats: improved merge candidate detection ([`237bc14`](https://github.com/Dicklesworthstone/cass_memory_system/commit/237bc14)).

### Changed

- Complete `toxic` to `blocked` terminology migration across codebase ([`2cc85a1`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2cc85a1)).
- Dead code removed from `curate.ts` and `semantic.ts` ([`a88f13d`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a88f13d)).
- Deprecated `--top` in favor of `--limit` and `--per-category` ([`6c10328`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6c10328)).
- Test coverage improvements:
  - `reflect`: 61% → 82%
  - `serve`: 52% → 68%
  - `context`: 52% → 86%
  - `playbook`: 63% → 81%
  - `top`: 60% → 100%

---

## [0.2.0] — 2025-12-15 **(GitHub Release)**

Tag: [`v0.2.0`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.2.0) ·
Compare: [`v0.1.1...v0.2.0`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.1.1...v0.2.0)

First feature release after the initial launch. Focused on agent-friendliness and remote cass support.

### Added

- **SSH-based remote cass search** — query a remote cass instance over SSH for cross-machine memory ([`2f6ab6d`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2f6ab6d), [`7ea47f3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7ea47f3)).
- **Agent-friendliness improvements** — consistent JSON errors, icon system, `printJsonResult()` standardization ([`a39d997`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a39d997), [`7bee59c`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7bee59c), [`de7dae1`](https://github.com/Dicklesworthstone/cass_memory_system/commit/de7dae1)).

### Fixed

- Config: block repo-level override of `crossAgent` and `remoteCass` security settings ([`4300912`](https://github.com/Dicklesworthstone/cass_memory_system/commit/4300912)).
- Context: keep `suggestedCassQueries` semantically pure ([`0d07524`](https://github.com/Dicklesworthstone/cass_memory_system/commit/0d07524)).
- Doctor: use category+item for precise check lookup ([`2fd2bdb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2fd2bdb)).
- Reflect: use defined `iconFor` function instead of inline duplicate ([`2d9ef7c`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2d9ef7c)).
- Merge delta ID propagation fix ([`48093ca`](https://github.com/Dicklesworthstone/cass_memory_system/commit/48093ca)).

### Changed

- Outcome: centralize sentiment detection ([`d01e5a5`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d01e5a5)).
- Undo: standardize JSON output to use `printJsonResult()` ([`5ebe73d`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5ebe73d)).

---

## [0.1.1] — 2025-12-15 **(GitHub Release)**

Tag: [`v0.1.1`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.1.1) ·
Compare: [`v0.1.0...v0.1.1`](https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.1.0...v0.1.1)

Quick follow-up to v0.1.0 with onboarding and CLI polish.

### Added

- **`cm onboard`** — agent-native guided onboarding command with subcommand pattern (`status`, `sample`, `read`, `mark-done`, `--fill-gaps`) ([`bcac363`](https://github.com/Dicklesworthstone/cass_memory_system/commit/bcac363), [`b577dc2`](https://github.com/Dicklesworthstone/cass_memory_system/commit/b577dc2)).
- **Playbook rule pre-add validation** with `--check` and `--strict` flags ([`6839910`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6839910)).
- Playbook `--session` flag support for single rule add ([`e95a5b7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/e95a5b7)).
- Solo-user workflow guidance in quickstart docs ([`0201162`](https://github.com/Dicklesworthstone/cass_memory_system/commit/0201162)).
- `HarmfulReason` enum values documented in `--help` ([`1404061`](https://github.com/Dicklesworthstone/cass_memory_system/commit/1404061)).

### Fixed

- Validate: remove hardcoded emoji, respect `CASS_MEMORY_NO_EMOJI` setting ([`44d9d39`](https://github.com/Dicklesworthstone/cass_memory_system/commit/44d9d39)).
- Onboard: remove fake stats, fix duplicate constant, improve extraction prompt ([`65eaf45`](https://github.com/Dicklesworthstone/cass_memory_system/commit/65eaf45)).
- Cass: handle wrapped JSON response format from cass search ([`633b349`](https://github.com/Dicklesworthstone/cass_memory_system/commit/633b349)).
- Doctor: show all available LLM providers; make LLM API key optional, not critical ([`8192677`](https://github.com/Dicklesworthstone/cass_memory_system/commit/8192677), [`6e97be4`](https://github.com/Dicklesworthstone/cass_memory_system/commit/6e97be4)).

### Changed

- Outcome command: converted required options to positional arguments ([`7832f13`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7832f13)).

---

## [0.1.0] — 2025-12-15 **(GitHub Release)**

Tag: [`v0.1.0`](https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.1.0) ·
Commits: [initial...v0.1.0](https://github.com/Dicklesworthstone/cass_memory_system/compare/7393dce...v0.1.0)

Initial public release. ~475 commits of development since 2025-12-07.

### Core Architecture

- **Three-layer cognitive memory model**: Episodic (cass search engine), Working (diary entries), Procedural (playbook bullets with confidence tracking).
- **ACE pipeline**: Automated Curation Engine — Generator, Reflector, Validator, Curator stages for transforming raw sessions into playbook rules.
- **Confidence decay algorithm** with configurable half-life, maturity transitions (emerging → established → proven), and per-event decayed-value weights ([`4745221`](https://github.com/Dicklesworthstone/cass_memory_system/commit/4745221), [`edb5315`](https://github.com/Dicklesworthstone/cass_memory_system/commit/edb5315)).

### CLI Commands

| Command | Purpose |
|---------|---------|
| `cm init` | Initialize cass-memory for a project |
| `cm context` | Get task-specific memory before starting work |
| `cm diary` | Cross-agent session enrichment and summaries |
| `cm reflect` | Run the ACE pipeline to distill rules |
| `cm validate` | Scientific validation of playbook integrity |
| `cm mark` | Record helpful/harmful feedback on rules |
| `cm audit` | Audit playbook for quality issues |
| `cm playbook` | CRUD operations, export/import, similarity search |
| `cm project` | AGENTS.md and claude.md export formats |
| `cm forget` | Deprecate toxic/blocked rules |
| `cm stats` | Playbook health metrics and staleness detection |
| `cm doctor` | System health checks with auto-fix |
| `cm top` | View most effective bullets |
| `cm stale` | Find bullets without recent feedback |
| `cm why` | Bullet provenance tracing |
| `cm similar` | Semantic duplicate detection |
| `cm undo` | Revert bad curation decisions |
| `cm usage` | LLM cost statistics |
| `cm serve` | MCP server with `memory://stats` resource |

### LLM Integration

- Multi-provider support: OpenAI, Anthropic, Google ([`bf154c7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/bf154c7)).
- `llmWithFallback` for multi-provider resilience ([`5a22ee5`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5a22ee5)).
- `llmWithRetry` with configurable retry policy ([`bc35704`](https://github.com/Dicklesworthstone/cass_memory_system/commit/bc35704)).
- Cost tracking and budget enforcement ([`2762b38`](https://github.com/Dicklesworthstone/cass_memory_system/commit/2762b38)).
- `handleMalformedLLMResponse` for robust error recovery ([`cdda4cb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/cdda4cb)).

### Safety & Security

- Secret sanitization module with ReDoS protection ([`7fd13d3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/7fd13d3), [`28f0544`](https://github.com/Dicklesworthstone/cass_memory_system/commit/28f0544)).
- `isSemanticallyToxic` / `isSemanticallyBlocked` for content filtering ([`fc0976c`](https://github.com/Dicklesworthstone/cass_memory_system/commit/fc0976c)).
- Cross-agent privacy controls with consent workflow ([`f19437f`](https://github.com/Dicklesworthstone/cass_memory_system/commit/f19437f)).
- `--dry-run` preview mode for destructive operations ([`51d2d69`](https://github.com/Dicklesworthstone/cass_memory_system/commit/51d2d69)).
- Atomic file writes with proper locking ([`fa90871`](https://github.com/Dicklesworthstone/cass_memory_system/commit/fa90871)).
- Input validation with type-safe sanitization ([`bdb17ee`](https://github.com/Dicklesworthstone/cass_memory_system/commit/bdb17ee)).

### Search & Retrieval

- Embedding-based semantic search infrastructure via `@xenova/transformers` ([`19774d0`](https://github.com/Dicklesworthstone/cass_memory_system/commit/19774d0)).
- Lazy model download with progress callback ([`4e60fd1`](https://github.com/Dicklesworthstone/cass_memory_system/commit/4e60fd1)).
- Graceful degradation when cass binary is unavailable ([`b252952`](https://github.com/Dicklesworthstone/cass_memory_system/commit/b252952)).

### Agent-First Design

- JSON output (`--json`) for all commands; stdout = data, stderr = diagnostics ([`b7e0568`](https://github.com/Dicklesworthstone/cass_memory_system/commit/b7e0568)).
- Implicit outcome feedback system for session outcomes ([`e35b076`](https://github.com/Dicklesworthstone/cass_memory_system/commit/e35b076)).
- Context usage logging for implicit feedback tracking ([`32dc3c7`](https://github.com/Dicklesworthstone/cass_memory_system/commit/32dc3c7)).
- Starter playbook seeding for quick onboarding ([`e2260ff`](https://github.com/Dicklesworthstone/cass_memory_system/commit/e2260ff)).
- Curate: conflict detection for contradictory playbook rules ([`108b675`](https://github.com/Dicklesworthstone/cass_memory_system/commit/108b675)).

### Infrastructure

- Commander-based CLI with dynamic version from `package.json` ([`eaa6dfd`](https://github.com/Dicklesworthstone/cass_memory_system/commit/eaa6dfd), [`d2332b1`](https://github.com/Dicklesworthstone/cass_memory_system/commit/d2332b1)).
- Comprehensive Zod schema system for all data models ([`9d229bb`](https://github.com/Dicklesworthstone/cass_memory_system/commit/9d229bb)).
- Cross-platform binary compilation (macOS arm64/x64, Linux x64, Windows x64) via GitHub Actions release workflow ([`9b37ce3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/9b37ce3)).
- Curl-based installer with `--easy-mode` and `--verify` flags ([`9b37ce3`](https://github.com/Dicklesworthstone/cass_memory_system/commit/9b37ce3)).
- Reflection orchestrator with file locking and session deduplication ([`a238b31`](https://github.com/Dicklesworthstone/cass_memory_system/commit/a238b31)).
- Usage analytics system ([`5dd6e15`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5dd6e15)).
- Comprehensive E2E test infrastructure with offline LLM shim and cass CLI stub ([`5ccffaf`](https://github.com/Dicklesworthstone/cass_memory_system/commit/5ccffaf), [`15c24c4`](https://github.com/Dicklesworthstone/cass_memory_system/commit/15c24c4)).

---

[Unreleased]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.3...main
[0.2.3]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Dicklesworthstone/cass_memory_system/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Dicklesworthstone/cass_memory_system/releases/tag/v0.1.0
