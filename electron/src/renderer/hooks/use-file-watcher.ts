import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** Listen for file-change signals from the main process and invalidate all queries. */
export function useFileWatcher(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const unsubscribe = window.electronAPI.onFileChanged(() => {
      queryClient.invalidateQueries()
    })
    return unsubscribe
  }, [queryClient])
}
