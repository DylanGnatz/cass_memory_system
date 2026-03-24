import React, { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '../../stores/ui-store'

interface Props {
  slug: string
  sectionIndex: number
  sectionTitle: string
  sectionId: string
  confidence: string
  isStarred?: boolean
  /** The full raw page content — needed for verify to rewrite metadata */
  rawPage: string
}

export default function ActionToolbar({
  slug, sectionIndex, sectionTitle, sectionId, confidence, isStarred, rawPage
}: Props): React.ReactElement {
  const { openDialog } = useUIStore()
  const queryClient = useQueryClient()

  const handleVerify = useCallback(async () => {
    // Replace the confidence value in the section's metadata comment
    const updated = rawPage.replace(
      new RegExp(`(<!--[^>]*id:\\s*${sectionId}[^>]*confidence:\\s*)\\w+`),
      '$1verified'
    )
    if (updated !== rawPage) {
      await window.electronAPI.saveFile(`knowledge/${slug}.md`, updated)
      queryClient.invalidateQueries({ queryKey: ['knowledge-page', slug] })
    }
  }, [slug, sectionId, rawPage, queryClient])

  const handleStar = useCallback(async () => {
    const path = `knowledge/${slug}.md`
    if (isStarred) {
      await window.electronAPI.unstarItem(path, sectionTitle)
    } else {
      await window.electronAPI.starItem(path, sectionTitle)
    }
    queryClient.invalidateQueries({ queryKey: ['starred'] })
  }, [slug, sectionTitle, isStarred, queryClient])

  return (
    <div className="action-toolbar">
      {confidence !== 'verified' && (
        <button
          className="action-toolbar__btn action-toolbar__btn--verify"
          onClick={handleVerify}
          title="Mark as verified"
        >
          &#x2713;
        </button>
      )}
      <button
        className="action-toolbar__btn action-toolbar__btn--invalidate"
        onClick={() => openDialog({ type: 'invalidate', sectionTitle, sectionIndex, slug })}
        title="Invalidate"
      >
        &#x2717;
      </button>
      <button
        className="action-toolbar__btn action-toolbar__btn--flag"
        onClick={() => openDialog({ type: 'flag', sectionTitle, sectionIndex, slug })}
        title="Flag for review"
      >
        &#x2691;
      </button>
      <button
        className={`action-toolbar__btn action-toolbar__btn--star ${isStarred ? 'action-toolbar__btn--starred' : ''}`}
        onClick={handleStar}
        title={isStarred ? 'Unstar' : 'Star'}
      >
        {isStarred ? '\u2605' : '\u2606'}
      </button>
    </div>
  )
}
