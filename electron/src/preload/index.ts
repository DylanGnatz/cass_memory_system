import { contextBridge, ipcRenderer } from 'electron'

// All IPC channels exposed to the renderer via contextBridge.
// The renderer calls window.electronAPI.<method>() — never accesses Node.js directly.

const electronAPI = {
  // File reads (direct, fast)
  getTopics: (): Promise<any[]> =>
    ipcRenderer.invoke('get-topics'),
  getKnowledgePage: (slug: string): Promise<any> =>
    ipcRenderer.invoke('get-knowledge-page', slug),
  getSessionNotes: (limit?: number): Promise<any[]> =>
    ipcRenderer.invoke('get-session-notes', limit),
  getSessionNote: (id: string): Promise<any> =>
    ipcRenderer.invoke('get-session-note', id),
  getDigests: (limit?: number): Promise<any[]> =>
    ipcRenderer.invoke('get-digests', limit),
  getDigest: (date: string): Promise<any> =>
    ipcRenderer.invoke('get-digest', date),
  getStatus: (): Promise<any> =>
    ipcRenderer.invoke('get-status'),
  getReviewQueue: (): Promise<any[]> =>
    ipcRenderer.invoke('get-review-queue'),
  getStarred: (): Promise<any[]> =>
    ipcRenderer.invoke('get-starred'),
  getUserNotes: (): Promise<any[]> =>
    ipcRenderer.invoke('get-user-notes'),
  getUserNote: (id: string): Promise<any> =>
    ipcRenderer.invoke('get-user-note', id),

  // Search (better-sqlite3, fast)
  search: (query: string, options?: { scope?: string; limit?: number }): Promise<any[]> =>
    ipcRenderer.invoke('search', query, options),

  // Mutations (CLI subprocess or direct write)
  saveFile: (relativePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('save-file', relativePath, content),
  runReflection: (): Promise<any> =>
    ipcRenderer.invoke('run-reflection'),
  addTopic: (slug: string, name: string, description: string): Promise<void> =>
    ipcRenderer.invoke('add-topic', slug, name, description),
  removeTopic: (slug: string, force?: boolean): Promise<void> =>
    ipcRenderer.invoke('remove-topic', slug, force),
  approveReviewItem: (id: string): Promise<void> =>
    ipcRenderer.invoke('approve-review-item', id),
  dismissReviewItem: (id: string): Promise<void> =>
    ipcRenderer.invoke('dismiss-review-item', id),
  flagContent: (path: string, section?: string, reason?: string): Promise<void> =>
    ipcRenderer.invoke('flag-content', path, section, reason),
  starItem: (path: string, section?: string): Promise<void> =>
    ipcRenderer.invoke('star-item', path, section),
  unstarItem: (path: string, section?: string): Promise<void> =>
    ipcRenderer.invoke('unstar-item', path, section),
  createUserNote: (title: string, content: string, topics?: string[]): Promise<string> =>
    ipcRenderer.invoke('create-user-note', title, content, topics),
  saveUserNote: (id: string, title: string, content: string): Promise<void> =>
    ipcRenderer.invoke('save-user-note', id, title, content),
  deleteUserNote: (id: string): Promise<void> =>
    ipcRenderer.invoke('delete-user-note', id),

  // Claude dialog
  claudeAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('claude-available'),
  claudeSend: (message: string, documentContext?: string): Promise<{ response: string; toolsUsed: string[] }> =>
    ipcRenderer.invoke('claude-send', message, documentContext),
  claudeReset: (): Promise<void> =>
    ipcRenderer.invoke('claude-reset'),

  // File watching — renderer listens for change signals
  onFileChanged: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('file-changed', handler)
    return () => ipcRenderer.removeListener('file-changed', handler)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

// Type declaration for renderer
export type ElectronAPI = typeof electronAPI
