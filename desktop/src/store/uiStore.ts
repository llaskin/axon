import { create } from 'zustand'

export type ViewId = 'timeline' | 'state' | 'decisions' | 'settings' | 'rollup-detail' | 'morning' | 'onboarding' | 'terminal' | 'agents' | 'todos' | 'source' | 'about' | 'genesis-progress'

// Sidebar order — used to determine swipe direction
const VIEW_ORDER: Record<ViewId, number> = {
  'morning': 0, 'agents': 1, 'timeline': 2,
  'source': 3, 'todos': 4, 'terminal': 5, 'settings': 6,
  'about': 7,
  'state': 8, 'decisions': 9, 'rollup-detail': 10, 'onboarding': 11, 'genesis-progress': 12,
}

function getSwipeDir(from: ViewId, to: ViewId): 'left' | 'right' | 'none' {
  const a = VIEW_ORDER[from], b = VIEW_ORDER[to]
  return b > a ? 'left' : b < a ? 'right' : 'none'
}

interface UIStore {
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  activeView: ViewId
  previousView: ViewId | null
  viewSwipeDirection: 'left' | 'right' | 'none'
  selectedRollup: string | null
  resumeSessionId: string | null
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  setView: (view: ViewId) => void
  openRollup: (filename: string) => void
  goBack: () => void
  openTerminal: (sessionId: string) => void
  clearResumeSession: () => void
}

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem('ax-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  theme: getInitialTheme(),
  activeView: 'timeline',
  previousView: null,
  viewSwipeDirection: 'none',
  selectedRollup: null,
  resumeSessionId: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => {
    localStorage.setItem('ax-theme', theme)
    set({ theme })
  },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'light' ? 'dark' : 'light'
    localStorage.setItem('ax-theme', next)
    return { theme: next }
  }),
  setView: (view) => set(s => ({
    activeView: view,
    previousView: s.activeView,
    viewSwipeDirection: getSwipeDir(s.activeView, view),
    selectedRollup: null,
  })),
  openRollup: (filename) => set(s => ({
    activeView: 'rollup-detail',
    previousView: s.activeView,
    viewSwipeDirection: getSwipeDir(s.activeView, 'rollup-detail'),
    selectedRollup: filename,
  })),
  goBack: () => set(s => ({
    activeView: 'timeline',
    previousView: s.activeView,
    viewSwipeDirection: getSwipeDir(s.activeView, 'timeline'),
    selectedRollup: null,
  })),
  openTerminal: (sessionId) => set(s => ({
    activeView: 'terminal',
    previousView: s.activeView,
    viewSwipeDirection: getSwipeDir(s.activeView, 'terminal'),
    resumeSessionId: sessionId,
  })),
  clearResumeSession: () => set({ resumeSessionId: null }),
}))
