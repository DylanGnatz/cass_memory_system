import React from 'react'
import './styles/global.css'
import { useUIStore } from './stores/ui-store'
import { useFileWatcher } from './hooks/use-file-watcher'
import SearchBar from './components/layout/SearchBar'
import Sidebar from './components/layout/Sidebar'
import StatusBar from './components/layout/StatusBar'
import KnowledgePage from './components/content/KnowledgePage'
import SessionNote from './components/content/SessionNote'
import DigestView from './components/content/DigestView'
import UserNote from './components/content/UserNote'
import ReviewQueue from './components/content/ReviewQueue'
import Settings from './components/content/Settings'
import TranscriptView from './components/content/TranscriptView'
import InvalidateDialog from './components/actions/InvalidateDialog'
import FlagDialog from './components/actions/FlagDialog'
import ClaudeDialog from './components/claude/ClaudeDialog'

function ContentArea(): React.ReactElement {
  const { currentView } = useUIStore()

  switch (currentView.type) {
    case 'knowledge':
      return <KnowledgePage slug={currentView.slug} subPage={currentView.subPage} />
    case 'session':
      return <SessionNote id={currentView.id} />
    case 'digest':
      return <DigestView date={currentView.date} />
    case 'user-note':
      return <UserNote id={currentView.id} />
    case 'review-queue':
      return <ReviewQueue />
    case 'transcript':
      return <TranscriptView sessionId={currentView.sessionId} filePath={currentView.filePath} hasSessionNote={currentView.hasSessionNote} />
    case 'settings':
      return <Settings />
    default:
      return (
        <div className="content-empty">
          <div className="content-empty__icon">&#x2733;</div>
          <div className="content-empty__text">
            Select a topic from the sidebar to browse your knowledge base, or use the search bar to find something specific.
          </div>
        </div>
      )
  }
}

export default function App(): React.ReactElement {
  useFileWatcher()
  const { sidebarWidth } = useUIStore()

  return (
    <div className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}>
      <SearchBar />
      <Sidebar />
      <div className="content">
        <ContentArea />
      </div>
      <ClaudeDialog />
      <StatusBar />

      {/* Modal dialogs — rendered at root level */}
      <InvalidateDialog />
      <FlagDialog />
    </div>
  )
}
