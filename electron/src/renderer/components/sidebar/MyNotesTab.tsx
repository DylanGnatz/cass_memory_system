import React, { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUserNotes } from '../../hooks/use-user-notes'
import { useUIStore } from '../../stores/ui-store'
import { formatDate } from '../../lib/formatters'

export default function MyNotesTab(): React.ReactElement {
  const { data: notes = [] } = useUserNotes()
  const { currentView, navigate } = useUIStore()
  const queryClient = useQueryClient()

  const handleNew = useCallback(async () => {
    const id = await window.electronAPI.createUserNote('Untitled Note', '')
    queryClient.invalidateQueries({ queryKey: ['user-notes'] })
    navigate({ type: 'user-note', id })
  }, [queryClient, navigate])

  return (
    <>
      <div style={{ padding: '4px 8px' }}>
        <button className="btn btn--ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={handleNew}>
          + New Note
        </button>
      </div>
      {notes.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          No notes yet. Create one to get started.
        </div>
      ) : (
        notes.map((note: any) => (
          <div
            key={note.id}
            className={`sidebar-item ${currentView.type === 'user-note' && currentView.id === note.id ? 'sidebar-item--active' : ''}`}
            onClick={() => navigate({ type: 'user-note', id: note.id })}
          >
            <div className="sidebar-item__name">{note.title || 'Untitled'}</div>
            <div className="sidebar-item__meta">
              <span>{formatDate(note.created)}</span>
              {note.topics.length > 0 && <span>{note.topics.join(', ')}</span>}
            </div>
          </div>
        ))
      )}
    </>
  )
}
