import { useQuery } from '@tanstack/react-query'

export function useStatus() {
  return useQuery({
    queryKey: ['status'],
    queryFn: () => window.electronAPI.getStatus(),
    staleTime: 30_000,
    refetchInterval: 30_000
  })
}
