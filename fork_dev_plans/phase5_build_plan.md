# Phase 5 Build Plan: Electron App

## Context

Phases 1-4 built the full backend pipeline: transcripts → session notes → diary → Reflector → Validator → Curator → knowledge pages, plus cm_context serving knowledge back into new sessions. Phase 5 adds a human-facing UI for browsing, searching, editing, and reviewing the knowledge base.

Phase 5 is split into three sub-phases:
- **5a: Core Browse + Search + Edit** — scaffold app, sidebar, content rendering, search, edit mode
- **5b: User Actions + Review Queue** — verify/invalidate/flag/star, review queue, user notes, undo
- **5c: Claude Dialog + Polish** — Claude dialog bar (Anthropic API), related topics, progress UI, packaging

---

## Design Decisions (Resolved)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Desktop framework | **Electron** — TypeScript backend, better-sqlite3 for search, proven ecosystem |
| D2 | Data API strategy | **Hybrid** — direct file reads for display, CLI subprocess for mutations, better-sqlite3 for search |
| D3 | Search implementation | **better-sqlite3** — synchronous Node native binding, reads existing search.db |
| D4 | Claude dialog bar | **Anthropic API with tool_use** (Phase 5c). No API key = dialog disabled. Without tools, Claude can still action on current document. |
| D5 | Build tooling | **electron-vite** — Vite-native, fast HMR, clean main/preload/renderer separation |
| D6 | State management | **TanStack Query + Zustand** — TanStack for data fetching/caching, Zustand for UI state |
| D7 | Markdown editor | **CodeMirror 6** with textarea fallback — good editing UX at reasonable weight |
| D8 | Project structure | **`electron/` directory in same repo** — shared types, easy CLI access |
| D9 | Scope | **Split into 5a/5b/5c** — each sub-phase delivers usable value |

---

## Resolved Open Questions

### Q1: Shared Types Strategy
**Decision:** Direct import via TypeScript path alias.

`src/types.ts` has a single import (Zod) and no internal dependencies. The Electron main process imports Zod schemas directly via path alias (`@shared/types`). The renderer uses `export type` re-exports that are erased at compile time — no Zod runtime in the renderer bundle.

```
electron/tsconfig.json → paths: { "@shared/*": ["../src/*"] }
electron/src/main/ → imports Zod schemas for validation
electron/src/renderer/ → imports TypeScript types only (export type)
```

### Q2: File Watching Strategy
**Decision:** TanStack Query stale-while-revalidate + chokidar for real-time invalidation.

TanStack Query handles the common case: `staleTime: 10_000` (10s), `refetchOnWindowFocus: true`. Navigation triggers fresh reads. Chokidar watches `~/.memory-system/` with 500ms debounce and calls `queryClient.invalidateQueries()` for affected query keys when files change. This covers:
- Periodic job writes → chokidar detects → queries refetch
- User edits in app → app invalidates cache directly
- External edits → chokidar detects → queries refetch

### Q3: Review Queue MVP Scope
**Decision:** Existing 3 types + `user_flag` + uncertain sections (dynamic scan).

Phase 4 built: `cold_start_suggestion`, `bloated_page`, `stale_topic`. Phase 5b adds:
- `user_flag` — new ReviewQueueItem type (user flags any content via UI action)
- Uncertain knowledge sections — scanned dynamically from `<!-- confidence: uncertain -->` at render time, not pre-computed

Defer: stale.ts bullet scanning, rule-validation.ts category mismatches, why.ts explanations. The review queue UI renders any item type generically so adding new sources later is trivial.

### Q4: Periodic Job Trigger
**Decision:** Shell out to `bun run src/cm.ts reflect --full --json`.

User already has Bun installed (project requirement). Simple spinner in UI until process completes. Parse final JSON output for result summary. Phase 5b upgrades to progress streaming. Phase 5c bundles compiled binary for distribution.

---

## UI Code Rule

**All UI code (React components, CSS/styling, layout, design decisions) must be built using the `/frontend-design` skill.** Feed it the task description and this build plan as context. Never generate frontend code directly. Backend/infrastructure code (Electron main process, IPC handlers, file readers, CLI bridge, preload, parsers) can be written directly.

---

## Pre-Work (Before Phase 5a)

These items close gaps between the current backend and what the Electron app needs. They belong in the existing codebase (src/), not in the Electron app.

### P1: User Notes CRUD

`UserNoteSchema` exists in types.ts but has no I/O functions. Create `src/user-notes.ts`:

```typescript
createUserNote(title, content, config, { topics? }): Promise<UserNote>
loadUserNote(id, config): Promise<{ frontmatter: UserNote, body: string } | null>
saveUserNote(id, frontmatter, body, config): Promise<void>
deleteUserNote(id, config): Promise<void>
listUserNotes(config): Promise<UserNote[]>
```

Follow knowledge-page.ts patterns: YAML frontmatter + markdown body, withLock + atomicWrite, FTS indexing via search.ts `indexNote()`.

File format: `~/.memory-system/notes/{id}.md` with YAML frontmatter matching UserNoteSchema.

### P2: Add `user_flag` Review Queue Type

Extend `ReviewQueueItemSchema` discriminated union in types.ts:
```typescript
{ type: "user_flag", target_topic: string, target_path: string, target_section?: string, reason?: string }
```

Add `flagContent(path, section?, reason?, config)` to review-queue.ts that appends a `user_flag` item.

### P3: Starred Items Index

Create `~/.memory-system/starred.json`:
```json
{ "items": [{ "path": "knowledge/auth-service.md", "section": null, "starred_at": "2026-03-24T..." }] }
```

Add to a new `src/starred.ts`:
```typescript
loadStarred(config): Promise<StarredItem[]>
starItem(path, section?, config): Promise<void>
unstarItem(path, section?, config): Promise<void>
isStarred(path, section?, config): Promise<boolean>
```

Using a separate index file (not frontmatter) avoids modifying system-generated files when starring, which would break `user_edited` semantics and trigger unnecessary chokidar events.

---

## Architecture

### Project Structure

```
electron/
├── package.json              # Node.js deps (electron, better-sqlite3, react, etc.)
├── tsconfig.json             # TypeScript config with path alias to ../src/
├── tsconfig.node.json        # Main process TypeScript config
├── electron.vite.config.ts   # electron-vite configuration
├── src/
│   ├── main/                 # Electron main process (Node.js)
│   │   ├── index.ts          # App lifecycle, window creation, chokidar setup
│   │   ├── ipc-handlers.ts   # IPC handler registration (contextBridge)
│   │   ├── file-reader.ts    # Direct file reads for ~/.memory-system/
│   │   ├── search.ts         # better-sqlite3 FTS5 queries
│   │   ├── cli-bridge.ts     # Subprocess spawning for mutations
│   │   └── watcher.ts        # chokidar file watching + query invalidation signals
│   ├── preload/
│   │   └── index.ts          # contextBridge API exposure
│   └── renderer/
│       ├── index.html
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Root layout (search bar + sidebar + content + status)
│       ├── stores/           # Zustand stores
│       │   └── ui-store.ts   # Sidebar tab, selected item, search state, edit mode
│       ├── hooks/            # TanStack Query hooks
│       │   ├── use-topics.ts
│       │   ├── use-knowledge-page.ts
│       │   ├── use-session-notes.ts
│       │   ├── use-digests.ts
│       │   ├── use-search.ts
│       │   ├── use-review-queue.ts
│       │   └── use-status.ts
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   ├── SearchBar.tsx
│       │   │   └── StatusBar.tsx
│       │   ├── sidebar/
│       │   │   ├── EncyclopediaTab.tsx
│       │   │   ├── RecentTab.tsx
│       │   │   ├── StarredTab.tsx         # Phase 5b
│       │   │   ├── MyNotesTab.tsx         # Phase 5b
│       │   │   └── ReviewQueueTab.tsx     # Phase 5b
│       │   ├── content/
│       │   │   ├── MarkdownRenderer.tsx   # react-markdown + remark-gfm + rehype-highlight
│       │   │   ├── KnowledgePage.tsx      # Confidence indicators, section metadata
│       │   │   ├── SessionNote.tsx        # Session note rendering
│       │   │   ├── DigestView.tsx         # Daily digest rendering
│       │   │   ├── SearchResults.tsx      # Search result list
│       │   │   └── Editor.tsx             # CodeMirror 6 / textarea toggle
│       │   ├── actions/                   # Phase 5b
│       │   │   ├── ActionToolbar.tsx
│       │   │   ├── InvalidateDialog.tsx
│       │   │   └── FlagDialog.tsx
│       │   └── claude/                    # Phase 5c
│       │       └── ClaudeDialog.tsx
│       ├── lib/
│       │   ├── ipc.ts         # Typed IPC client (wraps window.electronAPI)
│       │   ├── parsers.ts     # Knowledge page frontmatter/metadata parsing
│       │   └── formatters.ts  # Date formatting, confidence display, etc.
│       └── styles/
│           └── global.css     # Tailwind or vanilla CSS
```

### IPC Contract (Main ↔ Renderer)

All Node.js / file system / SQLite access lives in the main process. Renderer communicates via typed IPC channels:

```typescript
// Exposed via contextBridge in preload/index.ts
interface ElectronAPI {
  // File reads (direct, fast)
  getTopics(): Promise<Topic[]>
  getKnowledgePage(slug: string): Promise<ParsedKnowledgePage | null>
  getSessionNote(id: string): Promise<{ frontmatter: SessionNote, body: string } | null>
  getDigest(date: string): Promise<string | null>
  getStatus(): Promise<SystemStatus>
  getReviewQueue(): Promise<ReviewQueue>
  getStarred(): Promise<StarredItem[]>
  getUserNotes(): Promise<UserNote[]>
  getUserNote(id: string): Promise<{ frontmatter: UserNote, body: string } | null>
  listSessionNotes(options?: { limit?: number }): Promise<SessionNoteSummary[]>
  listDigests(options?: { limit?: number }): Promise<DigestSummary[]>

  // Search (better-sqlite3, fast)
  search(query: string, options?: { scope?: string, limit?: number }): Promise<SearchResult[]>

  // Mutations (CLI subprocess, safe)
  saveKnowledgePage(slug: string, content: string): Promise<void>
  saveSessionNote(id: string, content: string): Promise<void>
  saveUserNote(id: string, title: string, content: string): Promise<void>
  createUserNote(title: string, content: string, topics?: string[]): Promise<string>
  deleteUserNote(id: string): Promise<void>
  runReflection(): Promise<ReflectionResult>
  addTopic(slug: string, name: string, description: string): Promise<void>
  removeTopic(slug: string, force?: boolean): Promise<void>
  approveReviewItem(id: string): Promise<void>
  dismissReviewItem(id: string): Promise<void>
  flagContent(path: string, section?: string, reason?: string): Promise<void>
  starItem(path: string, section?: string): Promise<void>
  unstarItem(path: string, section?: string): Promise<void>

  // File watching signals
  onFileChange(callback: (affectedPaths: string[]) => void): () => void
}
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Renderer (React)                         │
│                                                             │
│  TanStack Query hooks ←→ window.electronAPI (IPC calls)     │
│  Zustand store (UI state: selected tab, item, edit mode)    │
│                                                             │
│  Components: Sidebar | SearchBar | ContentArea | StatusBar  │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC (contextBridge)
┌─────────────────────┴───────────────────────────────────────┐
│                     Main Process (Node.js)                    │
│                                                             │
│  ipc-handlers.ts ─→ file-reader.ts (direct file reads)      │
│                  ─→ search.ts (better-sqlite3 FTS5)         │
│                  ─→ cli-bridge.ts (bun subprocess for writes)│
│                                                             │
│  watcher.ts ─→ chokidar on ~/.memory-system/               │
│             ─→ sends 'file-change' events to renderer       │
│             ─→ renderer invalidates TanStack Query cache     │
└─────────────────────────────────────────────────────────────┘
                      │ reads/writes
┌─────────────────────┴───────────────────────────────────────┐
│                 ~/.memory-system/                             │
│  knowledge/*.md | session-notes/*.md | digests/*.md          │
│  topics.json | state.json | review-queue.json | starred.json │
│  search.db (SQLite FTS5) | playbook.yaml                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 5a: Core Browse + Search + Edit

### Step 1: Scaffold Electron App

**Action:** Initialize electron-vite project in `electron/` directory.

```bash
cd /Users/dylangnatz/Coding/cass_memory_system
mkdir electron && cd electron
npm create @nicedoc/electron-vite@latest . -- --template react-ts
```

Or manual setup:

**electron/package.json:**
```json
{
  "name": "cass-memory-app",
  "version": "0.1.0",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chokidar": "^4.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "@codemirror/lang-markdown": "^6.0.0",
    "@codemirror/view": "^6.0.0",
    "@codemirror/state": "^6.0.0",
    "codemirror": "^6.0.0"
  },
  "devDependencies": {
    "electron": "^35.0.0",
    "electron-vite": "^3.0.0",
    "@electron-toolkit/preload": "^4.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
```

**electron-vite config:** Main process targets Node.js, renderer targets browser, preload bridges them.

**Electron security:**
- `contextIsolation: true` (mandatory)
- `nodeIntegration: false` (mandatory)
- `sandbox: true` (recommended)
- All file/SQLite access in main process only
- Renderer accesses via `contextBridge` IPC

**Files created:**
- `electron/package.json`
- `electron/tsconfig.json` (path alias to `../src/`)
- `electron/tsconfig.node.json`
- `electron/electron.vite.config.ts`
- `electron/src/main/index.ts` (app lifecycle, BrowserWindow, dev tools)
- `electron/src/preload/index.ts` (contextBridge stub)
- `electron/src/renderer/index.html`
- `electron/src/renderer/main.tsx` (React entry + QueryClientProvider)
- `electron/src/renderer/App.tsx` (shell layout)

**Validation:** `cd electron && npm install && npm run dev` opens a window.

### Step 2: Main Process Infrastructure

**IPC handlers** (`electron/src/main/ipc-handlers.ts`):
Register all IPC handlers via `ipcMain.handle()`. Each handler delegates to file-reader.ts, search.ts, or cli-bridge.ts.

**File reader** (`electron/src/main/file-reader.ts`):
- `getMemorySystemPath()` — resolves `~/.memory-system/` cross-platform
- `readTopics()` — parse `topics.json`
- `readKnowledgePage(slug)` — read `knowledge/{slug}.md`, parse YAML frontmatter + HTML comment section metadata
- `readSessionNote(id)` — read `session-notes/{id}.md`, parse YAML frontmatter
- `readDigest(date)` — read `digests/{date}.md`
- `readStatus()` — read `state.json` + `topics.json` + count unprocessed session notes
- `readReviewQueue()` — read `review-queue.json`
- `listSessionNotes()` — glob `session-notes/*.md`, parse frontmatter only, sort by date desc
- `listDigests()` — glob `digests/*.md`, extract date from filename, sort desc

**Knowledge page parser** (port from knowledge-page.ts):
The parser in `src/knowledge-page.ts` is ~60 lines of pure string manipulation (YAML frontmatter extraction + 3-line lookahead for `<!-- id: ... -->` comments). Port to `electron/src/main/parsers.ts`. This avoids importing the full Bun module with its lock/write dependencies.

**Search** (`electron/src/main/search.ts`):
```typescript
import Database from 'better-sqlite3';

const db = new Database(path.join(memorySystemPath, 'search.db'), { readonly: true });

function search(query: string, scope?: string, limit = 20): SearchResult[] {
  // Wrap each word in quotes for FTS5 safety (same pattern as src/search.ts)
  const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(' ');
  // Query FTS5 tables based on scope, rank by BM25
  // Return unified results with type badges
}
```

**CLI bridge** (`electron/src/main/cli-bridge.ts`):
```typescript
import { spawn } from 'child_process';

async function runCli(args: string[]): Promise<any> {
  const proc = spawn('bun', ['run', CM_PATH, ...args, '--json'], { ... });
  // Collect stdout, parse JSON, return
}
```

Where `CM_PATH` resolves to the repo's `src/cm.ts`.

**Preload** (`electron/src/preload/index.ts`):
Expose typed `electronAPI` via `contextBridge.exposeInMainWorld()`. One method per IPC channel.

**Files created:**
- `electron/src/main/ipc-handlers.ts`
- `electron/src/main/file-reader.ts`
- `electron/src/main/search.ts`
- `electron/src/main/cli-bridge.ts`
- `electron/src/main/parsers.ts`
- `electron/src/preload/index.ts` (full implementation)

**Validation:** IPC roundtrip — renderer calls `window.electronAPI.getTopics()`, main process reads topics.json, renderer receives data.

### Step 3: Sidebar — Encyclopedia Tab

**Zustand store** (`electron/src/renderer/stores/ui-store.ts`):
```typescript
interface UIState {
  activeTab: 'encyclopedia' | 'recent' | 'starred' | 'notes' | 'review';
  selectedItem: { type: string; id: string } | null;
  searchQuery: string;
  isEditing: boolean;
  setActiveTab: (tab) => void;
  selectItem: (item) => void;
  // ...
}
```

**TanStack Query hook** (`electron/src/renderer/hooks/use-topics.ts`):
```typescript
function useTopics() {
  return useQuery({
    queryKey: ['topics'],
    queryFn: () => window.electronAPI.getTopics(),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}
```

**EncyclopediaTab component:**
- Fetches topics via `useTopics()` hook
- Alphabetically sorted list with filter input at top
- Each item shows: topic name, description (truncated), section count badge
- Click selects topic → loads knowledge page in main content area
- Active item highlighted

**App layout:**
```
┌─────────────────────────────────────────────────────┐
│  [Search bar]                                        │
├──────────┬──────────────────────────────────────────┤
│ Sidebar  │  Main Content                             │
│          │                                           │
│ [tabs]   │  (selected item rendered here)            │
│ [list]   │                                           │
├──────────┴──────────────────────────────────────────┤
│  Status bar: last reflection, topic count, etc.      │
└─────────────────────────────────────────────────────┘
```

**Files created:**
- `electron/src/renderer/stores/ui-store.ts`
- `electron/src/renderer/hooks/use-topics.ts`
- `electron/src/renderer/components/sidebar/EncyclopediaTab.tsx`
- `electron/src/renderer/components/layout/Sidebar.tsx`
- `electron/src/renderer/App.tsx` (updated with layout)

### Step 4: Main Content — Markdown Rendering

**MarkdownRenderer component** (`electron/src/renderer/components/content/MarkdownRenderer.tsx`):
- Uses `react-markdown` + `remark-gfm` + `rehype-highlight`
- Custom renderers for:
  - Headings: extract section ID from adjacent HTML comment metadata
  - Code blocks: syntax highlighting via rehype-highlight
  - Tables: styled with borders
- Handles GitHub-flavored markdown (tables, strikethrough, task lists)

**KnowledgePage component** (`electron/src/renderer/components/content/KnowledgePage.tsx`):
- Fetches page via `useKnowledgePage(slug)` hook
- Renders YAML frontmatter as a header card: topic name, description, source, dates
- Renders each section with:
  - Confidence indicator: `●` verified (green), `◐` inferred (yellow), `○` uncertain (red)
  - Source session link
  - Added date
  - Related bullets (if any)
- `[INVALIDATED ...]` annotations rendered with visual distinction (strikethrough + red background)

**TanStack Query hook** (`electron/src/renderer/hooks/use-knowledge-page.ts`):
```typescript
function useKnowledgePage(slug: string | null) {
  return useQuery({
    queryKey: ['knowledge-page', slug],
    queryFn: () => window.electronAPI.getKnowledgePage(slug!),
    enabled: !!slug,
    staleTime: 10_000,
  });
}
```

**Files created:**
- `electron/src/renderer/components/content/MarkdownRenderer.tsx`
- `electron/src/renderer/components/content/KnowledgePage.tsx`
- `electron/src/renderer/hooks/use-knowledge-page.ts`
- `electron/src/renderer/lib/parsers.ts` (confidence badge helpers, date formatters)

### Step 5: Knowledge Page Section Metadata

Extend KnowledgePage rendering to parse and display `<!-- id: ... | confidence: ... | source: ... -->` HTML comments.

**Parser** (`electron/src/renderer/lib/parsers.ts`):
```typescript
function parseMetadataComment(html: string): SectionMetadata | null {
  // Regex: /<!-- id: (.+?) \| confidence: (.+?) \| source: (.+?) \| added: (.+?)(?:\s*\| related_bullets: (.+?))? -->/
  // Returns { id, confidence, source, added, relatedBullets }
}
```

**Section header component:**
- Renders above each `## Heading` in knowledge pages
- Shows: confidence badge + source session ID (clickable → navigates to session note) + date
- Hover tooltip with full metadata

**Gotcha:** react-markdown strips HTML comments by default. Need a custom rehype plugin or pre-process the markdown to convert comments into renderable elements before passing to react-markdown.

Two approaches:
1. Pre-process markdown: regex-replace `<!-- ... -->` with a custom marker (e.g., `:::metadata{...}`) before rendering, then use a custom component for that marker
2. Post-process parsed AST: custom rehype plugin that converts HTML comment nodes to data attributes on the preceding heading

Recommend approach 1 (pre-process) — simpler and more predictable.

### Step 6: Sidebar — Recent Tab

**RecentTab component:**
- Two sections: "Digests" and "Session Notes"
- Digests listed by date (reverse chronological), last 30 days
- Session notes listed by last_updated (reverse chronological), last 20
- Click on digest → renders DigestView in main content
- Click on session note → renders SessionNote in main content

**DigestView component:**
- Simple markdown rendering of the digest file
- Header card showing date and session count

**SessionNote component:**
- Renders YAML frontmatter as header card: session ID, created/updated dates, abstract, topics touched, processed badge, user_edited badge
- Body rendered as markdown

**TanStack Query hooks:**
- `useDigests()` — lists digest files, sorted by date desc
- `useDigest(date)` — fetches single digest content
- `useSessionNotes()` — lists session notes, sorted by date desc
- `useSessionNote(id)` — fetches single session note

**Files created:**
- `electron/src/renderer/components/sidebar/RecentTab.tsx`
- `electron/src/renderer/components/content/DigestView.tsx`
- `electron/src/renderer/components/content/SessionNote.tsx`
- `electron/src/renderer/hooks/use-digests.ts`
- `electron/src/renderer/hooks/use-session-notes.ts`

### Step 7: Fast Search Bar

**SearchBar component** (`electron/src/renderer/components/layout/SearchBar.tsx`):
- Text input at top of app, always visible
- Debounced input (150ms) triggers FTS query via `window.electronAPI.search()`
- Results appear in a dropdown overlay or replace main content area
- Each result shows: type badge (knowledge/session/digest/transcript), title/first line, snippet with highlighted matches, score
- Transcript results grouped behind an expandable "Raw transcripts" section
- Click navigates to the document
- Keyboard navigation: arrow keys to move, Enter to select, Escape to close

**Search hook** (`electron/src/renderer/hooks/use-search.ts`):
```typescript
function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => window.electronAPI.search(query, { limit: 30 }),
    enabled: query.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData, // Keep old results while typing
  });
}
```

**Main process search** (`electron/src/main/search.ts`):
- Opens search.db in readonly mode via better-sqlite3
- Queries FTS5 tables: `fts_knowledge`, `fts_sessions`, `fts_digests`, `fts_notes`, optionally `fts_transcripts`
- Uses BM25 ranking (FTS5 built-in)
- Transcript results scored 0.5x lower (same logic as cm_search in serve.ts)
- Deduplicates by `type:id` composite key
- Returns: `{ type, id, title, snippet, score }[]`

**SearchResults component** (`electron/src/renderer/components/content/SearchResults.tsx`):
- Renders search results as a list
- Type badges with distinct colors: knowledge (blue), session (green), digest (purple), transcript (gray)
- Snippet text with match highlighting
- Click navigates: knowledge → KnowledgePage, session → SessionNote, digest → DigestView

**Files created:**
- `electron/src/renderer/components/layout/SearchBar.tsx`
- `electron/src/renderer/components/content/SearchResults.tsx`
- `electron/src/renderer/hooks/use-search.ts`

### Step 8: Edit Mode Toggle

**Editor component** (`electron/src/renderer/components/content/Editor.tsx`):
- Toggle button: "View" ↔ "Edit" in the content area header
- View mode: rendered markdown (default)
- Edit mode: CodeMirror 6 editor with markdown syntax highlighting
  - Fallback: `<textarea>` if CodeMirror fails to load
- Save button: sends content to main process via IPC
- Cancel button: discards changes, returns to view mode
- Unsaved changes warning on navigation

**Save flow (mutations via CLI bridge):**
- Knowledge pages: `cli-bridge.ts` writes directly to file (knowledge pages are user-editable, no special CLI command needed). Update `user_edited` if it's a session note.
- Session notes: write directly + set `user_edited: true` in frontmatter
- User notes: write directly (Phase 5b)
- After any save: invalidate relevant TanStack Query cache + trigger SQLite re-index for the saved file (single-file reindex via CLI: `bun run src/cm.ts` or direct better-sqlite3 INSERT)

**Gotcha:** Direct file writes from Electron bypass `withLock()`. For knowledge pages and session notes, this is safe because:
- The periodic job uses withLock for its own writes
- User edits via Electron are user-initiated and single-threaded
- atomicWrite (temp file → rename) prevents partial reads
- Worst case: periodic job and Electron write simultaneously → last write wins, but this is the same as any editor

Implement atomicWrite in the Electron main process: write to `{file}.tmp` → `fs.renameSync()`.

**Files created:**
- `electron/src/renderer/components/content/Editor.tsx`
- `electron/src/main/file-writer.ts` (atomicWrite for direct file saves)

### Step 9: File Watching + Auto-Refresh

**Watcher** (`electron/src/main/watcher.ts`):
```typescript
import { watch } from 'chokidar';

const watcher = watch(memorySystemPath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 500 }, // debounce atomic writes
  ignored: ['.periodic-job.lock', '.embedding-cache.json'], // noisy, irrelevant
});

watcher.on('all', (event, filePath) => {
  // Determine affected query keys from file path
  // e.g., knowledge/auth-service.md → ['knowledge-page', 'auth-service']
  // Send to renderer via IPC
  mainWindow.webContents.send('file-change', { event, path: filePath });
});
```

**Renderer listener:**
```typescript
useEffect(() => {
  const unsubscribe = window.electronAPI.onFileChange((paths) => {
    // Map paths to query keys and invalidate
    for (const p of paths) {
      if (p.includes('/knowledge/')) queryClient.invalidateQueries({ queryKey: ['knowledge-page'] });
      if (p.includes('/session-notes/')) queryClient.invalidateQueries({ queryKey: ['session-notes'] });
      if (p.includes('/digests/')) queryClient.invalidateQueries({ queryKey: ['digests'] });
      if (p.includes('topics.json')) queryClient.invalidateQueries({ queryKey: ['topics'] });
      if (p.includes('state.json')) queryClient.invalidateQueries({ queryKey: ['status'] });
      if (p.includes('review-queue.json')) queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    }
  });
  return unsubscribe;
}, [queryClient]);
```

### Step 10: Status Bar + Polish

**StatusBar component:**
- Bottom of app, always visible
- Shows: last reflection run (from state.json), topic count, unprocessed session note count
- "Run Reflection Now" button (Phase 5a: shows spinner, calls `bun run src/cm.ts reflect --full --json`)
- Budget usage (daily/monthly from state.json)

**Status hook** (`electron/src/renderer/hooks/use-status.ts`):
- Fetches from `window.electronAPI.getStatus()`
- Polls every 30 seconds (periodic job may update state.json)

**Polish items for 5a:**
- Empty states: "No knowledge pages yet", "No digests yet", "Run reflection to get started"
- Loading skeletons for content areas
- Error boundaries around each content view
- Keyboard shortcut: Cmd+K for search focus
- Window title updates to show current view

---

## Phase 5b: User Actions + Review Queue

### Step B1: Section-Level Action Toolbar

**ActionToolbar component:**
- Appears on hover over knowledge page section headings (or persistently at section headers)
- Actions: [Verify] [Invalidate] [Flag] [Star]
- **Verify** — one-click, bumps confidence to "verified" in the section's HTML comment metadata. Writes file via atomicWrite. Invalidates query cache.
- **Invalidate** — opens InvalidateDialog
- **Flag** — opens FlagDialog, writes `user_flag` to review-queue.json
- **Star** — one-click toggle, writes to starred.json

**Requires pre-work P2 (user_flag) and P3 (starred.json).**

### Step B2: Invalidation Dialog

**InvalidateDialog component:**
- Modal with: "Why is this incorrect?" text field + optional effective_date picker
- On submit: wraps the section content in `[INVALIDATED {date} (effective {effective_date}): {reason}]` annotation
- Writes modified knowledge page via atomicWrite
- Records harmful feedback: calls `bun run src/cm.ts feedback --harmful --path knowledge/{slug}.md --section "{title}" --reason "{reason}" --json`

### Step B3: Review Queue View

**ReviewQueueTab sidebar component:**
- Badge count of pending items
- Click opens review queue in main content area

**ReviewQueue main content component:**
- Lists all items from review-queue.json with `status: "pending"`
- Groups by type: cold_start_suggestions, bloated_pages, stale_topics, user_flags
- Also dynamically scans knowledge pages for `confidence: uncertain` sections (not stored in review-queue.json)
- Each item shows: type badge, target topic, description, created date
- Actions per item type:
  - cold_start_suggestion: [Approve] (navigate to merge UI) [Dismiss]
  - bloated_page: [View Page] (navigate to knowledge page) [Dismiss]
  - stale_topic: [Remove Topic] [Keep] [Dismiss]
  - user_flag: [View] [Dismiss]
  - uncertain_section: [Verify] [Invalidate] [View]

### Step B4: User Notes

**Requires pre-work P1 (user-notes.ts in backend).**

**MyNotesTab sidebar component:**
- List of user notes sorted by created date
- "+ New" button at bottom
- Click opens note in main content area

**UserNote main content component:**
- Same MarkdownRenderer + Editor toggle as knowledge pages
- Title editable inline
- Delete button (with confirmation)
- Optional topic tags (multi-select from existing topics)

### Step B5: Starred Tab

**Requires pre-work P3 (starred.json).**

**StarredTab sidebar component:**
- List of starred items from starred.json
- Each shows: type badge (knowledge/session/note), title, starred date
- Click navigates to the item
- Unstar button (X icon)

### Step B6: Undo UI

**Important discovery:** `undo.ts` (481 lines) operates on **playbook bullets only** — un-deprecate, undo-feedback, hard-delete. It does NOT have snapshot/restore for knowledge pages or the full knowledge base. The architecture plan's description of "full snapshot/restore with history" is aspirational, not current.

**For Phase 5b, scope undo to what exists:**
- Show last reflection timestamp (from state.json `lastReflectionRun`)
- "Undo" actions on individual playbook bullets via the existing undo command
- Defer full "undo last reflection" (knowledge page snapshot/restore) to Phase 5c or later

**Undo section in StatusBar:**
- Last reflection: "24 minutes ago" with timestamp tooltip
- For playbook view: per-bullet undo actions

---

## Phase 5c: Claude Dialog + Polish

### Step C1: Claude Dialog Bar

**ClaudeDialog component:**
- Text input at bottom of app
- Requires `ANTHROPIC_API_KEY` environment variable or config setting
- If no API key: dialog hidden or shows "Set API key in settings to enable Claude"
- If API key present: conversational interface with Claude

**Architecture:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// Tools that the app fulfills locally
const tools = [
  {
    name: "search_knowledge_base",
    description: "Search the knowledge base for relevant content",
    input_schema: { type: "object", properties: { query: { type: "string" }, scope: { type: "string" } } }
  },
  {
    name: "read_document",
    description: "Read a specific document from the knowledge base",
    input_schema: { type: "object", properties: { path: { type: "string" } } }
  }
];

// When Claude calls a tool, the app fulfills it locally:
// search_knowledge_base → better-sqlite3 FTS query
// read_document → file-reader.ts
```

**Without tools (no API key scenario is moot — dialog hidden):**
When the user has a document open and asks Claude to rewrite/summarize/explain, the current document content is included in the message as context. Claude returns the result, and the app applies it (e.g., replacing the document content or showing a diff).

**Slash commands in dialog:**
- `/reflect` → triggers `bun run src/cm.ts reflect --full --json`
- `/snapshot` → triggers `bun run src/cm.ts snapshot --json`
- `/topic add [name] [description]` → triggers `bun run src/cm.ts topic add ...`
- `/status` → shows system status inline

### Step C2: Related Topics Panel

When viewing a knowledge page, a side panel shows related topics.

**Implementation:** Use `semantic.ts` embeddings via CLI:
```
bun run src/cm.ts similar --target knowledge/{slug}.md --json
```
Or compute locally by reading `.embedding-cache.json` and doing cosine similarity in the main process (avoids CLI overhead).

### Step C3: Progress Indicator for Background Job

When reflection is running (triggered by "Run Reflection Now" button):
- StatusBar shows animated progress: "Reflecting on 3 sessions..."
- Uses `progress.ts` ProgressReporter output from the CLI subprocess stdout
- Parse incremental JSON events from the `--json` flag output

### Step C4: Packaging for Distribution

- electron-builder configuration for macOS (.dmg), Windows (.exe), Linux (.AppImage)
- Bundle compiled CLI binary (`bun build src/cm.ts --compile`) alongside Electron app
- No Bun dependency for end users
- Auto-update via electron-updater (optional)

---

## Gotchas and Risks

1. **bun:sqlite ↔ better-sqlite3 FTS5 compatibility** — Both use standard SQLite. FTS5 virtual tables created by bun:sqlite should be readable by better-sqlite3 (both include FTS5 by default). **Test early in Step 2.**

2. **Electron security** — `contextIsolation: true` + `nodeIntegration: false` is non-negotiable. All file/SQLite access in main process, exposed via contextBridge IPC. Forgetting this creates a security vulnerability.

3. **react-markdown strips HTML comments** — Our `<!-- id: ... | confidence: ... -->` metadata is in HTML comments. react-markdown's default AST processing removes them. Need pre-processing step to convert comments to renderable elements (Step 5).

4. **atomicWrite in Electron** — The Electron main process needs its own atomicWrite implementation for direct file saves (editor). Simple: `fs.writeFileSync(path + '.tmp', content)` → `fs.renameSync(path + '.tmp', path)`.

5. **chokidar noise during periodic job** — A reflection run writes dozens of files in sequence. Need `awaitWriteFinish` with 500ms stabilityThreshold to avoid cascading query invalidation. Batch invalidation signals.

6. **better-sqlite3 native module rebuild** — better-sqlite3 is a C++ native module that must be compiled for Electron's version of Node.js. Use `electron-rebuild` or `@electron/rebuild` in a postinstall script.

7. **Cross-platform paths** — `~/.memory-system/` expands differently on Windows (`%USERPROFILE%`). Use `os.homedir()` + `path.join()` in the main process, never hardcode `~`.

8. **UserNoteSchema has `ingest` field** — The `ingest: "pending" | "ingested" | "skipped"` field on UserNoteSchema implies user notes can be ingested into the knowledge pipeline. For Phase 5, treat user notes as standalone (ingest: "skipped" default). Ingestion is a future feature.

9. **Undo.ts is bullet-only** — The architecture plan describes "full snapshot/restore with history" but `commands/undo.ts` only operates on playbook bullets (un-deprecate, undo-feedback, hard-delete). Full knowledge base rollback would require a new snapshot mechanism. Scoped to bullet-level undo for Phase 5b.

10. **search.db may not exist** — If the user hasn't run reflection yet, there's no search.db. better-sqlite3 will throw when opening a non-existent file. Handle gracefully: show "Run reflection to enable search" message.

---

## Build Order (Recommended)

### Pre-work (in existing codebase)
```
P1: User notes CRUD (src/user-notes.ts)
P2: user_flag review queue type (src/types.ts, src/review-queue.ts)
P3: Starred items index (src/starred.ts)
```

### Phase 5a
```
Step 1:  Scaffold Electron app
Step 2:  Main process infrastructure (IPC, file-reader, search, cli-bridge)
Step 3:  Sidebar — Encyclopedia tab
Step 4:  Markdown rendering (react-markdown + remark-gfm + rehype-highlight)
Step 5:  Knowledge page section metadata (confidence indicators, source links)
Step 6:  Sidebar — Recent tab (digests + session notes)
Step 7:  Fast search bar (better-sqlite3 FTS, debounced)
Step 8:  Edit mode toggle (CodeMirror 6 / textarea)
Step 9:  File watching + auto-refresh (chokidar + TanStack Query invalidation)
Step 10: Status bar + polish
```

### Phase 5b
```
Step B1: Section-level action toolbar (verify, invalidate, flag, star)
Step B2: Invalidation dialog
Step B3: Review queue view
Step B4: User notes (create, edit, delete)
Step B5: Starred tab
Step B6: Undo UI (bullet-level only)
```

### Phase 5c
```
Step C1: Claude dialog bar (Anthropic API + tool_use)
Step C2: Related Topics panel
Step C3: Progress indicator for background job
Step C4: Packaging for distribution
```

---

## Validation Checklist (Phase 5a)

```markdown
- [ ] `cd electron && npm run dev` — app opens, no console errors
- [ ] Encyclopedia tab shows topics from ~/.memory-system/topics.json
- [ ] Click topic → knowledge page renders with formatted markdown
- [ ] Confidence indicators (●/◐/○) show correctly on knowledge page sections
- [ ] Source session IDs and dates visible on section headers
- [ ] Recent tab shows digests and session notes in reverse chronological order
- [ ] Click digest → renders formatted markdown
- [ ] Click session note → renders with frontmatter header card
- [ ] Search bar: type query → results appear within 200ms
- [ ] Search results show type badges (knowledge/session/digest)
- [ ] Click search result → navigates to document
- [ ] Edit mode: click Edit → CodeMirror editor appears with raw markdown
- [ ] Edit mode: modify content, click Save → file updated on disk
- [ ] Edit mode: click Cancel → changes discarded
- [ ] File watching: externally modify a knowledge page → app updates within 1 second
- [ ] Status bar shows last reflection time and topic count
- [ ] "Run Reflection Now" button triggers reflection via CLI
- [ ] Empty state: no knowledge pages → helpful message shown
- [ ] search.db missing → search disabled with message, browsing still works
```

---

## Dependencies (electron/package.json)

| Package | Purpose | Size |
|---------|---------|------|
| electron | Desktop framework | (dev only) |
| electron-vite | Build tooling | (dev only) |
| better-sqlite3 | SQLite FTS5 search | ~2MB native |
| chokidar | File watching | ~200KB |
| @tanstack/react-query | Data fetching/caching | ~40KB |
| zustand | UI state management | ~1KB |
| react + react-dom | UI framework | ~130KB |
| react-markdown | Markdown rendering | ~30KB |
| remark-gfm | GitHub-flavored markdown | ~10KB |
| rehype-highlight | Code syntax highlighting | ~15KB + highlight.js |
| codemirror + @codemirror/lang-markdown | Markdown editor | ~100KB |
| @anthropic-ai/sdk | Claude API (Phase 5c) | ~50KB |

---

## Files Summary

| File | Phase | Action |
|------|-------|--------|
| `src/user-notes.ts` | Pre-work | **New** — CRUD for user notes |
| `src/types.ts` | Pre-work | Extend ReviewQueueItemSchema with user_flag |
| `src/review-queue.ts` | Pre-work | Add flagContent() |
| `src/starred.ts` | Pre-work | **New** — starred items index |
| `electron/package.json` | 5a-1 | **New** — Electron app dependencies |
| `electron/electron.vite.config.ts` | 5a-1 | **New** — build config |
| `electron/tsconfig.json` | 5a-1 | **New** — TypeScript with path alias |
| `electron/src/main/index.ts` | 5a-1 | **New** — app lifecycle |
| `electron/src/main/ipc-handlers.ts` | 5a-2 | **New** — IPC registration |
| `electron/src/main/file-reader.ts` | 5a-2 | **New** — direct file reads |
| `electron/src/main/search.ts` | 5a-2 | **New** — better-sqlite3 FTS |
| `electron/src/main/cli-bridge.ts` | 5a-2 | **New** — CLI subprocess |
| `electron/src/main/parsers.ts` | 5a-2 | **New** — frontmatter/metadata parsing |
| `electron/src/main/watcher.ts` | 5a-9 | **New** — chokidar setup |
| `electron/src/main/file-writer.ts` | 5a-8 | **New** — atomicWrite for editor |
| `electron/src/preload/index.ts` | 5a-2 | **New** — contextBridge |
| `electron/src/renderer/main.tsx` | 5a-1 | **New** — React entry |
| `electron/src/renderer/App.tsx` | 5a-3 | **New** — layout |
| `electron/src/renderer/stores/ui-store.ts` | 5a-3 | **New** — Zustand |
| `electron/src/renderer/hooks/*.ts` | 5a-3+ | **New** — TanStack Query hooks |
| `electron/src/renderer/components/**/*.tsx` | 5a-3+ | **New** — all UI components |
| `electron/src/renderer/lib/*.ts` | 5a-4 | **New** — parsers, formatters |
