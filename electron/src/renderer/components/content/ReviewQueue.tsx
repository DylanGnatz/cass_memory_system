import React, { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReviewQueue } from '../../hooks/use-review-queue'
import { useUIStore } from '../../stores/ui-store'
import { formatDate } from '../../lib/formatters'

const TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  cold_start_suggestion: { label: 'Suggestion', color: 'var(--badge-knowledge)' },
  bloated_page: { label: 'Bloated Page', color: 'var(--confidence-inferred)' },
  stale_topic: { label: 'Stale Topic', color: 'var(--confidence-uncertain)' },
  user_flag: { label: 'Flagged', color: 'var(--badge-digest)' }
}

export default function ReviewQueue(): React.ReactElement {
  const { data: items = [] } = useReviewQueue()
  const { navigate } = useUIStore()
  const queryClient = useQueryClient()
  const pending = items.filter((i: any) => i.status === 'pending')

  const handleApprove = useCallback(async (id: string) => {
    await window.electronAPI.approveReviewItem(id)
    queryClient.invalidateQueries({ queryKey: ['review-queue'] })
  }, [queryClient])

  const handleDismiss = useCallback(async (id: string) => {
    await window.electronAPI.dismissReviewItem(id)
    queryClient.invalidateQueries({ queryKey: ['review-queue'] })
  }, [queryClient])

  const navigateToTarget = useCallback((item: any) => {
    if (item.target_topic) {
      navigate({ type: 'knowledge', slug: item.target_topic })
    } else if (item.target_path?.startsWith('knowledge/')) {
      const slug = item.target_path.replace('knowledge/', '').replace('.md', '')
      navigate({ type: 'knowledge', slug })
    }
  }, [navigate])

  // Group by type
  const grouped: Record<string, any[]> = {}
  for (const item of pending) {
    const type = item.type as string
    if (!grouped[type]) grouped[type] = []
    grouped[type].push(item)
  }

  if (pending.length === 0) {
    return (
      <div className="content-empty">
        <div className="content-empty__icon">&#x2713;</div>
        <div className="content-empty__text">
          All clear. No items need review.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="kp-header">
        <h1 className="kp-header__topic">Review Queue</h1>
        <div className="kp-header__meta">
          <span>{pending.length} pending items</span>
        </div>
      </div>

      {Object.entries(grouped).map(([type, groupItems]) => {
        const config = TYPE_CONFIG[type] || { label: type, color: 'var(--text-tertiary)' }
        return (
          <div key={type} style={{ marginBottom: 'var(--sp-8)' }}>
            <div className="sidebar-group" style={{ paddingLeft: 0 }}>{config.label}s</div>
            {groupItems.map((item: any) => (
              <div key={item.id} className="rq-item">
                <div className="rq-item__header">
                  <span className="rq-item__badge" style={{ color: config.color, borderColor: config.color }}>
                    {config.label}
                  </span>
                  <span className="rq-item__date">{formatDate(item.created)}</span>
                </div>
                <div className="rq-item__target" onClick={() => navigateToTarget(item)}>
                  {item.target_topic || item.target_path || 'Unknown target'}
                  {item.target_section && <span className="rq-item__section"> &rsaquo; {item.target_section}</span>}
                </div>
                {item.reason && (
                  <div className="rq-item__reason">{item.reason}</div>
                )}
                {item.data && (
                  <div className="rq-item__data">
                    {item.data.word_count && <span>{item.data.word_count} words</span>}
                    {item.data.section_count && <span>{item.data.section_count} sections</span>}
                    {item.data.days_ignored && <span>Ignored {item.data.days_ignored} days</span>}
                  </div>
                )}
                {item.source?.snippet && (
                  <div className="rq-item__snippet">{item.source.snippet}</div>
                )}
                <div className="rq-item__actions">
                  <button className="btn btn--sm" onClick={() => handleApprove(item.id)}>Approve</button>
                  <button className="btn btn--sm btn--ghost" onClick={() => handleDismiss(item.id)}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
