import { create } from 'zustand'

export type ViewId = 'timeline' | 'state' | 'decisions' | 'settings' | 'rollup-detail' | 'morning' | 'onboarding' | 'agent'

interface UIStore {
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  activeView: ViewId
  selectedRollup: string | null
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
  toggleTheme: () => void
  setView: (view: ViewId) => void
  openRollup: (filename: string) => void
  goBack: () => void
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
  selectedRollup: null,
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
  setView: (view) => set({ activeView: view, selectedRollup: null }),
  openRollup: (filename) => set({ activeView: 'rollup-detail', selectedRollup: filename }),
  goBack: () => set({ activeView: 'timeline', selectedRollup: null }),
}))
