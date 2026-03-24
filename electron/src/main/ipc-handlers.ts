// IPC handler registration — connects preload API to main process implementations.
// Each handler maps to a window.electronAPI method in the renderer.

import { ipcMain } from 'electron'
import {
  readTopics,
  readKnowledgePage,
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
import { cliAddTopic, cliRemoveTopic, cliRunReflection } from './cli-bridge'
import {
  approveReviewItem,
  dismissReviewItem,
  flagContent,
  starItem,
  unstarItem,
  createUserNote,
  saveUserNote,
  deleteUserNote
} from './file-ops'
import { isClaudeAvailable, sendMessage, resetConversation } from './claude'

export function registerIpcHandlers(): void {
  // ── File reads ──────────────────────────────────────────────────
  ipcMain.handle('get-topics', async () => {
    return readTopics()
  })

  ipcMain.handle('get-knowledge-page', async (_event, slug: string) => {
    return readKnowledgePage(slug)
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

  // ── Direct file operations ──────────────────────────────────────
  ipcMain.handle('approve-review-item', async (_event, id: string) => {
    return approveReviewItem(id)
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
}
