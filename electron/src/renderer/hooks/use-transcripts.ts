import { useQuery } from '@tanstack/react-query'

export function useTranscripts() {
  return useQuery({
    queryKey: ['transcripts'],
    queryFn: () => window.electronAPI.getTranscripts(),
    staleTime: 60_000 // transcripts don't change often
  })
}
