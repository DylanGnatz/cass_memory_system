// File watcher — chokidar on ~/.memory-system/ with debounce.
// Sends 'file-changed' signal to the renderer, which invalidates TanStack Query cache.

import { watch, type FSWatcher } from 'chokidar'
import path from 'node:path'
import { memoryDir } from './file-reader'
import { reopenSearchDb } from './search'

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function startWatcher(onChanged: () => void): void {
  const dir = memoryDir()

  watcher = watch(dir, {
    ignoreInitial: true,
    // Debounce atomic writes (temp file → rename produces two events)
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100
    },
    // Ignore noisy files that don't affect the UI
    ignored: [
      path.join(dir, '.periodic-job.lock'),
      path.join(dir, '.embedding-cache.json'),
      path.join(dir, 'cost'),
      path.join(dir, 'diary'),
      /\.tmp$/
    ]
  })

  watcher.on('all', (_event, filePath) => {
    // If search.db changed, reopen the connection
    if (filePath.endsWith('search.db')) {
      reopenSearchDb()
    }

    // Debounce the change signal — batch rapid file changes
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      onChanged()
    }, 300)
  })
}

export function stopWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
