import React, { useState, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from './MarkdownRenderer'

interface Props {
  sessionId: string
  filePath: string
  hasSessionNote: boolean
}

export default function TranscriptView({ sessionId, filePath, hasSessionNote }: Props): React.ReactElement {
  const { navigate } = useUIStore()
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [genMessage, setGenMessage] = useState<string | null>(null)

  const [chunks, setChunks] = useState<string[]>([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [totalSize, setTotalSize] = useState(0)

  const loadChunk = useCallback(async (fromOffset: number) => {
    setLoading(true)
    try {
      const result = await window.electronAPI.getTranscriptChunk(filePath, fromOffset)
      if (result.content) {
        setChunks(prev => [...prev, result.content])
      }
      setOffset(fromOffset + result.bytesRead)
      setHasMore(result.hasMore)
      setTotalSize(result.totalSize)
    } catch (err) {
      console.error('Failed to load transcript chunk:', err)
    } finally {
      setLoading(false)
    }
  }, [filePath])

  // Load first chunk on mount or when filePath changes
  useEffect(() => {
    setChunks([])
    setOffset(0)
    setHasMore(true)
    loadChunk(0)
  }, [filePath, loadChunk])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenMessage(null)
    try {
      const result = await window.electronAPI.generateSessionNote(sessionId, filePath)
      setGenMessage(result.message)
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['transcripts'] })
        queryClient.invalidateQueries({ queryKey: ['session-notes'] })
      }
    } catch (err: any) {
      setGenMessage(err?.message || 'Failed')
    } finally {
      setGenerating(false)
    }
  }, [sessionId, filePath, queryClient])

  const totalKB = Math.round(totalSize / 1024)
  const loadedKB = Math.round(offset / 1024)

  return (
    <div>
      {/* Action bar */}
      <div className="transcript-actions">
        {hasSessionNote && (
          <button className="btn btn--sm" onClick={() => navigate({ type: 'session', id: sessionId })}>
            View Session Note &rsaquo;
          </button>
        )}
        {!hasSessionNote && (
          <button
            className="btn btn--sm btn--primary"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Generating...' : 'Generate Session Note'}
          </button>
        )}
        {genMessage && (
          <span className="transcript-actions__message">{genMessage}</span>
        )}
      </div>

      {/* Header */}
      <div className="transcript-header">
        <span>Raw Transcript — {sessionId}</span>
      </div>
      <div className="transcript-header__meta">
        <span>{filePath.split('/').slice(-2).join('/')}</span>
        <span> · {totalKB}KB total</span>
        {totalKB > 0 && <span> · Loaded {loadedKB}KB ({Math.round(offset / totalSize * 100)}%)</span>}
      </div>

      {/* Content chunks */}
      {chunks.length === 0 && loading && (
        <div>
          <div className="loading-skeleton" style={{ height: 20, width: '40%', marginBottom: 16 }} />
          <div className="loading-skeleton" style={{ height: 400 }} />
        </div>
      )}

      {chunks.map((chunk, i) => (
        <MarkdownRenderer key={i} content={chunk} />
      ))}

      {chunks.length > 0 && chunks.every(c => !c.trim()) && (
        <div className="content-empty">
          <div className="content-empty__text">No readable content found in this transcript.</div>
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="transcript-load-more">
          <button
            className="btn"
            onClick={() => loadChunk(offset)}
            disabled={loading}
          >
            {loading ? 'Loading...' : `Load More (${totalKB - loadedKB}KB remaining)`}
          </button>
        </div>
      )}

      {!hasMore && chunks.length > 0 && (
        <div className="transcript-load-more">
          <span className="transcript-actions__message">End of transcript</span>
        </div>
      )}
    </div>
  )
}
