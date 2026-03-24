import React, { useState, useCallback } from 'react'
import { useStatus } from '../../hooks/use-status'
import { useUIStore } from '../../stores/ui-store'
import { relativeTime, plural } from '../../lib/formatters'

export default function StatusBar(): React.ReactElement {
  const { data: status } = useStatus()
  const { isReflecting, setReflecting } = useUIStore()
  const [reflectMessage, setReflectMessage] = useState<string | null>(null)

  const handleReflect = useCallback(async () => {
    setReflecting(true)
    setReflectMessage(null)
    try {
      const result = await window.electronAPI.runReflection()
      setReflectMessage(result?.message || 'Reflection complete')
    } catch (err: any) {
      setReflectMessage(err?.message || 'Reflection failed')
    } finally {
      setReflecting(false)
      // Clear message after 8 seconds
      setTimeout(() => setReflectMessage(null), 8000)
    }
  }, [setReflecting])

  const lastRun = status?.lastReflectionRun
  const isStale = !lastRun || (Date.now() - new Date(lastRun).getTime()) > 86_400_000

  return (
    <div className="statusbar">
      {isReflecting && <div className="statusbar__progress" />}

      <div className="statusbar__left">
        <div className="statusbar__item">
          <span className={`statusbar__dot ${isStale ? 'statusbar__dot--stale' : ''}`} />
          <span>Last reflection: {relativeTime(lastRun)}</span>
        </div>
        {status && (
          <>
            <div className="statusbar__item">
              {plural(status.topicCount, 'topic')}
            </div>
            {status.unprocessedSessionNotes > 0 && (
              <div className="statusbar__item" style={{ color: 'var(--confidence-inferred)' }}>
                {plural(status.unprocessedSessionNotes, 'unprocessed note')}
              </div>
            )}
          </>
        )}
        {reflectMessage && (
          <div className="statusbar__item" style={{ color: 'var(--accent)' }}>
            {reflectMessage}
          </div>
        )}
      </div>
      <div className="statusbar__right">
        <button
          className={`statusbar__btn ${isReflecting ? 'statusbar__btn--running' : ''}`}
          onClick={handleReflect}
          disabled={isReflecting}
        >
          {isReflecting ? 'Reflecting...' : 'Run Reflection'}
        </button>
      </div>
    </div>
  )
}
