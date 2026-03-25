import React from 'react'
import { useDigests } from '../../hooks/use-digests'
import { useSessionNotes } from '../../hooks/use-session-notes'
import { useUIStore } from '../../stores/ui-store'
import { formatDate, dateGroup } from '../../lib/formatters'

export default function RecentTab(): React.ReactElement {
  const { data: digests = [] } = useDigests(20)
  const { data: sessions = [] } = useSessionNotes(20)
  const { currentView, navigate } = useUIStore()

  // Group sessions by date category
  const sessionsByGroup: Record<string, any[]> = {}
  for (const s of sessions) {
    const group = dateGroup(s.last_updated || s.created)
    if (!sessionsByGroup[group]) sessionsByGroup[group] = []
    sessionsByGroup[group].push(s)
  }

  return (
    <>
      {/* Digests section */}
      {digests.length > 0 && (
        <>
          <div className="sidebar-group">Digests</div>
          {digests.map((d: any) => (
            <div
              key={d.date}
              className={`sidebar-item ${currentView.type === 'digest' && currentView.date === d.date ? 'sidebar-item--active' : ''}`}
              onClick={() => navigate({ type: 'digest', date: d.date })}
            >
              <div className="sidebar-item__name">{formatDate(d.date)}</div>
              <div className="sidebar-item__meta">
                <span>Daily digest</span>
              </div>
            </div>
          ))}
        </>
      )}

      {/* Session notes section */}
      {Object.entries(sessionsByGroup).map(([group, notes]) => (
        <React.Fragment key={group}>
          <div className="sidebar-group">{group}</div>
          {notes.map((s: any) => (
            <div
              key={s.id}
              className={`sidebar-item ${currentView.type === 'session' && currentView.id === s.id ? 'sidebar-item--active' : ''}`}
              onClick={() => navigate({ type: 'session', id: s.id })}
            >
              <div className="sidebar-item__name">
                {s.title || s.abstract?.slice(0, 50) || s.id}
              </div>
              <div className="sidebar-item__meta">
                <span>{formatDate(s.last_updated || s.created)}</span>
                {!s.processed && (
                  <span className="sidebar-item__badge">unprocessed</span>
                )}
              </div>
            </div>
          ))}
        </React.Fragment>
      ))}

      {digests.length === 0 && sessions.length === 0 && (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          No recent activity yet.
        </div>
      )}
    </>
  )
}
