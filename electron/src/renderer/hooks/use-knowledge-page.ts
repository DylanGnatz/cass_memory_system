import { useQuery } from '@tanstack/react-query'

export function useKnowledgePage(slug: string | null) {
  return useQuery({
    queryKey: ['knowledge-page', slug],
    queryFn: () => window.electronAPI.getKnowledgePage(slug!),
    enabled: !!slug,
    staleTime: 10_000
  })
}
