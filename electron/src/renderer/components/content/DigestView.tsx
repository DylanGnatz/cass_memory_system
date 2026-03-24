import React from 'react'
import { useDigest } from '../../hooks/use-digests'
import MarkdownRenderer from './MarkdownRenderer'
import { formatDateLong } from '../../lib/formatters'

interface Props {
  date: string
}

export default function DigestView({ date }: Props): React.ReactElement {
  const { data: content, isLoading } = useDigest(date)

  if (isLoading) {
    return (
      <div>
        <div className="loading-skeleton" style={{ height: 20, width: '40%', marginBottom: 16 }} />
        <div className="loading-skeleton" style={{ height: 300 }} />
      </div>
    )
  }

  if (!content) {
    return (
      <div className="content-empty">
        <div className="content-empty__icon">&#x1f4c5;</div>
        <div className="content-empty__text">No digest found for {formatDateLong(date)}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="digest-header">
        Daily Digest — {formatDateLong(date)}
      </div>
      <MarkdownRenderer content={content} />
    </div>
  )
}
