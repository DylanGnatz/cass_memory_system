import React from 'react'
import { useSessionNote } from '../../hooks/use-session-notes'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from './MarkdownRenderer'
import Editor from './Editor'
import StarButton from '../actions/StarButton'
import { formatDate } from '../../lib/formatters'

interface Props {
  id: string
}

export default function SessionNote({ id }: Props): React.ReactElement {
  const { data: note, isLoading } = useSessionNote(id)
  const { isEditing, setEditing, editContent, setEditContent } = useUIStore()

  if (isLoading) {
    return (
      <div>
        <div className="loading-skeleton" style={{ height: 100, marginBottom: 16, borderRadius: 8 }} />
        <div className="loading-skeleton" style={{ height: 300 }} />
      </div>
    )
  }

  if (!note) {
    return (
      <div className="content-empty">
        <div className="content-empty__icon">&#x1f4dd;</div>
        <div className="content-empty__text">Session note not found</div>
      </div>
    )
  }

  const fm = note.frontmatter

  if (isEditing) {
    // Reconstruct raw content for editing
    const rawContent = `---
id: ${fm.id}
created: ${fm.created}
last_updated: ${fm.last_updated}
abstract: "${fm.abstract}"
topics_touched: ${JSON.stringify(fm.topics_touched)}
processed: ${fm.processed}
user_edited: true
---
${note.body}`

    return (
      <Editor
        content={editContent || rawContent}
        filePath={`session-notes/${id}.md`}
        onSave={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      {/* Header card */}
      <div className="session-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="session-header__id">{fm.id}</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <StarButton path={`session-notes/${id}.md`} />
            <button className="btn btn--ghost btn--sm" onClick={() => {
              setEditContent('')
              setEditing(true)
            }}>
              Edit
            </button>
          </div>
        </div>
        {fm.abstract && (
          <div className="session-header__abstract">{fm.abstract}</div>
        )}
        <div className="session-header__badges">
          {fm.topics_touched.map((topic: string) => (
            <span key={topic} className="session-header__topic-tag">{topic}</span>
          ))}
          <span className={`session-header__status session-header__status--${fm.processed ? 'processed' : 'unprocessed'}`}>
            {fm.processed ? 'Processed' : 'Unprocessed'}
          </span>
          {fm.user_edited && (
            <span className="session-header__status" style={{ background: 'var(--confidence-inferred-bg)', color: 'var(--confidence-inferred)', border: '1px solid var(--confidence-inferred-border)' }}>
              Edited
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--text-tertiary)' }}>
          Created: {formatDate(fm.created)}
          {fm.last_updated && ` · Updated: ${formatDate(fm.last_updated)}`}
        </div>
      </div>

      {/* Body */}
      <MarkdownRenderer content={note.body} />
    </div>
  )
}
