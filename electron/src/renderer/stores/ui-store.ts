import { create } from 'zustand'

export type SidebarTab = 'encyclopedia' | 'recent' | 'starred' | 'notes' | 'review'

export type ContentView =
  | { type: 'none' }
  | { type: 'knowledge'; slug: string; subPage?: string }
  | { type: 'session'; id: string }
  | { type: 'digest'; date: string }
  | { type: 'search' }
  | { type: 'user-note'; id: string }
  | { type: 'review-queue' }
  | { type: 'settings' }

interface DialogState {
  type: 'invalidate' | 'flag'
  sectionTitle: string
  sectionIndex: number
  slug: string
}

interface UIState {
  // Sidebar
  activeTab: SidebarTab
  setActiveTab: (tab: SidebarTab) => void
  sidebarWidth: number
  setSidebarWidth: (width: number) => void

  // Content
  currentView: ContentView
  navigate: (view: ContentView) => void

  // Search
  searchQuery: string
  setSearchQuery: (query: string) => void
  isSearchOpen: boolean
  setSearchOpen: (open: boolean) => void
  searchActiveIndex: number
  setSearchActiveIndex: (index: number) => void

  // Editor
  isEditing: boolean
  setEditing: (editing: boolean) => void
  editContent: string
  setEditContent: (content: string) => void

  // Reflection
  isReflecting: boolean
  setReflecting: (reflecting: boolean) => void

  // Dialogs
  activeDialog: DialogState | null
  openDialog: (dialog: DialogState) => void
  closeDialog: () => void
}

export const useUIStore = create<UIState>((set) => ({
  activeTab: 'encyclopedia',
  setActiveTab: (tab) => set({ activeTab: tab }),
  sidebarWidth: 260,
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),

  currentView: { type: 'none' },
  navigate: (view) => set({ currentView: view, isEditing: false }),

  searchQuery: '',
  setSearchQuery: (query) => set({ searchQuery: query, isSearchOpen: query.length >= 2 }),
  isSearchOpen: false,
  setSearchOpen: (open) => set({ isSearchOpen: open }),
  searchActiveIndex: -1,
  setSearchActiveIndex: (index) => set({ searchActiveIndex: index }),

  isEditing: false,
  setEditing: (editing) => set({ isEditing: editing }),
  editContent: '',
  setEditContent: (content) => set({ editContent: content }),

  isReflecting: false,
  setReflecting: (reflecting) => set({ isReflecting: reflecting }),

  activeDialog: null,
  openDialog: (dialog) => set({ activeDialog: dialog }),
  closeDialog: () => set({ activeDialog: null })
}))
