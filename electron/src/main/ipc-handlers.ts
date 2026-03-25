// IPC handler registration — connects preload API to main process implementations.
// Each handler maps to a window.electronAPI method in the renderer.

import { ipcMain } from 'electron'
import {
  readTopics,
  readKnowledgePage,
  readSubPages,
  readTranscripts,
  readTranscriptChunk,
  readSessionNotes,
  readSessionNote,
  readDigests,
  readDigest,
  readStatus,
  readReviewQueue,
  readStarred,
  readUserNotes,
  readUserNote,
  saveFile
} from './file-reader'
import { search } from './search'
import { cliAddTopic, cliRemoveTopic, cliRunReflection, cliGenerateTopicKnowledge, cliGenerateSessionNote } from './cli-bridge'
import {
  approveReviewItem,
  dismissReviewItem,
  flagContent,
  starItem,
  unstarItem,
  addSubPage,
  deleteTopic,
  createUserNote,
  saveUserNote,
  deleteUserNote
} from './file-ops'
import { isClaudeAvailable, sendMessage, resetConversation } from './claude'
import { getApiKey, setApiKey, hasApiKey, getBudget, setBudget } from './settings'

export function registerIpcHandlers(): void {
  // ── File reads ──────────────────────────────────────────────────
  ipcMain.handle('get-topics', async () => {
    return readTopics()
  })

  ipcMain.handle('get-knowledge-page', async (_event, slug: string, subPage?: string) => {
    return readKnowledgePage(slug, subPage)
  })

  ipcMain.handle('get-sub-pages', async (_event, topicSlug: string) => {
    return readSubPages(topicSlug)
  })

  ipcMain.handle('get-session-notes', async (_event, limit?: number) => {
    return readSessionNotes(limit)
  })

  ipcMain.handle('get-session-note', async (_event, id: string) => {
    return readSessionNote(id)
  })

  ipcMain.handle('get-digests', async (_event, limit?: number) => {
    return readDigests(limit)
  })

  ipcMain.handle('get-digest', async (_event, date: string) => {
    return readDigest(date)
  })

  ipcMain.handle('get-status', async () => {
    return readStatus()
  })

  ipcMain.handle('get-review-queue', async () => {
    return readReviewQueue()
  })

  ipcMain.handle('get-starred', async () => {
    return readStarred()
  })

  ipcMain.handle('get-user-notes', async () => {
    return readUserNotes()
  })

  ipcMain.handle('get-user-note', async (_event, id: string) => {
    return readUserNote(id)
  })

  // ── Transcripts ────────────────────────────────────────────────
  ipcMain.handle('get-transcripts', async () => {
    return readTranscripts()
  })

  ipcMain.handle('get-transcript-chunk', async (_event, filePath: string, offset?: number) => {
    return readTranscriptChunk(filePath, offset || 0)
  })

  ipcMain.handle('generate-session-note', async (_event, sessionId: string, transcriptPath: string) => {
    return cliGenerateSessionNote(sessionId, transcriptPath)
  })

  // ── Search ──────────────────────────────────────────────────────
  ipcMain.handle('search', async (_event, query: string, options?: { scope?: string; limit?: number }) => {
    return search(query, options)
  })

  // ── File saves ──────────────────────────────────────────────────
  ipcMain.handle('save-file', async (_event, relativePath: string, content: string) => {
    return saveFile(relativePath, content)
  })

  // ── CLI operations ──────────────────────────────────────────────
  ipcMain.handle('run-reflection', async () => {
    return cliRunReflection()
  })

  ipcMain.handle('add-topic', async (_event, slug: string, name: string, description: string) => {
    return cliAddTopic(slug, name, description)
  })

  ipcMain.handle('remove-topic', async (_event, slug: string, force?: boolean) => {
    return cliRemoveTopic(slug, force)
  })

  ipcMain.handle('add-sub-page', async (_event, topicSlug: string, subPageSlug: string, name: string, description: string) => {
    return addSubPage(topicSlug, subPageSlug, name, description)
  })

  // ── Direct file operations ──────────────────────────────────────
  ipcMain.handle('approve-review-item', async (_event, id: string) => {
    const result = await approveReviewItem(id)
    // If a topic was approved, trigger background knowledge generation
    if (result.topicSlug) {
      cliGenerateTopicKnowledge(result.topicSlug).then(genResult => {
        console.log(`[ipc] Background generation for "${result.topicSlug}":`, genResult.message)
      }).catch(err => {
        console.error(`[ipc] Background generation failed for "${result.topicSlug}":`, err)
      })
    }
    return result
  })

  ipcMain.handle('delete-topic', async (_event, slug: string) => {
    return deleteTopic(slug)
  })

  ipcMain.handle('generate-topic-knowledge', async (_event, slug: string) => {
    return cliGenerateTopicKnowledge(slug)
  })

  ipcMain.handle('dismiss-review-item', async (_event, id: string) => {
    return dismissReviewItem(id)
  })

  ipcMain.handle('flag-content', async (_event, targetPath: string, section?: string, reason?: string) => {
    return flagContent(targetPath, section, reason)
  })

  ipcMain.handle('star-item', async (_event, itemPath: string, section?: string) => {
    return starItem(itemPath, section)
  })

  ipcMain.handle('unstar-item', async (_event, itemPath: string, section?: string) => {
    return unstarItem(itemPath, section)
  })

  ipcMain.handle('create-user-note', async (_event, title: string, content: string, topics?: string[]) => {
    return createUserNote(title, content, topics)
  })

  ipcMain.handle('save-user-note', async (_event, id: string, title: string, content: string) => {
    return saveUserNote(id, title, content)
  })

  ipcMain.handle('delete-user-note', async (_event, id: string) => {
    return deleteUserNote(id)
  })

  // ── Claude dialog ───────────────────────────────────────────────
  ipcMain.handle('claude-available', async () => {
    return isClaudeAvailable()
  })

  ipcMain.handle('claude-send', async (_event, message: string, documentContext?: string) => {
    return sendMessage(message, { documentContext })
  })

  ipcMain.handle('claude-reset', async () => {
    return resetConversation()
  })

  // ── Settings ────────────────────────────────────────────────────
  ipcMain.handle('get-api-key', async () => {
    const key = await getApiKey()
    if (!key) return null
    // Mask the key for display — only show last 8 chars
    return key.length > 12 ? '...' + key.slice(-8) : '(set)'
  })

  ipcMain.handle('has-api-key', async () => {
    return hasApiKey()
  })

  ipcMain.handle('set-api-key', async (_event, key: string) => {
    await setApiKey(key)
  })

  ipcMain.handle('get-budget', async () => {
    return getBudget()
  })

  ipcMain.handle('set-budget', async (_event, dailyLimit: number, monthlyLimit: number) => {
    await setBudget(dailyLimit, monthlyLimit)
  })
}
