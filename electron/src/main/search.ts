// Main process search — better-sqlite3 for sub-100ms FTS5 queries.
// Reads the existing search.db created by bun:sqlite (both are standard SQLite).

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { memoryDir } from './file-reader'
import type { SearchResult } from './types'

let db: Database.Database | null = null

/** Open search.db in readonly mode. Returns null if file doesn't exist. */
function getDb(): Database.Database | null {
  if (db) return db

  const dbPath = path.join(memoryDir(), 'search.db')
  if (!fs.existsSync(dbPath)) {
    console.log('[search] search.db not found at', dbPath)
    return null
  }

  try {
    db = new Database(dbPath, { readonly: true })
    console.log('[search] Opened search.db at', dbPath)
    return db
  } catch (err) {
    console.error('[search] Failed to open search.db:', err)
    return null
  }
}

/** Close the database connection (e.g., on app quit). */
export function closeSearchDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/** Reopen the database (e.g., after file watcher detects search.db change). */
export function reopenSearchDb(): void {
  closeSearchDb()
  // Will be lazily reopened on next query
}

/**
 * Search across FTS5 tables.
 * Returns ranked results with type badges and snippet previews.
 */
export function search(
  query: string,
  options?: { scope?: string; limit?: number }
): SearchResult[] {
  const database = getDb()
  if (!database) {
    console.log('[search] No database available, returning empty results')
    return []
  }

  const limit = options?.limit || 20
  const scope = options?.scope || 'all'

  // Wrap each word in quotes for FTS5 safety (prevents syntax errors)
  const ftsQuery = query
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => `"${w.replace(/"/g, '')}"`)
    .join(' ')

  if (!ftsQuery) return []

  console.log(`[search] query="${ftsQuery}" scope=${scope} limit=${limit}`)

  const results: SearchResult[] = []
  const seen = new Set<string>()

  function addResult(type: SearchResult['type'], id: string, title: string, snippet: string, rank: number): void {
    const key = `${type}:${id}`
    if (seen.has(key)) return
    seen.add(key)

    // Normalize FTS5 rank: 1/(1+abs(rank))
    const score = 1 / (1 + Math.abs(rank))
    results.push({ type, id, title, snippet, score })
  }

  try {
    // Knowledge pages
    if (scope === 'all' || scope === 'knowledge') {
      const rows = database.prepare(
        `SELECT topic, section_title, snippet(fts_knowledge, 2, '<mark>', '</mark>', '...', 40) as snippet, rank
         FROM fts_knowledge WHERE fts_knowledge MATCH ?
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[]

      for (const row of rows) {
        addResult('knowledge', row.topic, row.section_title || row.topic, row.snippet, row.rank)
      }
    }

    // Session notes
    if (scope === 'all' || scope === 'sessions') {
      const rows = database.prepare(
        `SELECT id, abstract, snippet(fts_sessions, 2, '<mark>', '</mark>', '...', 40) as snippet, rank
         FROM fts_sessions WHERE fts_sessions MATCH ?
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[]

      for (const row of rows) {
        addResult('session', row.id, row.abstract || row.id, row.snippet, row.rank)
      }
    }

    // Digests
    if (scope === 'all' || scope === 'digests') {
      const rows = database.prepare(
        `SELECT date, snippet(fts_digests, 1, '<mark>', '</mark>', '...', 40) as snippet, rank
         FROM fts_digests WHERE fts_digests MATCH ?
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[]

      for (const row of rows) {
        addResult('digest', row.date, `Digest: ${row.date}`, row.snippet, row.rank)
      }
    }

    // User notes
    if (scope === 'all' || scope === 'notes') {
      const rows = database.prepare(
        `SELECT id, title, snippet(fts_notes, 2, '<mark>', '</mark>', '...', 40) as snippet, rank
         FROM fts_notes WHERE fts_notes MATCH ?
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[]

      for (const row of rows) {
        addResult('note', row.id, row.title || row.id, row.snippet, row.rank)
      }
    }

    // Transcripts (ranked 0.5x lower than curated content)
    if (scope === 'transcripts') {
      const rows = database.prepare(
        `SELECT session_id, snippet(fts_transcripts, 2, '<mark>', '</mark>', '...', 40) as snippet, rank
         FROM fts_transcripts WHERE fts_transcripts MATCH ?
         ORDER BY rank LIMIT ?`
      ).all(ftsQuery, limit) as any[]

      for (const row of rows) {
        const score = (1 / (1 + Math.abs(row.rank))) * 0.5
        const key = `transcript:${row.session_id}`
        if (!seen.has(key)) {
          seen.add(key)
          results.push({ type: 'transcript', id: row.session_id, title: row.session_id, snippet: row.snippet, score })
        }
      }
    }
  } catch (err) {
    // FTS5 table may not exist yet — graceful degradation
    console.error('Search error:', err)
  }

  // Sort by score descending, limit total results
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}
