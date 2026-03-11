import { type ReactNode, useState, useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { NeuralBackground } from '@/components/shared/NeuralBackground'
import { CommandPalette } from '@/components/shared/CommandPalette'
import { useThemeSync } from '@/hooks/useThemeSync'
import { useDataRefresh } from '@/hooks/useDataRefresh'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { DebugMenu } from '@/components/shared/DebugMenu'

export function Shell({ children }: { children: ReactNode }) {
  useThemeSync()
  useDataRefresh()

  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePalette = useCallback(() => setPaletteOpen(o => !o), [])
  useKeyboardShortcuts(togglePalette)

  const swipeDirection = useProjectStore((s) => s.swipeDirection)
  const activeView = useUIStore((s) => s.activeView)
  const isAgent = activeView === 'agent'

  // Determine animation class based on swipe direction
  const swipeClass = swipeDirection === 'right' ? 'animate-slide-right'
    : swipeDirection === 'left' ? 'animate-slide-left'
    : 'animate-fade-in'

  return (
    <div className="flex h-screen overflow-hidden">
      <a href="#main-content" className="skip-to-content">Skip to content</a>
      <Sidebar onOpenPalette={togglePalette} />
      <main className="flex-1 overflow-y-auto bg-ax-base relative" role="main" aria-label="Main content" id="main-content">
        <NeuralBackground />
        <DebugMenu />
        <div className={`relative ${isAgent ? 'h-full' : 'max-w-3xl mx-auto px-8 py-10'} ${swipeClass}`} key={useProjectStore.getState().activeProject || 'none'}>
          {children}
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
