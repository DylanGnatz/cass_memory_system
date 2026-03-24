import React, { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/ui-store'

export default function InvalidateDialog(): React.ReactElement | null {
  const { activeDialog, closeDialog } = useUIStore()
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!activeDialog || activeDialog.type !== 'invalidate') return null

  const { sectionTitle, slug } = activeDialog
  const today = new Date().toISOString().split('T')[0]

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) return
    setSubmitting(true)

    try {
      // Read current page, wrap the section content in [INVALIDATED] annotation
      const page = await window.electronAPI.getKnowledgePage(slug)
      if (!page) return

      const lines = page.raw.split('\n')
      const headingRe = /^#{2}\s+(.+)$/
      let inTargetSection = false
      let sectionStart = -1
      let sectionEnd = -1

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(headingRe)
        if (match) {
          if (inTargetSection) {
            sectionEnd = i
            break
          }
          if (match[1].trim() === sectionTitle) {
            inTargetSection = true
            sectionStart = i
          }
        }
      }
      if (inTargetSection && sectionEnd === -1) sectionEnd = lines.length

      if (sectionStart >= 0 && sectionEnd > sectionStart) {
        // Insert invalidation annotation after the heading + metadata
        let insertAt = sectionStart + 1
        // Skip metadata comment and blank lines
        while (insertAt < sectionEnd && (lines[insertAt].trim() === '' || lines[insertAt].trim().startsWith('<!--'))) {
          insertAt++
        }

        const annotation = `\n[INVALIDATED ${today}: ${reason.trim()}]\n`
        lines.splice(insertAt, 0, annotation)

        await window.electronAPI.saveFile(`knowledge/${slug}.md`, lines.join('\n'))
        queryClient.invalidateQueries({ queryKey: ['knowledge-page', slug] })
      }
    } finally {
      setSubmitting(false)
      setReason('')
      closeDialog()
    }
  }, [reason, slug, sectionTitle, queryClient, closeDialog, today])

  return (
    <div className="dialog-backdrop" onClick={closeDialog}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog__header">
          <span className="dialog__title">Invalidate Section</span>
          <button className="dialog__close" onClick={closeDialog}>&#x2715;</button>
        </div>
        <div className="dialog__body">
          <div className="dialog__section-label">
            {sectionTitle}
          </div>
          <label className="dialog__label">Why is this incorrect?</label>
          <textarea
            className="dialog__textarea"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe what's wrong and what the correct information is..."
            rows={3}
            autoFocus
          />
        </div>
        <div className="dialog__footer">
          <button className="btn" onClick={closeDialog}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={submitting || !reason.trim()}
            style={{ borderColor: 'var(--confidence-uncertain)', background: 'rgba(199, 95, 95, 0.15)', color: 'var(--confidence-uncertain)' }}
          >
            {submitting ? 'Invalidating...' : 'Invalidate'}
          </button>
        </div>
      </div>
    </div>
  )
}
