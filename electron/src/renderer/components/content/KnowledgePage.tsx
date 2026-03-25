import React, { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useKnowledgePage, useSubPages } from '../../hooks/use-knowledge-page'
import { useStarred } from '../../hooks/use-starred'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from './MarkdownRenderer'
import Editor from './Editor'
import ActionToolbar from '../actions/ActionToolbar'
import StarButton from '../actions/StarButton'
import { formatDate } from '../../lib/formatters'

interface Props {
  slug: string
  subPage?: string
}

function confidenceClass(confidence: string): string {
  switch (confidence) {
    case 'verified': return 'verified'
    case 'inferred': return 'inferred'
    default: return 'uncertain'
  }
}

function confidenceLabel(confidence: string): string {
  switch (confidence) {
    case 'verified': return 'Verified'
    case 'inferred': return 'Inferred'
    default: return 'Uncertain'
  }
}

export default function KnowledgePage({ slug, subPage }: Props): React.ReactElement {
  const { data: page, isLoading } = useKnowledgePage(slug, subPage)
  const { data: subPages = [] } = useSubPages(slug)
  const { data: starredItems = [] } = useStarred()
  const { isEditing, setEditing, editContent, setEditContent, navigate } = useUIStore()
  const queryClient = useQueryClient()

  const [showAddPage, setShowAddPage] = useState(false)
  const [newPageName, setNewPageName] = useState('')
  const [newPageDesc, setNewPageDesc] = useState('')
  const [newPageSlug, setNewPageSlug] = useState('')
  const [addingPage, setAddingPage] = useState(false)

  const activeSubPage = subPage || '_index'
  const filePath = subPages.length > 0
    ? `knowledge/${slug}/${activeSubPage}.md`
    : `knowledge/${slug}.md`

  const handleAddPage = useCallback(async () => {
    const spSlug = newPageSlug.trim() || newPageName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!spSlug || !newPageName.trim()) return

    setAddingPage(true)
    try {
      await window.electronAPI.addSubPage(slug, spSlug, newPageName.trim(), newPageDesc.trim())
      queryClient.invalidateQueries({ queryKey: ['sub-pages', slug] })
      queryClient.invalidateQueries({ queryKey: ['topics'] })
      setShowAddPage(false)
      setNewPageName('')
      setNewPageDesc('')
      setNewPageSlug('')
      navigate({ type: 'knowledge', slug, subPage: spSlug })
    } catch (err: any) {
      console.error('Failed to add sub-page:', err)
    } finally {
      setAddingPage(false)
    }
  }, [slug, newPageSlug, newPageName, newPageDesc, queryClient, navigate])

  if (isLoading) {
    return (
      <div>
        <div className="loading-skeleton" style={{ height: 28, width: '60%', marginBottom: 12 }} />
        <div className="loading-skeleton" style={{ height: 16, width: '80%', marginBottom: 8 }} />
        <div className="loading-skeleton" style={{ height: 200, marginTop: 24 }} />
      </div>
    )
  }

  if (!page) {
    return (
      <div className="content-empty">
        <div className="content-empty__icon">&#x1f4c4;</div>
        <div className="content-empty__text">Knowledge page not found for "{slug}"</div>
      </div>
    )
  }

  if (isEditing) {
    return (
      <Editor
        content={editContent || page.raw}
        filePath={filePath}
        onSave={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="kp-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 className="kp-header__topic">{page.frontmatter.topic}</h1>
            {page.frontmatter.description && (
              <p className="kp-header__description">{page.frontmatter.description}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <StarButton path={`knowledge/${slug}`} />
            <button className="btn btn--ghost btn--sm" onClick={() => {
              setEditContent(page.raw)
              setEditing(true)
            }}>
              Edit
            </button>
          </div>
        </div>
        <div className="kp-header__meta">
          <span>Source: {page.frontmatter.source}</span>
          <span>Created: {formatDate(page.frontmatter.created)}</span>
          <span>Updated: {formatDate(page.frontmatter.last_updated)}</span>
        </div>
      </div>

      {/* Sub-page navigation */}
      <div className="kp-subpages">
        {subPages.map((sp: string) => (
          <button
            key={sp}
            className={`kp-subpage-pill ${sp === activeSubPage ? 'kp-subpage-pill--active' : ''}`}
            onClick={() => navigate({ type: 'knowledge', slug, subPage: sp === '_index' ? undefined : sp })}
          >
            {sp === '_index' ? 'Overview' : sp.replace(/-/g, ' ')}
          </button>
        ))}

        {!showAddPage ? (
          <button
            className="kp-subpage-pill kp-subpage-pill--add"
            onClick={() => setShowAddPage(true)}
          >
            +
          </button>
        ) : (
          <div className="kp-add-page-form">
            <input
              className="kp-add-page-form__input"
              type="text"
              placeholder="Page name"
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPage(); if (e.key === 'Escape') setShowAddPage(false) }}
              autoFocus
            />
            <input
              className="kp-add-page-form__input"
              type="text"
              placeholder="What goes on this page?"
              value={newPageDesc}
              onChange={(e) => setNewPageDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddPage(); if (e.key === 'Escape') setShowAddPage(false) }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn--primary btn--sm" onClick={handleAddPage} disabled={addingPage || !newPageName.trim()}>
                Add
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setShowAddPage(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Sections with action toolbar */}
      {page.sections.map((section: any, i: number) => {
        const tier = confidenceClass(section.confidence)
        const starred = starredItems.some((s: any) => s.path === filePath && s.section === section.title)

        return (
          <div key={section.id || i} className={`kp-section kp-section--${tier}`}>
            <div className="kp-section__heading-row">
              <h2 className="kp-section__heading">
                {section.title}
                <span className={`kp-section__confidence kp-section__confidence--${tier}`}>
                  {confidenceLabel(section.confidence)}
                </span>
              </h2>
              <ActionToolbar
                slug={slug}
                sectionIndex={i}
                sectionTitle={section.title}
                sectionId={section.id}
                confidence={section.confidence}
                isStarred={starred}
                rawPage={page.raw}
              />
            </div>
            <div className="kp-section__meta">
              {section.source && <span>Source: {section.source}</span>}
              {section.added && <span>Added: {section.added}</span>}
              {section.id && <span>ID: {section.id}</span>}
            </div>
            <div className="kp-section__content">
              <MarkdownRenderer content={section.content} />
            </div>
          </div>
        )
      })}

      {page.sections.length === 0 && (
        <div className="content-empty">
          <div className="content-empty__text">
            This page has no sections yet. Content will be added automatically when new sessions match this topic, or you can edit the page directly.
          </div>
        </div>
      )}
    </div>
  )
}
