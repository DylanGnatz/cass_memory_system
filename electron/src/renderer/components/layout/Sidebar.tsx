import React from 'react'
import { useUIStore, type SidebarTab } from '../../stores/ui-store'
import EncyclopediaTab from '../sidebar/EncyclopediaTab'
import RecentTab from '../sidebar/RecentTab'
import StarredTab from '../sidebar/StarredTab'
import MyNotesTab from '../sidebar/MyNotesTab'
import ReviewQueueTab, { useReviewCount } from '../sidebar/ReviewQueueTab'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'encyclopedia', label: 'Topics' },
  { id: 'recent', label: 'Recent' },
  { id: 'starred', label: 'Starred' },
  { id: 'notes', label: 'Notes' },
  { id: 'review', label: 'Review' }
]

export default function Sidebar(): React.ReactElement {
  const { activeTab, setActiveTab } = useUIStore()
  const reviewCount = useReviewCount()

  return (
    <div className="sidebar">
      <div className="sidebar__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`sidebar__tab ${activeTab === tab.id ? 'sidebar__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
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
  )
}
