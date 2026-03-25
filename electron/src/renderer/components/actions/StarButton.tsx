import React, { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useStarred } from '../../hooks/use-starred'

interface Props {
  path: string
  section?: string
}

export default function StarButton({ path, section }: Props): React.ReactElement {
  const { data: starredItems = [] } = useStarred()
  const queryClient = useQueryClient()

  const isStarred = starredItems.some((s: any) =>
    s.path === path && (section ? s.section === section : !s.section)
  )

  const handleToggle = useCallback(async () => {
    if (isStarred) {
      await window.electronAPI.unstarItem(path, section)
    } else {
      await window.electronAPI.starItem(path, section)
    }
    queryClient.invalidateQueries({ queryKey: ['starred'] })
  }, [path, section, isStarred, queryClient])

  return (
    <button
      className={`star-btn ${isStarred ? 'star-btn--active' : ''}`}
      onClick={handleToggle}
      title={isStarred ? 'Unstar' : 'Star'}
    >
      {isStarred ? '\u2605' : '\u2606'}
    </button>
  )
}
