import { useState, useRef, useEffect, useCallback } from 'react'
import { useProjects } from '@/hooks/useProjects'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { Clock, Settings, Search, Sun, Moon, Coffee, Plus, Terminal, Brain, PanelLeftClose, PanelLeftOpen, Keyboard, CheckSquare, ChevronRight, Archive, GitBranch, GripVertical, HelpCircle } from 'lucide-react'

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
      {/* Drag region for Electron title bar */}
      <div className="h-8 shrink-0" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      {/* Logo + collapse toggle */}
      <div className={`flex items-center ${collapsed ? 'justify-center py-3' : 'px-5 pb-2'}`}>
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
              <img src="/branding/axon-mark-light.png" alt="" className="w-9 h-9 rounded" aria-hidden="true" />
              <span className="font-serif italic text-display text-[var(--ax-text-on-dark)] tracking-tight">axon</span>
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

      {/* Middle section — projects + views centered together */}
      <div className="flex-1 flex flex-col justify-center min-h-0 py-4">

      {/* Project Switcher */}
      {!collapsed && (<>
        <div className="px-3 pb-3 mx-2 pt-3 rounded-xl bg-white/[0.03]" role="group" aria-label="Project switcher">
          <div className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)] px-2 mb-2" aria-hidden="true">
            Projects
          </div>
          <button
            onClick={() => setView('onboarding')}
            aria-label="Add new project"
            className="w-full text-left px-3 py-1.5 rounded-lg mb-1.5 flex items-center gap-2.5 transition-all duration-150
              text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]
              border border-dashed border-white/10 hover:border-white/20
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
          >
            <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-micro">New Project</span>
          </button>
          <div ref={listRef} className="overflow-y-auto max-h-[40vh]">
          {(dragIdx !== null && dragThreshold.current ? getDragOrder() : activeProjects).map((p, _i) => {
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
        {/* Project dots */}
        {projects.filter(p => p.status === 'active').length > 1 && (
          <div className="flex justify-center gap-1.5 pt-3 pb-12" aria-label="Project position">
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
      </>)}

      {/* Navigation */}
      <nav className={`${collapsed ? 'px-1' : 'px-3'} pt-4 pb-2`} aria-label="Main views">
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

      </nav>

      </div>{/* end middle section */}

      {/* Utility nav — Terminal, Settings — anchored above footer */}
      <div className={`${collapsed ? 'px-1' : 'px-3'} pb-2`}>
        <div className={`border-t border-white/10 ${collapsed ? 'mx-1' : 'mx-2'} mb-1.5`} />
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
      </div>

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
          onClick={() => setView('about')}
          aria-label="About Axon"
          className={`p-2 rounded-lg transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
            ${activeView === 'about'
              ? 'bg-white/5 text-[var(--ax-text-on-dark)]'
              : 'text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]'
            }`}
        >
          <HelpCircle size={15} strokeWidth={1.5} />
        </button>
        <a
          href="https://discord.gg/kMw4XKn7v7"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Axon Discord"
          className="p-2 rounded-lg text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"/></svg>
        </a>
        <a
          href="https://x.com/AXONEMBODIED"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Axon on X"
          className="p-2 rounded-lg text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        </a>
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
