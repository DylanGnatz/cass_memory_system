import { useQuery, keepPreviousData } from '@tanstack/react-query'

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => window.electronAPI.search(query, { limit: 30 }),
    enabled: query.length >= 2,
    staleTime: 30_000,
    placeholderData: keepPreviousData
  })
}
