import { useEffect } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore, type ViewId } from '@/store/uiStore'

/**
 * Global keyboard shortcuts:
 * - Cmd+Left/Right: switch between projects (Spaces-like)
 * - Cmd+K: toggle command palette
 * - Cmd+1-4: switch views
 */
export function useKeyboardShortcuts(onTogglePalette: () => void) {
  const switchProject = useProjectStore((s) => s.switchProject)
  const setView = useUIStore((s) => s.setView)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+K: command palette
      if (meta && e.key === 'k') {
        e.preventDefault()
        onTogglePalette()
        return
      }

      // Cmd+Left/Right: switch projects
      if (meta && e.key === 'ArrowLeft') {
        e.preventDefault()
        switchProject('left')
        return
      }
      if (meta && e.key === 'ArrowRight') {
        e.preventDefault()
        switchProject('right')
        return
      }

      // Cmd+1-5: switch views
      if (meta && e.key >= '1' && e.key <= '6') {
        e.preventDefault()
        const views: ViewId[] = ['timeline', 'morning', 'state', 'decisions', 'agent', 'settings']
        const idx = parseInt(e.key) - 1
        if (views[idx]) setView(views[idx])
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [switchProject, setView, onTogglePalette])
}
