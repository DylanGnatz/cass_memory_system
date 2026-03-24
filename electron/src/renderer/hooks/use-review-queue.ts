import { useQuery } from '@tanstack/react-query'

export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    queryFn: () => window.electronAPI.getReviewQueue(),
    staleTime: 10_000
  })
}
