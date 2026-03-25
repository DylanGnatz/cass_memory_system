# Onboard v2 Enhancement Plan
# This file defines all beads for the Enhanced Agent-Native Onboarding v2 initiative
# Import with: bd create --file .beads/onboard-v2-plan.md

---

## Feature: Onboarding Progress Tracking
type: feature
priority: 1
parent: cass_memory_system-hb4y
labels: onboard-v2, foundation

### Background & Rationale

Currently, there's no memory of which sessions have been analyzed. If an agent's context window fills up mid-onboarding, they must start over or manually remember where they left off. This is a critical gap for the "agent-native" workflow where agents work autonomously.

**User Story:** As an AI coding agent, I want to resume onboarding from where I left off so that I don't waste time re-analyzing sessions.

### Design Decisions

**State Location:** `~/.memory-system/onboarding-state.json`
- Consistent with existing config location
- Separate from playbook (different concern)
- Survives `cm init --force` (intentional)

**State Schema v1:**
```json
{
  "version": 1,
  "startedAt": "ISO8601",
  "lastUpdatedAt": "ISO8601",
  "processedSessions": [
    {"path": "/path/session.jsonl", "processedAt": "ISO8601", "rulesExtracted": 3}
  ],
  "stats": {
    "totalSessionsProcessed": 5,
    "totalRulesExtracted": 15
  }
}
```

**Tracking by Path:** We track sessions by file path (not content hash). This is simpler and good enough for v1. Content hashing adds complexity for minimal benefit (session files rarely move).

### Acceptance Criteria

- [ ] `cm onboard --status` shows progress stats
- [ ] `cm onboard --sample` excludes already-processed sessions
- [ ] `cm onboard --mark-done <path>` marks session without adding rules
- [ ] `cm onboard --reset` clears all progress
- [ ] `cm onboard --sample --include-processed` overrides exclusion
- [ ] All operations have JSON output
- [ ] State file created lazily on first use

### Files to Modify

- `src/commands/onboard.ts` - Add state management
- New: `src/onboard-state.ts` - State schema and I/O (or inline in onboard.ts if small)

---

## Task: Implement onboarding state persistence
type: task
priority: 1
parent: Feature: Onboarding Progress Tracking
labels: onboard-v2, implementation
estimate: 90

### Implementation Details

1. Define TypeScript interfaces for state schema
2. Implement `loadOnboardState()` - reads file, returns default if missing
3. Implement `saveOnboardState()` - writes file atomically
4. Implement `markSessionProcessed(path, rulesExtracted)` - adds to processed list
5. Implement `isSessionProcessed(path)` - checks if in list
6. Implement `resetOnboardState()` - deletes state file

### Considerations

- Use atomic write (write to temp, rename) to prevent corruption
- Handle missing file gracefully (return empty state)
- Version field allows future schema migrations
- Stats are derived from processedSessions array

### Acceptance Criteria

- [ ] State file created on first `markSessionProcessed` call
- [ ] State survives process restart
- [ ] Concurrent access is safe (atomic writes)
- [ ] Invalid JSON in state file logs warning and returns empty state

---

## Task: Integrate progress into sample and status commands
type: task
priority: 1
parent: Feature: Onboarding Progress Tracking
deps: Task: Implement onboarding state persistence
labels: onboard-v2, implementation
estimate: 60

### Implementation Details

1. Modify `--status` to include:
   - Sessions processed count
   - Rules extracted count
   - Time since onboarding started
   - Sessions remaining (estimated)

2. Modify `--sample` to:
   - Load state
   - Filter out processed sessions
   - Show "X of Y sessions remaining" in output

3. Add `--include-processed` flag to override filtering

### JSON Output Changes

```json
{
  "status": {
    "cassAvailable": true,
    "playbookRules": 13,
    "progress": {
      "sessionsProcessed": 5,
      "rulesExtracted": 15,
      "startedAt": "2025-01-15T10:00:00Z",
      "lastActivity": "2025-01-15T11:30:00Z"
    }
  }
}
```

---

## Task: Add mark-done and reset commands
type: task
priority: 2
parent: Feature: Onboarding Progress Tracking
deps: Task: Implement onboarding state persistence
labels: onboard-v2, implementation
estimate: 45

### Implementation Details

1. `cm onboard --mark-done <path>`:
   - Validates path exists in cass
   - Marks as processed with rulesExtracted=0
   - Use case: Agent read session but found nothing useful

2. `cm onboard --reset`:
   - Deletes state file
   - Confirms in human mode: "Reset onboarding progress? [y/N]"
   - In JSON mode or with --yes: no confirmation
   - Use case: Start fresh after playbook changes

### Acceptance Criteria

- [ ] --mark-done validates session exists
- [ ] --mark-done is idempotent (marking twice is fine)
- [ ] --reset requires confirmation in interactive mode
- [ ] --reset --yes skips confirmation

---

## Feature: Batch Rule Addition
type: feature
priority: 1
parent: cass_memory_system-hb4y
labels: onboard-v2, friction-reduction

### Background & Rationale

After analyzing a session, agents typically extract 3-10 rules. Currently they must run `cm playbook add` for each one. This is:
- Tedious (N commands instead of 1)
- Error-prone (typos in repeated commands)
- Slow (process startup overhead × N)

**User Story:** As an AI coding agent, I want to add multiple rules at once so that I can efficiently batch my extractions.

### Design Decision: Enhance playbook add vs new command

**Option A:** Add `--file` to `cm playbook add`
- Pro: Minimal API surface increase
- Pro: Consistent with existing command
- Con: Slightly overloaded command

**Option B:** New `cm playbook add-batch` command
- Pro: Clear separation
- Con: Another command to remember

**Decision:** Option A - Add `--file` to `playbook add`. The existing command already handles single rules; extending it for multiple rules is natural. Use `-` for stdin support.

### Input Format

```json
[
  {"content": "Rule text here", "category": "debugging"},
  {"content": "Another rule", "category": "testing"}
]
```

Why JSON array:
- Structured and unambiguous
- Easy for agents to generate
- Supports all fields (content, category)
- Can extend with more fields later (tags, scope)

### Acceptance Criteria

- [ ] `cm playbook add --file rules.json` adds all rules from file
- [ ] `echo '[...]' | cm playbook add --file -` reads from stdin
- [ ] Returns structured results: successes and failures
- [ ] Partial success is allowed (add what we can)
- [ ] Updates onboarding state with rules extracted count

---

## Task: Add --file option to playbook add command
type: task
priority: 1
parent: Feature: Batch Rule Addition
labels: onboard-v2, implementation
estimate: 60

### Implementation Details

1. Add `--file <path>` option to playbook add command
2. When --file provided:
   - Ignore positional `<content>` argument
   - Read file (or stdin if `-`)
   - Parse as JSON array
   - Validate each entry has `content` field
   - Add each rule, collecting results
3. Return structured output

### JSON Output

```json
{
  "success": true,
  "added": [
    {"id": "b-xxx", "content": "Rule 1", "category": "debugging"},
    {"id": "b-yyy", "content": "Rule 2", "category": "testing"}
  ],
  "failed": [
    {"content": "Bad rule", "error": "Content too short"}
  ],
  "summary": {
    "total": 3,
    "succeeded": 2,
    "failed": 1
  }
}
```

### Error Handling

- Invalid JSON: Fail fast, report error
- Missing content field: Skip entry, report in failed
- Duplicate detection: If validation enabled, warn but still add

### Files to Modify

- `src/commands/playbook.ts` - Add --file handling
- `src/cm.ts` - Add --file option to command definition

---

## Task: Integrate batch add with onboarding state
type: task
priority: 2
parent: Feature: Batch Rule Addition
deps: Task: Add --file option to playbook add command, Task: Implement onboarding state persistence
labels: onboard-v2, integration
estimate: 30

### Implementation Details

When batch add completes successfully:
1. If a session path is provided (new `--session` option), update onboarding state
2. Mark session as processed with count of rules added

This connects the batch add flow to progress tracking.

### Usage

```bash
# After reading session, agent generates rules JSON, then:
echo '[...]' | cm playbook add --file - --session /path/to/session.jsonl
```

The `--session` option is optional - batch add works without it, but with it, progress is tracked.

---

## Feature: Gap-Aware Sampling
type: feature
priority: 2
parent: cass_memory_system-hb4y
labels: onboard-v2, smart-sampling

### Background & Rationale

Current sampling uses hardcoded queries ("fix bug", "implement feature", etc.). This doesn't consider:
- What the playbook already covers well
- What categories are underrepresented
- What would provide the most value

**User Story:** As an AI coding agent, I want sampling to prioritize sessions that fill gaps in my playbook so that I build a balanced rule set.

### Design Decision: Playbook-only gap analysis (v1)

**Option A:** Analyze playbook categories + estimate cass content categories
- Pro: More accurate gap detection
- Con: Complex, requires cass content analysis

**Option B:** Analyze playbook categories only
- Pro: Simple, fast, no cass overhead
- Con: Doesn't know what cass actually contains

**Decision:** Option B for v1. If playbook has 0 testing rules, "testing" is a gap regardless of what cass contains. We can add cass-aware analysis in v2 if needed.

### Gap Categorization

- **Critical gaps:** Categories with 0 rules
- **Underrepresented:** Categories with < 3 rules
- **Adequate:** Categories with 3-10 rules
- **Well-covered:** Categories with > 10 rules

### Acceptance Criteria

- [ ] `cm onboard --sample --fill-gaps` prioritizes gap-filling sessions
- [ ] Gap analysis shown in `--status` output
- [ ] Sessions tagged with likely categories based on keywords
- [ ] JSON output includes gap analysis

---

## Task: Implement playbook gap analysis function
type: task
priority: 2
parent: Feature: Gap-Aware Sampling
labels: onboard-v2, implementation
estimate: 45

### Implementation Details

1. Create `analyzePlaybookGaps(playbook)` function:
   - Count rules per category
   - Classify as critical/underrepresented/adequate/well-covered
   - Return structured analysis

2. Add category keyword detection:
   - Map keywords to categories (e.g., "test", "spec", "mock" → testing)
   - Use for estimating session categories from snippets

### Output Structure

```json
{
  "totalRules": 13,
  "byCategory": {
    "debugging": {"count": 5, "status": "adequate"},
    "testing": {"count": 1, "status": "underrepresented"},
    "security": {"count": 0, "status": "critical"}
  },
  "gaps": {
    "critical": ["security", "performance"],
    "underrepresented": ["testing"],
    "suggestions": "Focus on security and performance patterns"
  }
}
```

---

## Task: Add --fill-gaps flag to sampling
type: task
priority: 2
parent: Feature: Gap-Aware Sampling
deps: Task: Implement playbook gap analysis function
labels: onboard-v2, implementation
estimate: 60

### Implementation Details

1. Add `--fill-gaps` flag to `cm onboard --sample`
2. When enabled:
   - Run gap analysis
   - Modify search queries to target gap categories
   - Score sessions by likely gap-filling potential
   - Sort results by gap-filling score

3. Include rationale in output:
   ```json
   {
     "sessions": [{
       "path": "/path/session.jsonl",
       "reason": "Contains testing patterns; playbook has 1 testing rule",
       "likelyCategories": ["testing", "debugging"],
       "gapScore": 0.85
     }]
   }
   ```

### Keyword → Category Mapping

```typescript
const CATEGORY_KEYWORDS = {
  testing: ["test", "spec", "mock", "assert", "expect", "jest", "vitest"],
  debugging: ["debug", "error", "fix", "bug", "issue", "trace"],
  security: ["auth", "security", "token", "password", "encrypt", "permission"],
  performance: ["performance", "optimize", "cache", "slow", "memory", "profile"],
  // ... etc
};
```

---

## Feature: Targeted Sampling Options
type: feature
priority: 2
parent: cass_memory_system-hb4y
labels: onboard-v2, filtering

### Background & Rationale

Agents may want to focus onboarding on specific areas:
- A specific project/workspace they're working on
- A specific agent's sessions (Claude vs Cursor patterns)
- A specific time period (recent sessions more relevant)
- Quick bootstrap vs thorough analysis

**User Story:** As an AI coding agent, I want to filter sampled sessions by workspace/agent/time/depth so that I can focus on what's most relevant.

### New Options

```bash
# Scope filters
--workspace <path>    # Only sessions from this workspace
--agent <name>        # Only sessions from this agent (claude, cursor, etc.)
--category <cat>      # Sessions likely about this category

# Depth modes
--quick               # 5 sessions for fast bootstrap
--deep                # 30 sessions for thorough analysis

# Time filters
--days <n>            # Sessions from last N days
--since <date>        # Sessions after date (ISO8601)
--before <date>       # Sessions before date
```

### Acceptance Criteria

- [ ] All filters work independently
- [ ] Filters can be combined (--workspace X --days 30)
- [ ] --quick and --deep set reasonable defaults
- [ ] Filters passed through to cass search where possible
- [ ] JSON output includes applied filters

---

## Task: Add scope filters to sampling
type: task
priority: 2
parent: Feature: Targeted Sampling Options
labels: onboard-v2, implementation
estimate: 45

### Implementation Details

1. Add options: `--workspace`, `--agent`, `--category`
2. Pass through to cass search:
   - `--workspace` → cass `--workspace` filter
   - `--agent` → cass `--agent` filter
   - `--category` → modify search queries to category keywords

### Files to Modify

- `src/cm.ts` - Add options to onboard command
- `src/commands/onboard.ts` - Implement filtering logic
- `src/cass.ts` - Ensure CassSearchOptions supports these filters

---

## Task: Add depth modes and time filters
type: task
priority: 2
parent: Feature: Targeted Sampling Options
labels: onboard-v2, implementation
estimate: 30

### Implementation Details

1. Depth modes:
   - `--quick`: Sets limit=5, uses broader queries
   - `--deep`: Sets limit=30, uses more diverse queries

2. Time filters:
   - `--days <n>`: Passed to cass search
   - `--since <date>`: Convert to days, pass to cass
   - `--before <date>`: Filter results post-search (cass may not support)

### Default Behavior

Without flags: limit=10 (current default), no time filter

---

## Feature: Pre-Add Validation
type: feature
priority: 3
parent: cass_memory_system-hb4y
labels: onboard-v2, quality

### Background & Rationale

Without validation, agents can easily add:
- Near-duplicate rules (wastes context in cm context)
- Low-quality rules (too vague, too specific, missing context)
- Miscategorized rules (reduces retrieval accuracy)

**User Story:** As an AI coding agent, I want feedback on rule quality before adding so that I maintain a high-quality playbook.

### Design Decision: Non-blocking validation

Validation should inform, not block by default. Agents can decide whether to proceed.

**Default behavior:** Return validation results, add rule anyway
**Strict mode:** `--strict` flag makes warnings into errors

### Validation Checks

1. **Similarity check:** Compare against existing rules using `cm similar`
   - Warn if >0.8 similarity with existing rule

2. **Quality heuristics:**
   - Too short: < 10 words
   - Too long: > 100 words
   - Missing context: No "when", "if", "before", "after" words
   - Too vague: Only contains generic words

3. **Category suggestion:** Based on keywords, suggest better category if mismatch

### Acceptance Criteria

- [ ] `cm playbook add "..." --check` shows validation results
- [ ] `cm playbook add "..." --strict` fails on warnings
- [ ] Validation works with --file batch add
- [ ] JSON output includes validation details

---

## Task: Implement similarity and quality checks
type: task
priority: 3
parent: Feature: Pre-Add Validation
labels: onboard-v2, implementation
estimate: 60

### Implementation Details

1. Create `validateRule(content, category, playbook)` function:
   - Run similarity check against playbook
   - Run quality heuristics
   - Suggest category based on keywords
   - Return validation result

2. Quality heuristic functions:
   - `checkLength(content)` → short/ok/long
   - `checkContext(content)` → has context words or not
   - `checkSpecificity(content)` → vague/specific

### Validation Result Structure

```json
{
  "valid": true,
  "warnings": [
    {"type": "similar", "message": "85% similar to b-abc123", "severity": "warning"},
    {"type": "context", "message": "Consider adding when this applies", "severity": "suggestion"}
  ],
  "suggestions": {
    "category": "integration",
    "reason": "Contains API-related keywords"
  }
}
```

---

## Task: Add --check and --strict flags
type: task
priority: 3
parent: Feature: Pre-Add Validation
deps: Task: Implement similarity and quality checks
labels: onboard-v2, implementation
estimate: 30

### Implementation Details

1. Add `--check` flag to `cm playbook add`:
   - Runs validation and shows results
   - Still adds rule (unless --strict)

2. Add `--strict` flag:
   - Combined with --check
   - Fails if any warnings present
   - Exit code 1 on validation failure

3. For batch add with --file:
   - --check validates each rule
   - --strict skips rules with warnings (adds others)

---

## Feature: Enhanced Read Output
type: feature
priority: 2
parent: cass_memory_system-hb4y
labels: onboard-v2, ux

### Background & Rationale

`cm onboard --read` currently dumps raw session content. The agent must:
- Figure out what the session is about
- Remember what rules already exist
- Know what gaps to look for

**User Story:** As an AI coding agent, I want contextual guidance when reading sessions so that I extract more relevant rules.

### Template Output

The `--template` flag enriches read output with:
1. Session metadata (agent, workspace, message count)
2. Topic hints (detected from content)
3. Related existing rules (so agent knows what's covered)
4. Playbook gaps (so agent knows what to look for)
5. Suggested extraction focus

### Acceptance Criteria

- [ ] `cm onboard --read <path> --template` returns enriched output
- [ ] Related rules found via similarity search on session snippets
- [ ] Gaps included from gap analysis
- [ ] JSON output is structured and comprehensive

---

## Task: Add --template flag to read command
type: task
priority: 2
parent: Feature: Enhanced Read Output
deps: Task: Implement playbook gap analysis function
labels: onboard-v2, implementation
estimate: 75

### Implementation Details

1. Add `--template` flag to `cm onboard --read`
2. When enabled, output includes:

```json
{
  "metadata": {
    "path": "/path/session.jsonl",
    "agent": "claude",
    "workspace": "/Users/x/project",
    "messageCount": 45,
    "topicHints": ["authentication", "API", "error handling"]
  },
  "context": {
    "relatedRules": [
      {"id": "b-abc", "content": "...", "similarity": 0.6}
    ],
    "playbookGaps": {
      "critical": ["security"],
      "underrepresented": ["testing"]
    },
    "suggestedFocus": "Look for error handling and API patterns"
  },
  "extractionFormat": {
    "schema": [{"content": "string", "category": "string"}],
    "categories": ["debugging", "testing", ...]
  },
  "sessionContent": "..."
}
```

3. Topic hints via keyword extraction from first N messages
4. Related rules via similarity search on session summary

### Performance Consideration

Template generation adds overhead (similarity search, gap analysis). Cache gap analysis for session duration.

---

# Dependencies Summary

The dependency graph for implementation order:

```
Progress Tracking (Foundation)
├── State Persistence [no deps]
├── Integrate into Sample/Status [deps: State]
└── Mark-Done and Reset [deps: State]

Batch Add
├── --file option [no deps]
└── Integrate with State [deps: --file, State]

Gap Analysis
├── Gap Analysis Function [no deps]
└── --fill-gaps flag [deps: Gap Analysis]

Targeted Sampling
├── Scope Filters [no deps]
└── Depth/Time Filters [no deps]

Validation
├── Similarity/Quality Checks [no deps]
└── --check/--strict flags [deps: Checks]

Enhanced Read
└── --template flag [deps: Gap Analysis]
```

Critical path: State → Batch Add + Gap Analysis → Template Output

Parallelizable: Targeted Sampling, Validation (can be done alongside other work)
