import React, { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useStarred } from '../../hooks/use-starred'
import { useUIStore } from '../../stores/ui-store'
import { formatDate } from '../../lib/formatters'

export default function StarredTab(): React.ReactElement {
  const { data: items = [] } = useStarred()
  const { navigate } = useUIStore()
  const queryClient = useQueryClient()

  const handleUnstar = useCallback(async (path: string, section?: string) => {
    await window.electronAPI.unstarItem(path, section)
    queryClient.invalidateQueries({ queryKey: ['starred'] })
  }, [queryClient])

  const navigateToItem = useCallback((path: string) => {
    // Parse path to determine content type
    if (path.startsWith('knowledge/')) {
      const slug = path.replace('knowledge/', '').replace('.md', '')
      navigate({ type: 'knowledge', slug })
    } else if (path.startsWith('session-notes/')) {
      const id = path.replace('session-notes/', '').replace('.md', '')
      navigate({ type: 'session', id })
    } else if (path.startsWith('digests/')) {
      const date = path.replace('digests/', '').replace('.md', '')
      navigate({ type: 'digest', date })
    } else if (path.startsWith('notes/')) {
      const id = path.replace('notes/', '').replace('.md', '')
      navigate({ type: 'user-note', id })
    }
  }, [navigate])

  if (items.length === 0) {
    return (
      <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
        No starred items. Star knowledge sections or notes to pin them here.
      </div>
    )
  }

  return (
    <>
      {items.map((item: any, i: number) => (
        <div
          key={`${item.path}-${item.section || ''}-${i}`}
          className="sidebar-item"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => navigateToItem(item.path)}>
            <div className="sidebar-item__name">
              {item.section || item.path.split('/').pop()?.replace('.md', '')}
            </div>
            <div className="sidebar-item__meta">
              <span>{item.path}</span>
              <span>{formatDate(item.starred_at)}</span>
            </div>
          </div>
          <button
            className="action-toolbar__btn action-toolbar__btn--star action-toolbar__btn--starred"
            style={{ flexShrink: 0, opacity: 1 }}
            onClick={() => handleUnstar(item.path, item.section)}
            title="Unstar"
          >
            &#x2605;
          </button>
        </div>
      ))}
    </>
  )
}
