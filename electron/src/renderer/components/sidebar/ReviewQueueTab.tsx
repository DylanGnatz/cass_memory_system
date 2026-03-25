import React from 'react'
import { useReviewQueue } from '../../hooks/use-review-queue'
import { useUIStore } from '../../stores/ui-store'

const TYPE_LABELS: Record<string, string> = {
  cold_start_suggestion: 'Suggestion',
  bloated_page: 'Bloated',
  stale_topic: 'Stale',
  user_flag: 'Flagged'
}

export default function ReviewQueueTab(): React.ReactElement {
  const { data: items = [] } = useReviewQueue()
  const { currentView, navigate } = useUIStore()
  const pending = items.filter((i: any) => i.status === 'pending')

  return (
    <>
      {pending.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          No items need review.
        </div>
      ) : (
        <>
          <div className="sidebar-group">{pending.length} pending</div>
          {pending.map((item: any) => (
            <div
              key={item.id}
              className={`sidebar-item ${currentView.type === 'review-queue' ? 'sidebar-item--active' : ''}`}
              onClick={() => navigate({ type: 'review-queue' })}
            >
              <div className="sidebar-item__name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`rq-type-badge rq-type-badge--${item.type}`}>
                  {TYPE_LABELS[item.type] || item.type}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.target_topic || item.target_path || 'Unknown'}
                </span>
              </div>
              <div className="sidebar-item__meta">
                {item.reason && <span>{item.reason}</span>}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/** Returns the count of pending review items — used by Sidebar for badge. */
export function useReviewCount(): number {
  const { data: items = [] } = useReviewQueue()
  return items.filter((i: any) => i.status === 'pending').length
}
