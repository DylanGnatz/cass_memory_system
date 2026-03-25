import React, { useState, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranscripts } from '../../hooks/use-transcripts'
import { useUIStore } from '../../stores/ui-store'
import { formatDate } from '../../lib/formatters'

export default function TranscriptsTab(): React.ReactElement {
  const { data: transcripts = [], isLoading } = useTranscripts()
  const { navigate } = useUIStore()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [generating, setGenerating] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    if (!filter) return transcripts
    const q = filter.toLowerCase()
    return transcripts.filter((t: any) =>
      t.project.toLowerCase().includes(q) || t.sessionId.toLowerCase().includes(q)
    )
  }, [transcripts, filter])

  // Group by project
  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {}
    for (const t of filtered) {
      if (!groups[t.project]) groups[t.project] = []
      groups[t.project].push(t)
    }
    return groups
  }, [filtered])

  const handleGenerate = useCallback(async (sessionId: string, filePath: string) => {
    setGenerating(prev => new Set(prev).add(sessionId))
    try {
      const result = await window.electronAPI.generateSessionNote(sessionId, filePath)
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['transcripts'] })
        queryClient.invalidateQueries({ queryKey: ['session-notes'] })
      }
    } catch (err) {
      console.error('Generate failed:', err)
    } finally {
      setGenerating(prev => {
        const next = new Set(prev)
        next.delete(sessionId)
        return next
      })
    }
  }, [queryClient])

  if (isLoading) {
    return (
      <div style={{ padding: '8px 12px' }}>
        {[1, 2, 3].map(i => (
          <div key={i} className="loading-skeleton" style={{ height: 36, marginBottom: 4, borderRadius: 6 }} />
        ))}
      </div>
    )
  }

  const totalCount = transcripts.length
  const withNotes = transcripts.filter((t: any) => t.hasSessionNote).length

  return (
    <>
      <div className="sidebar__filter">
        <input
          className="sidebar__filter-input"
          type="text"
          placeholder="Filter transcripts..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="transcript-summary">
        {totalCount} transcripts · {withNotes} with notes
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          {transcripts.length === 0 ? 'No transcripts found.' : 'No matching transcripts.'}
        </div>
      ) : (
        Object.entries(grouped).map(([project, items]) => (
          <React.Fragment key={project}>
            <div className="sidebar-group">{project}</div>
            {items.map((t: any) => {
              const isGenerating = generating.has(t.sessionId)
              return (
                <div
                  key={t.sessionId}
                  className={`sidebar-item transcript-item ${t.hasSessionNote ? 'transcript-item--has-note' : 'transcript-item--no-note'}`}
                  onClick={() => navigate({ type: 'transcript', sessionId: t.sessionId, filePath: t.filePath, hasSessionNote: t.hasSessionNote })}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span className={`transcript-dot ${t.hasSessionNote ? 'transcript-dot--active' : ''}`} />
                      <span className="sidebar-item__name" style={{ fontSize: 12 }}>{formatDate(t.date)}</span>
                    </div>
                    {!t.hasSessionNote && (
                      <button
                        className="btn btn--sm btn--ghost"
                        style={{ fontSize: 9, padding: '1px 6px', flexShrink: 0 }}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleGenerate(t.sessionId, t.filePath)
                        }}
                        disabled={isGenerating}
                      >
                        {isGenerating ? '...' : 'Generate'}
                      </button>
                    )}
                  </div>
                  <div className="sidebar-item__meta">
                    <span>{t.sizeKB}KB</span>
                    <span>{t.sessionId.slice(8, 16)}</span>
                  </div>
                </div>
              )
            })}
          </React.Fragment>
        ))
      )}
    </>
  )
}
