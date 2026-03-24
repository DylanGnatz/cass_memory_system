import { useQuery } from '@tanstack/react-query'

export function useUserNotes() {
  return useQuery({
    queryKey: ['user-notes'],
    queryFn: () => window.electronAPI.getUserNotes(),
    staleTime: 10_000
  })
}

export function useUserNote(id: string | null) {
  return useQuery({
    queryKey: ['user-note', id],
    queryFn: () => window.electronAPI.getUserNote(id!),
    enabled: !!id,
    staleTime: 10_000
  })
}
