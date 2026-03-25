import { useQuery } from '@tanstack/react-query'

export function useKnowledgePage(slug: string | null, subPage?: string) {
  return useQuery({
    queryKey: ['knowledge-page', slug, subPage],
    queryFn: () => window.electronAPI.getKnowledgePage(slug!, subPage),
    enabled: !!slug,
    staleTime: 10_000
  })
}

export function useSubPages(topicSlug: string | null) {
  return useQuery({
    queryKey: ['sub-pages', topicSlug],
    queryFn: () => window.electronAPI.getSubPages(topicSlug!),
    enabled: !!topicSlug,
    staleTime: 10_000
  })
}
