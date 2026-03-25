import React, { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUserNote } from '../../hooks/use-user-notes'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from './MarkdownRenderer'
import Editor from './Editor'
import { formatDate } from '../../lib/formatters'

interface Props {
  id: string
}

export default function UserNote({ id }: Props): React.ReactElement {
  const { data: note, isLoading } = useUserNote(id)
  const { isEditing, setEditing, editContent, setEditContent, navigate } = useUIStore()
  const queryClient = useQueryClient()
  const [titleEdit, setTitleEdit] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleTitleSave = useCallback(async () => {
    if (!note || titleEdit === null) return
    await window.electronAPI.saveUserNote(id, titleEdit, note.body)
    queryClient.invalidateQueries({ queryKey: ['user-note', id] })
    queryClient.invalidateQueries({ queryKey: ['user-notes'] })
    setTitleEdit(null)
  }, [id, note, titleEdit, queryClient])

  const handleDelete = useCallback(async () => {
    await window.electronAPI.deleteUserNote(id)
    queryClient.invalidateQueries({ queryKey: ['user-notes'] })
    navigate({ type: 'none' })
  }, [id, queryClient, navigate])

  if (isLoading) {
    return (
      <div>
        <div className="loading-skeleton" style={{ height: 28, width: '50%', marginBottom: 16 }} />
        <div className="loading-skeleton" style={{ height: 200 }} />
      </div>
    )
  }

  if (!note) {
    return (
      <div className="content-empty">
        <div className="content-empty__icon">&#x1f4dd;</div>
        <div className="content-empty__text">Note not found</div>
      </div>
    )
  }

  if (isEditing) {
    return (
      <Editor
        content={editContent || note.body}
        filePath={`notes/${id}.md`}
        onSave={() => {
          setEditing(false)
          queryClient.invalidateQueries({ queryKey: ['user-note', id] })
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      <div className="user-note-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            {titleEdit !== null ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="user-note-header__title-input"
                  value={titleEdit}
                  onChange={(e) => setTitleEdit(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setTitleEdit(null) }}
                  autoFocus
                />
                <button className="btn btn--sm btn--primary" onClick={handleTitleSave}>Save</button>
                <button className="btn btn--sm btn--ghost" onClick={() => setTitleEdit(null)}>Cancel</button>
              </div>
            ) : (
              <h1
                className="user-note-header__title"
                onClick={() => setTitleEdit(note.frontmatter.title)}
                title="Click to edit title"
              >
                {note.frontmatter.title}
              </h1>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn--ghost btn--sm" onClick={() => {
              setEditContent(note.body)
              setEditing(true)
            }}>
              Edit
            </button>
            {!confirmDelete ? (
              <button
                className="btn btn--ghost btn--sm"
                style={{ color: 'var(--confidence-uncertain)' }}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            ) : (
              <button
                className="btn btn--sm"
                style={{ borderColor: 'var(--confidence-uncertain)', color: 'var(--confidence-uncertain)' }}
                onClick={handleDelete}
              >
                Confirm Delete
              </button>
            )}
          </div>
        </div>
        <div className="user-note-header__meta">
          <span>Created: {formatDate(note.frontmatter.created)}</span>
          {note.frontmatter.topics.length > 0 && (
            <span>Topics: {note.frontmatter.topics.join(', ')}</span>
          )}
        </div>
      </div>

      {note.body.trim() ? (
        <MarkdownRenderer content={note.body} />
      ) : (
        <div style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', padding: 'var(--sp-4) 0' }}>
          Empty note. Click "Edit" to add content.
        </div>
      )}
    </div>
  )
}
