import React, { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface Props {
  content: string
  filePath: string
  onSave: () => void
  onCancel: () => void
}

export default function Editor({ content, filePath, onSave, onCancel }: Props): React.ReactElement {
  const [value, setValue] = useState(content)
  const [saving, setSaving] = useState(false)
  const queryClient = useQueryClient()

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await window.electronAPI.saveFile(filePath, value)
      // Invalidate relevant queries so content refreshes
      queryClient.invalidateQueries()
      onSave()
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [value, filePath, queryClient, onSave])

  const hasChanges = value !== content

  return (
    <div>
      <div className="editor-toolbar">
        <button className="btn btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
      />
    </div>
  )
}
