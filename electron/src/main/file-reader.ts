// Main process file reader — direct reads from ~/.memory-system/
// Fast, no CLI subprocess overhead. Used for all read operations.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type {
  TopicSummary,
  KnowledgePageData,
  KnowledgeSectionData,
  SessionNoteSummary,
  SessionNoteData,
  DigestSummary,
  SystemStatus,
  ReviewQueueItemData,
  StarredItemData,
  UserNoteData,
  UserNoteFullData
} from './types'

// ============================================================================
// PATHS
// ============================================================================

function memoryDir(): string {
  return path.join(os.homedir(), '.memory-system')
}

/** Extract a readable project name from a transcript path like ~/.claude/projects/-Users-name-Coding-my-project/abc.jsonl */
function extractProjectName(sourcePath: string): string {
  if (!sourcePath) return ''
  try {
    const dirName = path.basename(path.dirname(sourcePath))
    const segments = dirName.split('-').filter(Boolean)
    const codingIdx = segments.findIndex(s => s.toLowerCase() === 'coding')
    if (codingIdx >= 0 && codingIdx < segments.length - 1) {
      return segments.slice(codingIdx + 1).join('-')
    }
    return segments.slice(-2).join('-')
  } catch {
    return ''
  }
}

function knowledgeDir(): string {
  return path.join(memoryDir(), 'knowledge')
}

function sessionNotesDir(): string {
  return path.join(memoryDir(), 'session-notes')
}

function digestsDir(): string {
  return path.join(memoryDir(), 'digests')
}

function notesDir(): string {
  return path.join(memoryDir(), 'notes')
}

// ============================================================================
// PARSERS (ported from src/knowledge-page.ts and src/session-notes.ts)
// ============================================================================

/** Parse YAML frontmatter from a markdown file. Returns { frontmatter, body }. */
function parseFrontmatter(raw: string): { fm: Record<string, any>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { fm: {}, body: raw }

  const fm: Record<string, any> = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    let value: any = line.slice(colonIdx + 1).trim()

    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (/^\d+$/.test(value)) value = parseInt(value, 10)
    else if ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else if (value.startsWith('[')) {
      try { value = JSON.parse(value) } catch { value = [] }
    }
    fm[key] = value
  }

  return { fm, body: match[2] }
}

/** Parse HTML comment metadata from knowledge page sections. */
function parseMetaComment(line: string): Record<string, string> | null {
  const match = line.match(/^<!--\s*(.+?)\s*-->$/)
  if (!match) return null

  const pairs: Record<string, string> = {}
  for (const segment of match[1].split(' | ')) {
    const colonIdx = segment.indexOf(':')
    if (colonIdx === -1) continue
    const key = segment.slice(0, colonIdx).trim()
    const value = segment.slice(colonIdx + 1).trim()
    if (key && value) pairs[key] = value
  }
  return pairs
}

/** Parse a knowledge page into structured data with section metadata. */
function parseKnowledgePage(raw: string): KnowledgePageData {
  const { fm, body } = parseFrontmatter(raw)

  const sections: KnowledgeSectionData[] = []
  const lines = body.split('\n')
  const HEADING_RE = /^#{2}\s+(.+)$/
  let i = 0

  while (i < lines.length) {
    const headingMatch = lines[i].match(HEADING_RE)
    if (!headingMatch) { i++; continue }

    const title = headingMatch[1].trim()
    i++

    // 3-line lookahead for metadata comment
    let meta: Record<string, string> | null = null
    let metaLineIdx = -1
    for (let lookahead = 0; lookahead < 3 && i + lookahead < lines.length; lookahead++) {
      const candidate = lines[i + lookahead].trim()
      if (candidate === '') continue
      meta = parseMetaComment(candidate)
      if (meta) { metaLineIdx = i + lookahead; break }
      break
    }
    if (metaLineIdx >= 0) i = metaLineIdx + 1

    // Collect content until next heading or EOF
    const contentLines: string[] = []
    while (i < lines.length && !HEADING_RE.test(lines[i])) {
      contentLines.push(lines[i])
      i++
    }

    sections.push({
      id: meta?.id || '',
      title,
      content: contentLines.join('\n').trim(),
      confidence: meta?.confidence || 'uncertain',
      source: meta?.source || '',
      added: meta?.added || '',
      related_bullets: meta?.related_bullets
        ? meta.related_bullets.split(',').map(s => s.trim()).filter(Boolean)
        : []
    })
  }

  return {
    frontmatter: {
      topic: fm.topic || '',
      description: fm.description || '',
      source: fm.source || 'system',
      created: fm.created || '',
      last_updated: fm.last_updated || ''
    },
    sections,
    raw
  }
}

// ============================================================================
// READERS
// ============================================================================

export async function readTopics(): Promise<TopicSummary[]> {
  const topicsPath = path.join(memoryDir(), 'topics.json')
  try {
    const raw = await fsp.readFile(topicsPath, 'utf-8')
    const data = JSON.parse(raw)
    const topics = data.topics || []

    // Enrich with knowledge page metadata (supports directory + legacy flat file)
    const result: TopicSummary[] = []
    for (const t of topics) {
      let sectionCount = 0
      let wordCount = 0
      let lastUpdated: string | null = null

      // Try directory model first
      const topicDir = path.join(knowledgeDir(), t.slug)
      try {
        const stat = await fsp.stat(topicDir)
        if (stat.isDirectory()) {
          const subFiles = await fsp.readdir(topicDir)
          for (const sf of subFiles) {
            if (!sf.endsWith('.md')) continue
            try {
              const pageRaw = await fsp.readFile(path.join(topicDir, sf), 'utf-8')
              const page = parseKnowledgePage(pageRaw)
              sectionCount += page.sections.length
              wordCount += page.sections.reduce((sum, s) => sum + s.content.split(/\s+/).length, 0)
              if (page.frontmatter.last_updated && (!lastUpdated || page.frontmatter.last_updated > lastUpdated)) {
                lastUpdated = page.frontmatter.last_updated
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch {
        // Fall back to legacy flat file
        const pagePath = path.join(knowledgeDir(), `${t.slug}.md`)
        try {
          const pageRaw = await fsp.readFile(pagePath, 'utf-8')
          const page = parseKnowledgePage(pageRaw)
          sectionCount = page.sections.length
          wordCount = page.sections.reduce((sum, s) => sum + s.content.split(/\s+/).length, 0)
          lastUpdated = page.frontmatter.last_updated || null
        } catch { /* no knowledge page yet */ }
      }

      result.push({
        slug: t.slug,
        name: t.name,
        description: t.description || '',
        source: t.source || 'user',
        created: t.created || '',
        sectionCount,
        wordCount,
        lastUpdated
      })
    }

    return result
  } catch {
    return []
  }
}

/** List sub-pages for a topic directory. Returns slugs (without .md). */
export async function readSubPages(topicSlug: string): Promise<string[]> {
  const topicDir = path.join(knowledgeDir(), topicSlug)
  try {
    const files = await fsp.readdir(topicDir)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
      .sort((a, b) => {
        if (a === '_index') return -1
        if (b === '_index') return 1
        return a.localeCompare(b)
      })
  } catch {
    return []
  }
}

export async function readKnowledgePage(slug: string, subPage?: string): Promise<KnowledgePageData | null> {
  // Try directory model first
  if (subPage) {
    const spPath = path.join(knowledgeDir(), slug, `${subPage}.md`)
    try {
      const raw = await fsp.readFile(spPath, 'utf-8')
      return parseKnowledgePage(raw)
    } catch { return null }
  }

  // Default: try _index.md in directory, then legacy flat file
  const indexPath = path.join(knowledgeDir(), slug, '_index.md')
  try {
    const raw = await fsp.readFile(indexPath, 'utf-8')
    return parseKnowledgePage(raw)
  } catch { /* try legacy */ }

  const pagePath = path.join(knowledgeDir(), `${slug}.md`)
  try {
    const raw = await fsp.readFile(pagePath, 'utf-8')
    return parseKnowledgePage(raw)
  } catch {
    return null
  }
}

export async function readSessionNotes(limit = 50): Promise<SessionNoteSummary[]> {
  try {
    const files = await fsp.readdir(sessionNotesDir())
    const notes: SessionNoteSummary[] = []

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      try {
        const raw = await fsp.readFile(path.join(sessionNotesDir(), file), 'utf-8')
        const { fm } = parseFrontmatter(raw)
        notes.push({
          id: fm.id || file.replace('.md', ''),
          created: fm.created || '',
          title: fm.title || '',
          last_updated: fm.last_updated || '',
          abstract: fm.abstract || '',
          topics_touched: Array.isArray(fm.topics_touched) ? fm.topics_touched : [],
          processed: fm.processed === true,
          user_edited: fm.user_edited === true
        })
      } catch { /* skip unparseable */ }
    }

    notes.sort((a, b) => (b.last_updated > a.last_updated ? 1 : b.last_updated < a.last_updated ? -1 : 0))
    return notes.slice(0, limit)
  } catch {
    return []
  }
}

export async function readSessionNote(id: string): Promise<SessionNoteData | null> {
  const notePath = path.join(sessionNotesDir(), `${id}.md`)
  try {
    const raw = await fsp.readFile(notePath, 'utf-8')
    const { fm, body } = parseFrontmatter(raw)
    return {
      frontmatter: {
        id: fm.id || id,
        title: fm.title || '',
        created: fm.created || '',
        last_updated: fm.last_updated || '',
        abstract: fm.abstract || '',
        topics_touched: Array.isArray(fm.topics_touched) ? fm.topics_touched : [],
        processed: fm.processed === true,
        user_edited: fm.user_edited === true
      },
      body
    }
  } catch {
    return null
  }
}

export async function readDigests(limit = 30): Promise<DigestSummary[]> {
  try {
    const files = await fsp.readdir(digestsDir())
    const digests: DigestSummary[] = files
      .filter(f => f.endsWith('.md'))
      .map(f => ({ date: f.replace('.md', ''), filename: f }))
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))

    return digests.slice(0, limit)
  } catch {
    return []
  }
}

export async function readDigest(date: string): Promise<string | null> {
  const digestPath = path.join(digestsDir(), `${date}.md`)
  try {
    return await fsp.readFile(digestPath, 'utf-8')
  } catch {
    return null
  }
}

export async function readStatus(): Promise<SystemStatus> {
  const statePath = path.join(memoryDir(), 'state.json')
  const topicsPath = path.join(memoryDir(), 'topics.json')

  let state: Record<string, any> = {}
  try {
    state = JSON.parse(await fsp.readFile(statePath, 'utf-8'))
  } catch { /* no state yet */ }

  let topicCount = 0
  try {
    const topics = JSON.parse(await fsp.readFile(topicsPath, 'utf-8'))
    topicCount = topics.topics?.length || 0
  } catch { /* no topics yet */ }

  // Count unprocessed session notes
  let unprocessedCount = 0
  try {
    const files = await fsp.readdir(sessionNotesDir())
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      try {
        const raw = await fsp.readFile(path.join(sessionNotesDir(), file), 'utf-8')
        const { fm } = parseFrontmatter(raw)
        if (fm.processed !== true) unprocessedCount++
      } catch { /* skip */ }
    }
  } catch { /* dir doesn't exist */ }

  return {
    lastReflectionRun: state.lastReflectionRun || null,
    lastPeriodicJobRun: state.lastPeriodicJobRun || null,
    lastIndexUpdate: state.lastIndexUpdate || null,
    topicCount,
    unprocessedSessionNotes: unprocessedCount
  }
}

export async function readReviewQueue(): Promise<ReviewQueueItemData[]> {
  const queuePath = path.join(memoryDir(), 'review-queue.json')
  try {
    const raw = await fsp.readFile(queuePath, 'utf-8')
    const data = JSON.parse(raw)
    return (data.items || []).map((item: any) => ({
      id: item.id,
      type: item.type,
      status: item.status,
      created: item.created,
      target_topic: item.target_topic || '',
      target_path: item.target_path,
      target_section: item.target_section,
      reason: item.reason,
      data: item.data,
      source: item.source
    }))
  } catch {
    return []
  }
}

export async function readStarred(): Promise<StarredItemData[]> {
  const starredPath = path.join(memoryDir(), 'starred.json')
  try {
    const raw = await fsp.readFile(starredPath, 'utf-8')
    const data = JSON.parse(raw)
    return data.items || []
  } catch {
    return []
  }
}

export async function readUserNotes(): Promise<UserNoteData[]> {
  try {
    const files = await fsp.readdir(notesDir())
    const notes: UserNoteData[] = []

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      try {
        const raw = await fsp.readFile(path.join(notesDir(), file), 'utf-8')
        const { fm } = parseFrontmatter(raw)
        notes.push({
          id: fm.id || file.replace('.md', ''),
          title: fm.title || 'Untitled',
          created: fm.created || '',
          topics: Array.isArray(fm.topics) ? fm.topics : [],
          starred: fm.starred === true
        })
      } catch { /* skip */ }
    }

    notes.sort((a, b) => (b.created > a.created ? 1 : b.created < a.created ? -1 : 0))
    return notes
  } catch {
    return []
  }
}

export async function readUserNote(id: string): Promise<UserNoteFullData | null> {
  const notePath = path.join(notesDir(), `${id}.md`)
  try {
    const raw = await fsp.readFile(notePath, 'utf-8')
    const { fm, body } = parseFrontmatter(raw)
    return {
      frontmatter: {
        id: fm.id || id,
        title: fm.title || 'Untitled',
        created: fm.created || '',
        topics: Array.isArray(fm.topics) ? fm.topics : [],
        starred: fm.starred === true
      },
      body
    }
  } catch {
    return null
  }
}

// ============================================================================
// FILE WRITER (for editor save)
// ============================================================================

/** Atomic write: write to temp file then rename. */
export async function saveFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(memoryDir(), relativePath)

  // Security: ensure path stays under ~/.memory-system/
  const resolved = path.resolve(fullPath)
  const base = memoryDir()
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path traversal detected: path must be under ~/.memory-system/')
  }

  await fsp.mkdir(path.dirname(fullPath), { recursive: true })
  const tmpPath = fullPath + '.tmp'
  await fsp.writeFile(tmpPath, content, 'utf-8')
  await fsp.rename(tmpPath, fullPath)
}

// ============================================================================
// TRANSCRIPTS
// ============================================================================

export interface TranscriptInfo {
  sessionId: string
  project: string
  filePath: string
  sizeKB: number
  date: string
  hasSessionNote: boolean
}

export async function readTranscripts(): Promise<TranscriptInfo[]> {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects')
  const results: TranscriptInfo[] = []

  try {
    const projects = await fsp.readdir(claudeDir, { withFileTypes: true })
    for (const proj of projects) {
      if (!proj.isDirectory()) continue
      const projPath = path.join(claudeDir, proj.name)
      // Extract readable project name from dir name like -Users-name-Coding-my-project
      const segments = proj.name.split('-').filter(Boolean)
      const codingIdx = segments.findIndex(s => s.toLowerCase() === 'coding')
      const projectName = codingIdx >= 0 && codingIdx < segments.length - 1
        ? segments.slice(codingIdx + 1).join('-')
        : segments.slice(-2).join('-')

      try {
        const files = await fsp.readdir(projPath)
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          try {
            const filePath = path.join(projPath, file)
            const stat = await fsp.stat(filePath)
            const basename = file.replace('.jsonl', '')
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)
            const sessionId = isUUID ? `session-${basename}` : `session-${basename.slice(0, 16)}`

            // Check if a session note exists
            const notePath = path.join(memoryDir(), 'session-notes', `${sessionId}.md`)
            let hasNote = false
            try { await fsp.access(notePath); hasNote = true } catch {}

            results.push({
              sessionId,
              project: projectName,
              filePath,
              sizeKB: Math.round(stat.size / 1024),
              date: stat.mtime.toISOString().split('T')[0],
              hasSessionNote: hasNote,
            })
          } catch { /* skip */ }
        }
      } catch { /* skip project */ }
    }
  } catch { /* no claude dir */ }

  // Sort by date descending
  results.sort((a, b) => b.date.localeCompare(a.date))
  return results
}

/**
 * Format JSONL transcript entries into readable markdown.
 * Shared by readTranscriptChunk.
 */
function formatTranscriptEntries(raw: string): string[] {
  const lines = raw.split('\n').filter(l => l.trim())
  const formatted: string[] = []

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)

      if (entry.type === 'user' || entry.type === 'assistant') {
        const msg = entry.message
        if (!msg) continue

        let text = ''
        const content = msg.content || msg
        if (typeof content === 'string') {
          text = content
        } else if (Array.isArray(content)) {
          text = content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text || '')
            .join('\n')
            .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
            .replace(/<[^>]+\/>/g, '')
        }

        text = text.trim()
        if (!text) continue

        const role = entry.type === 'user' ? '**User**' : '**Assistant**'
        formatted.push(`${role}:\n${text.slice(0, 2000)}`)
      } else if (entry.message?.content && Array.isArray(entry.message.content)) {
        for (const b of entry.message.content) {
          if (b.type === 'tool_use') {
            formatted.push(`> Tool: **${b.name}**`)
          }
        }
      }
    } catch { /* skip non-JSON lines */ }
  }

  return formatted
}

/** Read a chunk of a transcript file from a byte offset. Returns { content, bytesRead, totalSize, hasMore }. */
export async function readTranscriptChunk(
  filePath: string,
  offset: number = 0,
  chunkSize: number = 500_000
): Promise<{ content: string; bytesRead: number; totalSize: number; hasMore: boolean }> {
  try {
    const stat = await fsp.stat(filePath)
    const totalSize = stat.size

    if (offset >= totalSize) {
      return { content: '', bytesRead: 0, totalSize, hasMore: false }
    }

    const fd = await fsp.open(filePath, 'r')
    const readSize = Math.min(chunkSize, totalSize - offset)
    const buf = Buffer.alloc(readSize)
    const { bytesRead } = await fd.read(buf, 0, readSize, offset)
    await fd.close()

    const raw = buf.toString('utf-8', 0, bytesRead)
    const formatted = formatTranscriptEntries(raw)
    const content = formatted.join('\n\n')
    const hasMore = offset + bytesRead < totalSize

    return { content, bytesRead, totalSize, hasMore }
  } catch (err) {
    return { content: `(Could not read transcript: ${err})`, bytesRead: 0, totalSize: 0, hasMore: false }
  }
}

export { memoryDir }
