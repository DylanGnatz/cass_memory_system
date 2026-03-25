/**
 * Unit tests for src/search.ts — SQLite FTS5 search index.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SearchIndex, openSearchIndex } from "../src/search.js";

function createTempDb(): { dbPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "search-test-"));
  const dbPath = join(dir, "search.db");
  return {
    dbPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("SearchIndex", () => {
  let temp: ReturnType<typeof createTempDb>;
  let index: SearchIndex;

  afterEach(() => {
    try { index?.close(); } catch {}
    try { temp?.cleanup(); } catch {}
  });

  test("creates database and schema on construction", () => {
    temp = createTempDb();
    index = new SearchIndex(temp.dbPath);

    // Verify meta table has schema version
    const row = index.raw.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("1");
  });

  test("openSearchIndex factory works", () => {
    temp = createTempDb();
    index = openSearchIndex(temp.dbPath);
    expect(index).toBeInstanceOf(SearchIndex);
  });

  test("idempotent schema initialization on reopen", () => {
    temp = createTempDb();
    index = new SearchIndex(temp.dbPath);
    index.close();

    // Reopen — should not fail or duplicate tables
    index = new SearchIndex(temp.dbPath);
    const row = index.raw.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(row.value).toBe("1");
  });

  describe("session operations", () => {
    test("upsertSession inserts and retrieves", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.upsertSession({
        id: "session-001",
        date: "2026-03-20",
        abstract: "Worked on billing service",
        filepath: "session-notes/session-001.md",
      });

      const session = index.getSession("session-001");
      expect(session).toBeTruthy();
      expect(session!.id).toBe("session-001");
      expect(session!.date).toBe("2026-03-20");
      expect(session!.abstract).toBe("Worked on billing service");
    });

    test("upsertSession updates existing row", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.upsertSession({
        id: "session-001",
        date: "2026-03-20",
        abstract: "v1",
        filepath: "session-notes/session-001.md",
      });

      index.upsertSession({
        id: "session-001",
        date: "2026-03-20",
        abstract: "v2 updated",
        filepath: "session-notes/session-001.md",
        processed: true,
      });

      const session = index.getSession("session-001");
      expect(session!.abstract).toBe("v2 updated");
    });

    test("getUnprocessedSessions returns only unprocessed", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.upsertSession({ id: "s1", date: "2026-03-20", filepath: "a.md", processed: false });
      index.upsertSession({ id: "s2", date: "2026-03-21", filepath: "b.md", processed: true });
      index.upsertSession({ id: "s3", date: "2026-03-22", filepath: "c.md", processed: false });

      const unprocessed = index.getUnprocessedSessions();
      expect(unprocessed.length).toBe(2);
      expect(unprocessed.map(s => s.id)).toEqual(["s1", "s3"]);
    });

    test("setSessionTopics links and replaces topics", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.upsertSession({ id: "s1", date: "2026-03-20", filepath: "a.md" });
      index.setSessionTopics("s1", ["billing", "auth"]);

      const rows = index.raw.query(
        "SELECT topic_slug FROM session_topics WHERE session_id = 's1' ORDER BY topic_slug"
      ).all() as Array<{ topic_slug: string }>;
      expect(rows.map(r => r.topic_slug)).toEqual(["auth", "billing"]);

      // Replace topics
      index.setSessionTopics("s1", ["billing"]);
      const rows2 = index.raw.query(
        "SELECT topic_slug FROM session_topics WHERE session_id = 's1'"
      ).all() as Array<{ topic_slug: string }>;
      expect(rows2.length).toBe(1);
    });
  });

  describe("FTS indexing and search", () => {
    test("indexes and searches knowledge pages", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexKnowledge({
        topic: "billing-service",
        section_title: "Retry Logic",
        content: "The billing service uses exponential backoff for payment retries with a max of 5 attempts.",
      });

      const results = index.search("payment retries", { tables: ["knowledge"] });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].table).toBe("knowledge");
      expect(results[0].id).toBe("billing-service");
    });

    test("indexes and searches session notes", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexSession("session-001", "Fixed authentication bug", "Debugged the OAuth token refresh flow and fixed a race condition in the session handler.");

      const results = index.search("OAuth token", { tables: ["sessions"] });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("session-001");
    });

    test("indexes and searches transcript chunks", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexTranscriptChunk({
        session_id: "session-001",
        chunk_offset: "0",
        content: "The user asked about database migration strategies for PostgreSQL.",
      });

      const results = index.search("database migration", { tables: ["transcripts"] });
      expect(results.length).toBe(1);
      expect(results[0].table).toBe("transcripts");
    });

    test("indexes and searches user notes", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexNote({
        id: "note-001",
        title: "Auth Service Quirks",
        content: "The auth service returns 403 instead of 401 for expired tokens. This is intentional per the security team.",
      });

      const results = index.search("expired tokens", { tables: ["notes"] });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("note-001");
    });

    test("indexes and searches daily digests", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexDigest({
        date: "2026-03-20",
        content: "Spent the day debugging webhook delivery failures in the notification service.",
      });

      const results = index.search("webhook delivery", { tables: ["digests"] });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("2026-03-20");
    });

    test("cross-table search returns results from multiple tables", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexKnowledge({ topic: "auth", section_title: "Overview", content: "Authentication uses JWT tokens" });
      index.indexSession("s1", "Auth work", "Implemented JWT token rotation");
      index.indexNote({ id: "n1", title: "Auth Notes", content: "JWT tokens expire after 1 hour" });

      const results = index.search("JWT tokens");
      expect(results.length).toBe(3);
      const tables = results.map(r => r.table);
      expect(tables).toContain("knowledge");
      expect(tables).toContain("sessions");
      expect(tables).toContain("notes");
    });

    test("search respects limit", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      for (let i = 0; i < 10; i++) {
        index.indexKnowledge({ topic: `topic-${i}`, section_title: "Overview", content: `Information about testing patterns ${i}` });
      }

      const results = index.search("testing patterns", { limit: 3 });
      expect(results.length).toBe(3);
    });

    test("search returns empty for no matches", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexKnowledge({ topic: "auth", section_title: "Overview", content: "Authentication system" });

      const results = index.search("zyxwvutsrqp");
      expect(results.length).toBe(0);
    });

    test("search handles empty query", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      const results = index.search("");
      expect(results.length).toBe(0);
    });

    test("indexKnowledge replaces existing entry for same topic+section", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexKnowledge({ topic: "auth", section_title: "Overview", content: "version 1 old content" });
      index.indexKnowledge({ topic: "auth", section_title: "Overview", content: "version 2 updated content" });

      const results = index.search("version", { tables: ["knowledge"] });
      // Should only match "version 2" (old entry replaced)
      expect(results.length).toBe(1);
      expect(results[0].snippet).toContain("updated content");
    });
  });

  describe("lifecycle", () => {
    test("clearAllFts removes all FTS content", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.indexKnowledge({ topic: "auth", section_title: "Overview", content: "Auth stuff" });
      index.indexSession("s1", "Work", "Did some work");

      index.clearAllFts();

      expect(index.search("auth").length).toBe(0);
      expect(index.search("work").length).toBe(0);
    });

    test("clearAllFts does not remove session metadata", () => {
      temp = createTempDb();
      index = new SearchIndex(temp.dbPath);

      index.upsertSession({ id: "s1", date: "2026-03-20", filepath: "a.md" });
      index.indexSession("s1", "Work", "Content");

      index.clearAllFts();

      // Metadata table should still have the session
      const session = index.getSession("s1");
      expect(session).toBeTruthy();
      // But FTS content should be gone
      expect(index.search("Work").length).toBe(0);
    });
  });
});
