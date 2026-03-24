import { useQuery } from '@tanstack/react-query'

export function useTopics() {
  return useQuery({
    queryKey: ['topics'],
    queryFn: () => window.electronAPI.getTopics(),
    staleTime: 10_000
  })
}
