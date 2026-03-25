import React, { useCallback, useRef, useEffect } from 'react'
import { useUIStore, type SidebarTab } from '../../stores/ui-store'
import EncyclopediaTab from '../sidebar/EncyclopediaTab'
import RecentTab from '../sidebar/RecentTab'
import StarredTab from '../sidebar/StarredTab'
import MyNotesTab from '../sidebar/MyNotesTab'
import ReviewQueueTab, { useReviewCount } from '../sidebar/ReviewQueueTab'

const TABS: { id: SidebarTab; icon: string; label: string }[] = [
  { id: 'encyclopedia', icon: '\u25A6', label: 'Topics' },
  { id: 'recent',       icon: '\u25F7', label: 'Recent' },
  { id: 'starred',      icon: '\u2606', label: 'Starred' },
  { id: 'notes',        icon: '\u270E', label: 'Notes' },
  { id: 'review',       icon: '\u2691', label: 'Review' },
]

export default function Sidebar(): React.ReactElement {
  const { activeTab, setActiveTab, sidebarWidth, setSidebarWidth } = useUIStore()
  const reviewCount = useReviewCount()
  const isDragging = useRef(false)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      // Direct DOM update — no React re-render during drag
      const clamped = Math.max(180, Math.min(500, e.clientX))
      const shell = document.querySelector('.app-shell') as HTMLElement
      if (shell) {
        shell.style.gridTemplateColumns = `${clamped}px 4px 1fr`
      }
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (!isDragging.current) return
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      // Commit final width to Zustand (single re-render)
      const clamped = Math.max(180, Math.min(500, e.clientX))
      setSidebarWidth(clamped)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [setSidebarWidth])

  return (
    <>
      <div className="sidebar">
        <div className="sidebar__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar__tab ${activeTab === tab.id ? 'sidebar__tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              title={tab.label}
            >
              <span className="sidebar__tab-icon">{tab.icon}</span>
              {tab.id === 'review' && reviewCount > 0 && (
                <span className="sidebar__tab-badge">{reviewCount}</span>
              )}
            </button>
          ))}
        </div>
        <div className="sidebar__content">
          {activeTab === 'encyclopedia' && <EncyclopediaTab />}
          {activeTab === 'recent' && <RecentTab />}
          {activeTab === 'starred' && <StarredTab />}
          {activeTab === 'notes' && <MyNotesTab />}
          {activeTab === 'review' && <ReviewQueueTab />}
        </div>
      </div>
      <div className="sidebar-resize" onMouseDown={handleMouseDown} />
    </>
  )
}
