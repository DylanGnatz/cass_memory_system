import React, { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/ui-store'

export default function FlagDialog(): React.ReactElement | null {
  const { activeDialog, closeDialog } = useUIStore()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!activeDialog || activeDialog.type !== 'flag') return null

  const { sectionTitle, slug } = activeDialog

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      await window.electronAPI.flagContent(
        `knowledge/${slug}.md`,
        sectionTitle,
        reason.trim() || undefined
      )
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    } finally {
      setSubmitting(false)
      setReason('')
      closeDialog()
    }
  }, [reason, slug, sectionTitle, queryClient, closeDialog])

  return (
    <div className="dialog-backdrop" onClick={closeDialog}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <span className="dialog__title">Flag for Review</span>
          <button className="dialog__close" onClick={closeDialog}>&#x2715;</button>
        </div>
        <div className="dialog__body">
          <div className="dialog__section-label">
            {sectionTitle} — {slug}
          </div>
          <label className="dialog__label">Reason (optional)</label>
          <textarea
            className="dialog__textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why should this be reviewed?"
            rows={2}
            autoFocus
          />
        </div>
        <div className="dialog__footer">
          <button className="btn" onClick={closeDialog}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Flagging...' : 'Flag'}
          </button>
        </div>
      </div>
    </div>
  )
}
