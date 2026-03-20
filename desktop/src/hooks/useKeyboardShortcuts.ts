import { useEffect } from 'react'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'

// Terminal + Settings excluded from arrow-key carousel — accessible via Cmd+6/7 or sidebar click
const NAV_VIEWS: ViewId[] = ['morning', 'agents', 'timeline', 'source', 'todos']

/**
 * Global keyboard shortcuts:
 * - Cmd+Left/Right: navigate between sidebar views
 * - Cmd+Up/Down: switch projects (vertical)
 * - Cmd+K: toggle command palette
 * - Cmd+1-6: switch views
 * - Cmd+Shift+T: jump to Tasks
 */
export function useKeyboardShortcuts(onTogglePalette: () => void) {
  const setView = useUIStore((s) => s.setView)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+K: command palette (always works, even in inputs)
      if (meta && e.key === 'k') {
        e.preventDefault()
        onTogglePalette()
        return
      }

      // Don't intercept navigation shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return

      // Cmd+Left/Right: navigate between sidebar views
      if (meta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        const active = useUIStore.getState().activeView
        const idx = NAV_VIEWS.indexOf(active)
        if (idx < 0) return
        const next = e.key === 'ArrowLeft' ? idx - 1 : idx + 1
        if (next >= 0 && next < NAV_VIEWS.length) setView(NAV_VIEWS[next])
        return
      }

      // Cmd+Up/Down: switch projects (vertical navigation)
      if (meta && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const { projects, activeProject } = useProjectStore.getState()
        const activeProjects = projects.filter(p => p.status === 'active')
        if (activeProjects.length < 2) return
        const currentIdx = activeProjects.findIndex(p => p.name === activeProject)
        if (currentIdx === -1) return
        const nextIdx = e.key === 'ArrowDown'
          ? (currentIdx + 1) % activeProjects.length
          : (currentIdx - 1 + activeProjects.length) % activeProjects.length
        useProjectStore.getState().setActiveProject(activeProjects[nextIdx].name)
        return
      }

      // Cmd+Shift+F: deep search
      if (meta && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        setView('deep-search')
        return
      }

      // Cmd+Shift+G: jump to Source Control
      if (meta && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault()
        setView('source')
        return
      }

      // Cmd+Shift+T: jump to Tasks
      if (meta && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        setView('todos')
        return
      }

      // Cmd+? (Cmd+Shift+/): toggle shortcuts panel
      if (meta && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault()
        window.dispatchEvent(new Event('toggle-shortcuts'))
        return
      }

      // Cmd+1-7: switch views
      if (meta && e.key >= '1' && e.key <= '7') {
        e.preventDefault()
        const views: ViewId[] = ['morning', 'agents', 'timeline', 'source', 'todos', 'terminal', 'settings']
        const idx = parseInt(e.key) - 1
        if (views[idx]) setView(views[idx])
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setView, onTogglePalette])
}
