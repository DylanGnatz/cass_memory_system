// Shared types for the Electron app IPC layer.
// These are display-oriented types — the renderer never imports Zod schemas directly.

export interface TopicSummary {
  slug: string
  name: string
  description: string
  source: string
  created: string
  sectionCount: number
  wordCount: number
  lastUpdated: string | null
}

export interface KnowledgePageData {
  frontmatter: {
    topic: string
    description: string
    source: string
    created: string
    last_updated: string
  }
  sections: KnowledgeSectionData[]
  raw: string
}

export interface KnowledgeSectionData {
  id: string
  title: string
  content: string
  confidence: string
  source: string
  added: string
  related_bullets: string[]
}

export interface SessionNoteSummary {
  id: string
  title: string
  created: string
  last_updated: string
  abstract: string
  topics_touched: string[]
  processed: boolean
  user_edited: boolean
}

export interface SessionNoteData {
  frontmatter: SessionNoteSummary
  body: string
}

export interface DigestSummary {
  date: string
  filename: string
}

export interface SearchResult {
  type: 'knowledge' | 'session' | 'digest' | 'note' | 'transcript'
  id: string
  title: string
  snippet: string
  score: number
}

export interface SystemStatus {
  lastReflectionRun: string | null
  lastPeriodicJobRun: string | null
  lastIndexUpdate: string | null
  topicCount: number
  unprocessedSessionNotes: number
}

export interface StarredItemData {
  path: string
  section?: string
  starred_at: string
}

export interface ReviewQueueItemData {
  id: string
  type: string
  status: string
  created: string
  target_topic: string
  // Type-specific fields flattened
  target_path?: string
  target_section?: string
  reason?: string
  data?: Record<string, any>
  source?: Record<string, any>
}

export interface UserNoteData {
  id: string
  title: string
  created: string
  topics: string[]
  starred: boolean
}

export interface UserNoteFullData {
  frontmatter: UserNoteData
  body: string
}

export interface ReflectionResult {
  success: boolean
  message: string
  sessionsProcessed?: number
  deltasGenerated?: number
  errors?: string[]
}
