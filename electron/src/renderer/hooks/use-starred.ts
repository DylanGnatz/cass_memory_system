import { useQuery } from '@tanstack/react-query'

export function useStarred() {
  return useQuery({
    queryKey: ['starred'],
    queryFn: () => window.electronAPI.getStarred(),
    staleTime: 10_000
  })
}
