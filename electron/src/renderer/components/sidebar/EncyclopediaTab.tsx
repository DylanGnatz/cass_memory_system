import React, { useState, useMemo } from 'react'
import { useTopics } from '../../hooks/use-topics'
import { useUIStore } from '../../stores/ui-store'
import { plural } from '../../lib/formatters'

export default function EncyclopediaTab(): React.ReactElement {
  const { data: topics = [], isLoading } = useTopics()
  const { currentView, navigate } = useUIStore()
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!filter) return topics
    const q = filter.toLowerCase()
    return topics.filter((t: any) =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }, [topics, filter])

  const activeSlug = currentView.type === 'knowledge' ? currentView.slug : null

  if (isLoading) {
    return (
      <div style={{ padding: '8px 12px' }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="loading-skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 6 }} />
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="sidebar__filter">
        <input
          className="sidebar__filter-input"
          type="text"
          placeholder="Filter topics..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          {topics.length === 0 ? 'No topics yet. Run reflection to generate knowledge.' : 'No matching topics.'}
        </div>
      ) : (
        filtered.map((topic: any) => (
          <div
            key={topic.slug}
            className={`sidebar-item ${activeSlug === topic.slug ? 'sidebar-item--active' : ''}`}
            onClick={() => navigate({ type: 'knowledge', slug: topic.slug })}
          >
            <div className="sidebar-item__name">{topic.name}</div>
            <div className="sidebar-item__meta">
              <span>{plural(topic.sectionCount, 'section')}</span>
              {topic.wordCount > 0 && <span>{plural(topic.wordCount, 'word')}</span>}
            </div>
          </div>
        ))
      )}
    </>
  )
}
