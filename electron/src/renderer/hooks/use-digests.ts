import { useQuery } from '@tanstack/react-query'

export function useDigests(limit?: number) {
  return useQuery({
    queryKey: ['digests', limit],
    queryFn: () => window.electronAPI.getDigests(limit),
    staleTime: 10_000
  })
}

export function useDigest(date: string | null) {
  return useQuery({
    queryKey: ['digest', date],
    queryFn: () => window.electronAPI.getDigest(date!),
    enabled: !!date,
    staleTime: 10_000
  })
}
