import React from 'react'
import { useKnowledgePage } from '../../hooks/use-knowledge-page'
import { useStarred } from '../../hooks/use-starred'
import { useUIStore } from '../../stores/ui-store'
import MarkdownRenderer from './MarkdownRenderer'
import Editor from './Editor'
import ActionToolbar from '../actions/ActionToolbar'
import { formatDate } from '../../lib/formatters'

interface Props {
  slug: string
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

export default function KnowledgePage({ slug }: Props): React.ReactElement {
  const { data: page, isLoading } = useKnowledgePage(slug)
  const { data: starredItems = [] } = useStarred()
  const { isEditing, setEditing, editContent, setEditContent } = useUIStore()

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
        filePath={`knowledge/${slug}.md`}
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
          <button className="btn btn--ghost btn--sm" onClick={() => {
            setEditContent(page.raw)
            setEditing(true)
          }}>
            Edit
          </button>
        </div>
        <div className="kp-header__meta">
          <span>Source: {page.frontmatter.source}</span>
          <span>Created: {formatDate(page.frontmatter.created)}</span>
          <span>Updated: {formatDate(page.frontmatter.last_updated)}</span>
        </div>
      </div>

      {/* Sections with action toolbar */}
      {page.sections.map((section: any, i: number) => {
        const tier = confidenceClass(section.confidence)
        const sectionPath = `knowledge/${slug}.md`
        const starred = starredItems.some((s: any) => s.path === sectionPath && s.section === section.title)

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
            This knowledge page has no sections yet. Content will appear after reflection processes session notes related to this topic.
          </div>
        </div>
      )}
    </div>
  )
}
