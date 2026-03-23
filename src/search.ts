/**
 * search.ts — SQLite FTS5 search index for the memory system.
 *
 * SQLite is the search index, files are the source of truth.
 * This module provides:
 *   - Schema creation (sessions, topics, FTS5 virtual tables)
 *   - Index/upsert operations for each content type
 *   - Full-text search across knowledge, sessions, transcripts, notes, digests
 *   - Lifecycle (open, close, rebuild)
 *
 * Uses bun:sqlite (built-in, zero external deps, FTS5 supported).
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ============================================================================
// SCHEMA
// ============================================================================

const SCHEMA_SQL = `
-- Structured session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  abstract TEXT,
  filepath TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  last_offset INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- Session-topic associations
CREATE TABLE IF NOT EXISTS session_topics (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  topic_slug TEXT NOT NULL,
  PRIMARY KEY (session_id, topic_slug)
);

-- FTS5 virtual tables for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_knowledge USING fts5(
  topic, section_title, content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_sessions USING fts5(
  id, abstract, content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_transcripts USING fts5(
  session_id, chunk_offset, content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_notes USING fts5(
  id, title, content,
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_digests USING fts5(
  date, content,
  tokenize='porter unicode61'
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

const CURRENT_SCHEMA_VERSION = "1";

// ============================================================================
// TYPES
// ============================================================================

export interface SearchHit {
  table: "knowledge" | "sessions" | "transcripts" | "notes" | "digests";
  id: string;
  snippet: string;
  rank: number;
}

export interface SessionRow {
  id: string;
  date: string;
  abstract?: string;
  filepath: string;
  processed?: boolean;
  last_offset?: number;
}

export interface KnowledgeRow {
  topic: string;
  section_title: string;
  content: string;
}

export interface TranscriptChunk {
  session_id: string;
  chunk_offset: string;
  content: string;
}

export interface NoteRow {
  id: string;
  title: string;
  content: string;
}

export interface DigestRow {
  date: string;
  content: string;
}

// ============================================================================
// SEARCH INDEX
// ============================================================================

export class SearchIndex {
  private db: Database;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.initSchema();
  }

  private initSchema(): void {
    const version = this.getMetaValue("schema_version");
    if (version === CURRENT_SCHEMA_VERSION) return;

    this.db.exec(SCHEMA_SQL);
    this.setMetaValue("schema_version", CURRENT_SCHEMA_VERSION);
  }

  // --- Meta helpers ---

  private getMetaValue(key: string): string | null {
    try {
      const row = this.db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null;
      return row?.value ?? null;
    } catch {
      return null;
    }
  }

  private setMetaValue(key: string, value: string): void {
    this.db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ($key, $value)").run({
      $key: key,
      $value: value,
    });
  }

  // --- Session operations ---

  upsertSession(row: SessionRow): void {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO sessions (id, date, abstract, filepath, processed, last_offset, created_at, updated_at)
      VALUES ($id, $date, $abstract, $filepath, $processed, $last_offset, $now, $now)
      ON CONFLICT(id) DO UPDATE SET
        date = $date,
        abstract = $abstract,
        filepath = $filepath,
        processed = $processed,
        last_offset = $last_offset,
        updated_at = $now
    `).run({
      $id: row.id,
      $date: row.date,
      $abstract: row.abstract ?? null,
      $filepath: row.filepath,
      $processed: row.processed ? 1 : 0,
      $last_offset: row.last_offset ?? 0,
      $now: now,
    });
  }

  setSessionTopics(sessionId: string, topicSlugs: string[]): void {
    this.db.query("DELETE FROM session_topics WHERE session_id = ?").run(sessionId);
    const insert = this.db.query(
      "INSERT INTO session_topics (session_id, topic_slug) VALUES ($sid, $slug)"
    );
    for (const slug of topicSlugs) {
      insert.run({ $sid: sessionId, $slug: slug });
    }
  }

  getSession(id: string): SessionRow | null {
    return this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
  }

  getUnprocessedSessions(): SessionRow[] {
    return this.db.query("SELECT * FROM sessions WHERE processed = 0 ORDER BY date ASC").all() as SessionRow[];
  }

  // --- FTS index operations ---

  indexKnowledge(row: KnowledgeRow): void {
    this.db.query(
      "DELETE FROM fts_knowledge WHERE topic = $topic AND section_title = $title"
    ).run({ $topic: row.topic, $title: row.section_title });

    this.db.query(
      "INSERT INTO fts_knowledge (topic, section_title, content) VALUES ($topic, $title, $content)"
    ).run({ $topic: row.topic, $title: row.section_title, $content: row.content });
  }

  indexSession(id: string, abstract: string, content: string): void {
    this.db.query("DELETE FROM fts_sessions WHERE id = $id").run({ $id: id });
    this.db.query(
      "INSERT INTO fts_sessions (id, abstract, content) VALUES ($id, $abstract, $content)"
    ).run({ $id: id, $abstract: abstract, $content: content });
  }

  indexTranscriptChunk(chunk: TranscriptChunk): void {
    this.db.query(
      "DELETE FROM fts_transcripts WHERE session_id = $sid AND chunk_offset = $offset"
    ).run({ $sid: chunk.session_id, $offset: chunk.chunk_offset });

    this.db.query(
      "INSERT INTO fts_transcripts (session_id, chunk_offset, content) VALUES ($sid, $offset, $content)"
    ).run({ $sid: chunk.session_id, $offset: chunk.chunk_offset, $content: chunk.content });
  }

  indexNote(row: NoteRow): void {
    this.db.query("DELETE FROM fts_notes WHERE id = $id").run({ $id: row.id });
    this.db.query(
      "INSERT INTO fts_notes (id, title, content) VALUES ($id, $title, $content)"
    ).run({ $id: row.id, $title: row.title, $content: row.content });
  }

  indexDigest(row: DigestRow): void {
    this.db.query("DELETE FROM fts_digests WHERE date = $date").run({ $date: row.date });
    this.db.query(
      "INSERT INTO fts_digests (date, content) VALUES ($date, $content)"
    ).run({ $date: row.date, $content: row.content });
  }

  // --- Search ---

  search(query: string, options?: { tables?: SearchHit["table"][]; limit?: number }): SearchHit[] {
    const limit = options?.limit ?? 20;
    const tables = options?.tables ?? ["knowledge", "sessions", "transcripts", "notes", "digests"];
    const results: SearchHit[] = [];

    // Escape query for FTS5: wrap each word in quotes to avoid syntax errors
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map(w => `"${w.replace(/"/g, '""')}"`)
      .join(" ");

    if (!ftsQuery) return results;

    if (tables.includes("knowledge")) {
      const rows = this.db.query(`
        SELECT topic AS id, snippet(fts_knowledge, 2, '<b>', '</b>', '...', 32) AS snippet, rank
        FROM fts_knowledge WHERE fts_knowledge MATCH $q
        ORDER BY rank LIMIT $limit
      `).all({ $q: ftsQuery, $limit: limit }) as Array<{ id: string; snippet: string; rank: number }>;
      results.push(...rows.map(r => ({ table: "knowledge" as const, ...r })));
    }

    if (tables.includes("sessions")) {
      const rows = this.db.query(`
        SELECT id, snippet(fts_sessions, 1, '<b>', '</b>', '...', 32) AS snippet, rank
        FROM fts_sessions WHERE fts_sessions MATCH $q
        ORDER BY rank LIMIT $limit
      `).all({ $q: ftsQuery, $limit: limit }) as Array<{ id: string; snippet: string; rank: number }>;
      results.push(...rows.map(r => ({ table: "sessions" as const, ...r })));
    }

    if (tables.includes("transcripts")) {
      const rows = this.db.query(`
        SELECT session_id AS id, snippet(fts_transcripts, 2, '<b>', '</b>', '...', 32) AS snippet, rank
        FROM fts_transcripts WHERE fts_transcripts MATCH $q
        ORDER BY rank LIMIT $limit
      `).all({ $q: ftsQuery, $limit: limit }) as Array<{ id: string; snippet: string; rank: number }>;
      results.push(...rows.map(r => ({ table: "transcripts" as const, ...r })));
    }

    if (tables.includes("notes")) {
      const rows = this.db.query(`
        SELECT id, snippet(fts_notes, 2, '<b>', '</b>', '...', 32) AS snippet, rank
        FROM fts_notes WHERE fts_notes MATCH $q
        ORDER BY rank LIMIT $limit
      `).all({ $q: ftsQuery, $limit: limit }) as Array<{ id: string; snippet: string; rank: number }>;
      results.push(...rows.map(r => ({ table: "notes" as const, ...r })));
    }

    if (tables.includes("digests")) {
      const rows = this.db.query(`
        SELECT date AS id, snippet(fts_digests, 1, '<b>', '</b>', '...', 32) AS snippet, rank
        FROM fts_digests WHERE fts_digests MATCH $q
        ORDER BY rank LIMIT $limit
      `).all({ $q: ftsQuery, $limit: limit }) as Array<{ id: string; snippet: string; rank: number }>;
      results.push(...rows.map(r => ({ table: "digests" as const, ...r })));
    }

    // Sort all results by rank (lower is better in FTS5)
    results.sort((a, b) => a.rank - b.rank);
    return results.slice(0, limit);
  }

  // --- Lifecycle ---

  /** Drop all FTS content and rebuild from scratch. */
  clearAllFts(): void {
    this.db.exec("DELETE FROM fts_knowledge;");
    this.db.exec("DELETE FROM fts_sessions;");
    this.db.exec("DELETE FROM fts_transcripts;");
    this.db.exec("DELETE FROM fts_notes;");
    this.db.exec("DELETE FROM fts_digests;");
  }

  close(): void {
    this.db.close();
  }

  /** Expose the raw database for advanced operations (e.g., transactions). */
  get raw(): Database {
    return this.db;
  }
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

/**
 * Open (or create) a SearchIndex at the given path.
 * This is the main entry point for consuming code.
 */
export function openSearchIndex(dbPath: string): SearchIndex {
  return new SearchIndex(dbPath);
}
