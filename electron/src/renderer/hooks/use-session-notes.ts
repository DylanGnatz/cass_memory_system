import { useQuery } from '@tanstack/react-query'

export function useSessionNotes(limit?: number) {
  return useQuery({
    queryKey: ['session-notes', limit],
    queryFn: () => window.electronAPI.getSessionNotes(limit),
    staleTime: 10_000
  })
}

export function useSessionNote(id: string | null) {
  return useQuery({
    queryKey: ['session-note', id],
    queryFn: () => window.electronAPI.getSessionNote(id!),
    enabled: !!id,
    staleTime: 10_000
  })
}
