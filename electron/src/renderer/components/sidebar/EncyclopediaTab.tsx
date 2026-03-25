import React, { useState, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTopics } from '../../hooks/use-topics'
import { useUIStore } from '../../stores/ui-store'
import { plural } from '../../lib/formatters'

export default function EncyclopediaTab(): React.ReactElement {
  const { data: topics = [], isLoading } = useTopics()
  const { currentView, navigate } = useUIStore()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [adding, setAdding] = useState(false)

  const filtered = useMemo(() => {
    if (!filter) return topics
    const q = filter.toLowerCase()
    return topics.filter((t: any) =>
      t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }, [topics, filter])

  const activeSlug = currentView.type === 'knowledge' ? currentView.slug : null

  const handleAdd = useCallback(async () => {
    const slug = newSlug.trim() || newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!slug || !newName.trim()) return

    setAdding(true)
    try {
      await window.electronAPI.addTopic(slug, newName.trim(), newDescription.trim())
      queryClient.invalidateQueries({ queryKey: ['topics'] })
      setShowAddForm(false)
      setNewSlug('')
      setNewName('')
      setNewDescription('')
      navigate({ type: 'knowledge', slug })
    } catch (err: any) {
      console.error('Failed to add topic:', err)
    } finally {
      setAdding(false)
    }
  }, [newSlug, newName, newDescription, queryClient, navigate])

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

      {/* Add Topic button / form */}
      {!showAddForm ? (
        <div style={{ padding: '0 8px 4px' }}>
          <button
            className="btn btn--ghost"
            style={{ width: '100%', justifyContent: 'center', fontSize: 11 }}
            onClick={() => setShowAddForm(true)}
          >
            + Add Topic
          </button>
        </div>
      ) : (
        <div className="add-topic-form">
          <input
            className="add-topic-form__input"
            type="text"
            placeholder="Topic name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false) }}
            autoFocus
          />
          <input
            className="add-topic-form__input"
            type="text"
            placeholder="Description (what goes here)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false) }}
          />
          <input
            className="add-topic-form__input"
            type="text"
            placeholder="Slug (auto-generated if empty)"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAddForm(false) }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn--primary btn--sm" onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? 'Adding...' : 'Add'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
          {topics.length === 0 ? 'No topics yet. Add one to start organizing knowledge.' : 'No matching topics.'}
        </div>
      ) : (
        filtered.map((topic: any) => (
          <div
            key={topic.slug}
            className={`sidebar-item sidebar-item--with-delete ${activeSlug === topic.slug ? 'sidebar-item--active' : ''}`}
            onClick={() => navigate({ type: 'knowledge', slug: topic.slug })}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="sidebar-item__name">{topic.name}</div>
              <button
                className="sidebar-item__delete"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`Delete topic "${topic.name}" and all its knowledge pages?`)) {
                    window.electronAPI.deleteTopic(topic.slug).then(() => {
                      queryClient.invalidateQueries({ queryKey: ['topics'] })
                      if (activeSlug === topic.slug) navigate({ type: 'none' })
                    })
                  }
                }}
                title="Delete topic"
              >
                &#x2715;
              </button>
            </div>
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
