import { useState, useRef, useEffect, useCallback } from 'react'
import { useProjects } from '@/hooks/useProjects'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { Clock, Settings, Search, Sun, Moon, Coffee, Plus, Terminal, Brain, PanelLeftClose, PanelLeftOpen, Keyboard, CheckSquare, ChevronRight, Archive, GitBranch, GripVertical } from 'lucide-react'

const mainNav: { id: ViewId; label: string; icon: typeof Clock }[] = [
  { id: 'morning', label: 'Morning', icon: Coffee },
  { id: 'agents', label: 'Agents', icon: Brain },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'source', label: 'Source', icon: GitBranch },
  { id: 'todos', label: 'Tasks', icon: CheckSquare },
]

const utilNav: { id: ViewId; label: string; icon: typeof Clock }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Cmd', '1–7'], label: 'Switch view' },
  { keys: ['Cmd', 'Shift', 'G'], label: 'Source control' },
  { keys: ['Cmd', 'Shift', 'T'], label: 'Tasks' },
  { keys: ['Cmd', '←', '→'], label: 'Slide views' },
  { keys: ['Cmd', '↑', '↓'], label: 'Switch project' },
  { keys: ['Cmd', 'K'], label: 'Search' },
  { keys: ['Cmd', 'Shift', '/'], label: 'This panel' },
]

export function Sidebar({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const { projects, activeProject, setActiveProject } = useProjects()
  const { activeView, setView, theme, toggleTheme, sidebarOpen, toggleSidebar } = useUIStore()
  const today = new Date().toISOString().split('T')[0]
  const collapsed = !sidebarOpen

  const activeProjectData = projects.find(p => p.name === activeProject)
  const isUninitialized = activeProjectData ? activeProjectData.episodeCount === 0 : false

  const activeProjects = projects.filter(p => p.status !== 'archived')
  const archivedProjects = projects.filter(p => p.status === 'archived')
  const [showArchived, setShowArchived] = useState(false)

  const reorderProjects = useProjectStore(s => s.reorderProjects)

  // Drag-to-reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const dragStartY = useRef(0)
  const dragThreshold = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  const getDragOrder = useCallback(() => {
    if (dragIdx === null || overIdx === null || dragIdx === overIdx) return activeProjects
    const items = [...activeProjects]
    const [moved] = items.splice(dragIdx, 1)
    items.splice(overIdx, 0, moved)
    return items
  }, [activeProjects, dragIdx, overIdx])

  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    // Only left button
    if (e.button !== 0) return
    dragStartY.current = e.clientY
    dragThreshold.current = false
    setDragIdx(idx)
    setOverIdx(idx)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragIdx === null || !listRef.current) return
    const dy = Math.abs(e.clientY - dragStartY.current)
    if (!dragThreshold.current && dy < 5) return
    dragThreshold.current = true

    // Determine which index we're over based on Y position
    const items = listRef.current.querySelectorAll('[data-drag-item]')
    let closest = dragIdx
    let minDist = Infinity
    items.forEach((el, i) => {
      const rect = el.getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const dist = Math.abs(e.clientY - center)
      if (dist < minDist) { minDist = dist; closest = i }
    })
    setOverIdx(closest)
  }, [dragIdx])

  const handlePointerUp = useCallback(() => {
    if (dragIdx !== null && overIdx !== null && dragThreshold.current && dragIdx !== overIdx) {
      const reordered = getDragOrder()
      reorderProjects(reordered.map(p => p.name))
    }
    setDragIdx(null)
    setOverIdx(null)
    dragThreshold.current = false
  }, [dragIdx, overIdx, getDragOrder, reorderProjects])

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shortcutsOpen) return
    const handler = (e: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShortcutsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [shortcutsOpen])

  useEffect(() => {
    const toggle = () => setShortcutsOpen(o => !o)
    window.addEventListener('toggle-shortcuts', toggle)
    return () => window.removeEventListener('toggle-shortcuts', toggle)
  }, [])

  return (
    <aside
      className={`h-screen bg-ax-sidebar flex flex-col shrink-0 transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-64'
      }`}
      role="complementary"
      aria-label="Sidebar navigation"
    >
      {/* Logo + collapse toggle */}
      <div className={`flex items-center ${collapsed ? 'justify-center py-3' : 'px-5 py-4'}`}>
        {collapsed ? (
          <button
            onClick={toggleSidebar}
            className="p-1 text-[var(--ax-text-on-dark-muted)] hover:text-[var(--ax-text-on-dark)] transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)] rounded"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen size={18} />
          </button>
        ) : (
          <>
            <button
              className="flex items-center gap-2.5 cursor-pointer flex-1
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)] rounded"
              onClick={() => setView('timeline')}
              aria-label="Go to timeline"
            >
              <img src="/branding/axon-mark-light.png" alt="" className="w-7 h-7 rounded" aria-hidden="true" />
              <span className="font-serif italic text-h2 text-[var(--ax-text-on-dark)] tracking-tight">axon</span>
            </button>
            <button
              onClick={toggleSidebar}
              className="p-1 text-[var(--ax-text-on-dark-muted)] hover:text-[var(--ax-text-on-dark)] transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)] rounded"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      {/* Project Switcher */}
      {!collapsed && (
        <div className="px-3 mb-3" role="group" aria-label="Project switcher">
          <div className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)] px-2 mb-1.5" aria-hidden="true">
            Projects
          </div>
          <button
            onClick={() => setView('onboarding')}
            aria-label="Add new project"
            className="w-full text-left px-3 py-1.5 rounded-lg mb-1 flex items-center gap-2.5 transition-all duration-150
              text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]
              border border-dashed border-white/10 hover:border-white/20
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
          >
            <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-micro">New Project</span>
          </button>
          <div ref={listRef}>
          {(dragIdx !== null && dragThreshold.current ? getDragOrder() : activeProjects).map((p, i) => {
            const isToday = p.lastRollup === today
            const isDragging = dragIdx !== null && dragThreshold.current
            const isDraggedItem = isDragging && overIdx !== null &&
              p.name === activeProjects[dragIdx!]?.name
            return (
              <button
                key={p.name}
                data-drag-item
                onClick={() => { if (!dragThreshold.current) setActiveProject(p.name) }}
                onPointerDown={(e) => handlePointerDown(e, activeProjects.findIndex(ap => ap.name === p.name))}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                aria-label={`Switch to ${p.name}${p.openLoopCount > 0 ? `, ${p.openLoopCount} open loops` : ''}`}
                aria-pressed={activeProject === p.name}
                className={`w-full text-left px-3 py-1.5 rounded-lg mb-0.5 flex items-center gap-2.5 transition-all duration-150 select-none group
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                  ${isDraggedItem ? 'bg-white/15 shadow-lg scale-[1.02]' : ''}
                  ${activeProject === p.name
                    ? 'bg-white/10 text-[var(--ax-text-on-dark)] border-l-2 border-l-[var(--ax-brand-primary)]'
                    : 'text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] border-l-2 border-l-transparent'
                  }`}
                style={{ cursor: isDragging ? 'grabbing' : undefined }}
              >
                <GripVertical size={10} className="shrink-0 opacity-0 group-hover:opacity-30 transition-opacity" aria-hidden="true" />
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  p.status === 'active' ? 'bg-ax-accent' :
                  p.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
                } ${isToday ? 'animate-pulse-dot' : ''}`} aria-hidden="true" />
                <span className="font-mono text-micro truncate">{p.name}</span>
                {p.openLoopCount > 0 && (
                  <span className="ml-auto font-mono text-micro bg-white/10 px-1.5 py-0.5 rounded" aria-hidden="true">
                    {p.openLoopCount}
                  </span>
                )}
              </button>
            )
          })}
          </div>

          {/* Archived projects — collapsible */}
          {archivedProjects.length > 0 && (
            <>
              <button
                onClick={() => setShowArchived(v => !v)}
                className="w-full text-left px-3 py-1.5 mt-1 flex items-center gap-2 text-[var(--ax-text-on-dark-muted)] hover:text-[var(--ax-text-on-dark)] transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)] rounded-lg"
              >
                <ChevronRight size={12} className={`transition-transform duration-200 ${showArchived ? 'rotate-90' : ''}`} />
                <Archive size={12} strokeWidth={1.5} />
                <span className="font-mono text-micro uppercase tracking-wider">Archived ({archivedProjects.length})</span>
              </button>
              {showArchived && archivedProjects.map((p) => (
                <button
                  key={p.name}
                  onClick={() => setActiveProject(p.name)}
                  aria-label={`Switch to archived project ${p.name}`}
                  aria-pressed={activeProject === p.name}
                  className={`w-full text-left px-3 py-2 rounded-lg mb-0.5 flex items-center gap-3 transition-all duration-150
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                    ${activeProject === p.name
                      ? 'bg-white/10 text-[var(--ax-text-on-dark)] border-l-2 border-l-[var(--ax-brand-primary)]'
                      : 'text-[var(--ax-text-on-dark-muted)] opacity-50 hover:opacity-70 hover:bg-white/5 border-l-2 border-l-transparent'
                    }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0 bg-ax-text-tertiary" aria-hidden="true" />
                  <span className="font-mono text-small truncate">{p.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* Project dots — macOS Spaces-style indicator */}
      {!collapsed && projects.filter(p => p.status === 'active').length > 1 && (
        <div className="flex justify-center gap-1.5 px-3 pb-3" aria-label="Project position">
          {projects.filter(p => p.status === 'active').map((p) => (
            <button
              key={p.name}
              onClick={() => setActiveProject(p.name)}
              aria-label={`Switch to ${p.name}`}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                ${activeProject === p.name
                  ? 'bg-[var(--ax-text-on-dark)] scale-125'
                  : 'bg-[var(--ax-text-on-dark-muted)] hover:bg-[var(--ax-text-on-dark)] opacity-40 hover:opacity-70'
                }`}
            />
          ))}
        </div>
      )}

      {/* Navigation */}
      <nav className={`${collapsed ? 'px-1' : 'px-3'} flex-1 flex flex-col`} aria-label="Main views">
        {!collapsed && (
          <div className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)] px-2 mb-1" aria-hidden="true">
            Views
          </div>
        )}
        {mainNav.map((item) => {
          const isActive = activeView === item.id || (item.id === 'timeline' && ['rollup-detail', 'state', 'decisions'].includes(activeView))
          const disabled = isUninitialized
          return (
            <button
              key={item.id}
              onClick={() => !disabled && setView(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              aria-disabled={disabled}
              className={`w-full text-left rounded-lg mb-0.5 flex items-center transition-all duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                ${collapsed ? 'justify-center p-2' : 'px-3 py-1.5 gap-2.5'}
                ${disabled
                  ? 'opacity-30 cursor-not-allowed'
                  : isActive
                    ? `bg-white/10 text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-[var(--ax-brand-primary)]'}`
                    : `text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-transparent'}`
                }`}
            >
              <item.icon size={collapsed ? 18 : 15} strokeWidth={1.5} aria-hidden="true" />
              {!collapsed && <span className="text-micro">{item.label}</span>}
            </button>
          )
        })}

        {/* Separator */}
        <div className={`border-t border-white/10 ${collapsed ? 'mx-1' : 'mx-2'} mt-auto mb-1.5`} />

        {utilNav.map((item) => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full text-left rounded-lg mb-0.5 flex items-center transition-all duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                ${collapsed ? 'justify-center p-2' : 'px-3 py-1.5 gap-2.5'}
                ${isActive
                  ? `bg-white/10 text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-[var(--ax-brand-primary)]'}`
                  : `text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-transparent'}`
                }`}
            >
              <item.icon size={collapsed ? 18 : 15} strokeWidth={1.5} aria-hidden="true" />
              {!collapsed && <span className="text-micro">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Footer — horizontal row */}
      <div className={`${collapsed ? 'px-1 flex flex-col items-center gap-1' : 'px-3 flex items-center justify-center gap-1'} pb-4 relative`}>
        {/* Keyboard shortcuts panel */}
        {shortcutsOpen && (
          <div
            ref={shortcutsRef}
            className="absolute bottom-full left-2 right-2 mb-2 bg-[#1A1614] border border-white/10
              rounded-lg shadow-xl overflow-hidden animate-fade-in"
          >
            <div className="px-3 pt-2.5 pb-1.5 border-b border-white/5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--ax-text-on-dark-muted)]">
                Shortcuts
              </span>
            </div>
            <div className="px-1 py-1.5">
              {SHORTCUTS.map(({ keys, label }) => (
                <div key={label} className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-white/5">
                  <span className="text-[12px] text-[var(--ax-text-on-dark-muted)]">{label}</span>
                  <span className="flex items-center gap-0.5">
                    {keys.map((k) => (
                      <kbd key={k} className="font-mono text-[10px] text-[var(--ax-text-on-dark)] bg-white/8 border border-white/10
                        px-1 py-0.5 rounded leading-none">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onOpenPalette}
          aria-label="Search (Cmd+K)"
          className="p-2 rounded-lg text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
        >
          <Search size={15} strokeWidth={1.5} />
        </button>
        <button
          onClick={() => setShortcutsOpen(o => !o)}
          aria-label="Keyboard shortcuts"
          className={`p-2 rounded-lg transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
            ${shortcutsOpen
              ? 'bg-white/5 text-[var(--ax-text-on-dark)]'
              : 'text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]'
            }`}
        >
          <Keyboard size={15} strokeWidth={1.5} />
        </button>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className="p-2 rounded-lg text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
        >
          {theme === 'light'
            ? <Moon size={15} strokeWidth={1.5} />
            : <Sun size={15} strokeWidth={1.5} />
          }
        </button>
      </div>
    </aside>
  )
}
