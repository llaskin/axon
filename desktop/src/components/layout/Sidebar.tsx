import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useProjects } from '@/hooks/useProjects'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { useDebugStore } from '@/store/debugStore'
import { useDiscoveredRepos } from '@/hooks/useDiscoveredRepos'
import { Clock, Settings, Search, Sun, Moon, Coffee, Plus, Terminal, Brain, PanelLeftClose, PanelLeftOpen, Keyboard, CheckSquare, GitBranch, GripVertical, HelpCircle, X } from 'lucide-react'

const HINT_STORAGE_KEY = 'axon-shortcut-hints-dismissed'
const HINT_DURATION_MS = 4000

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
  const { repos: discoveredRepos } = useDiscoveredRepos()

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

  // Shortcut hint — speech bubble that pops out to the right of the sidebar
  const [hint, setHint] = useState<{ keys: string[]; desc: string; top: number } | null>(null)
  const [hintsDismissed, setHintsDismissed] = useState(
    () => localStorage.getItem(HINT_STORAGE_KEY) === 'true'
  )
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Clear stale keys from previous versions on mount
  useEffect(() => {
    localStorage.removeItem('axon-shortcut-hints-seen')
  }, [])

  const showHint = useCallback((keys: string[], desc: string, el: HTMLElement) => {
    if (localStorage.getItem(HINT_STORAGE_KEY) === 'true') return
    if (hintTimer.current) clearTimeout(hintTimer.current)
    const rect = el.getBoundingClientRect()
    setHint({ keys, desc, top: rect.top + rect.height / 2 })
    hintTimer.current = setTimeout(() => setHint(null), HINT_DURATION_MS)
  }, [])
  const dismissHints = useCallback(() => {
    localStorage.setItem(HINT_STORAGE_KEY, 'true')
    setHint(null)
    setHintsDismissed(true)
    if (hintTimer.current) clearTimeout(hintTimer.current)
  }, [])

  // Register debug action to reset/toggle hint dismissal
  const debugRegister = useDebugStore(s => s.register)
  const debugUnregister = useDebugStore(s => s.unregister)
  useEffect(() => {
    debugRegister({
      id: 'shortcut-hints',
      label: `Shortcut hints (${hintsDismissed ? 'dismissed' : 'active'})`,
      active: !hintsDismissed,
      toggle: () => {
        if (hintsDismissed) {
          localStorage.removeItem(HINT_STORAGE_KEY)
          setHintsDismissed(false)
        } else {
          localStorage.setItem(HINT_STORAGE_KEY, 'true')
          setHintsDismissed(true)
          setHint(null)
        }
      },
    })
    return () => debugUnregister('shortcut-hints')
  }, [hintsDismissed, debugRegister, debugUnregister])

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!shortcutsOpen) return
    const handleClick = (e: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.target as Node)) {
        setShortcutsOpen(false)
      }
    }
    const handleLeave = (e: MouseEvent) => {
      if (shortcutsRef.current && !shortcutsRef.current.contains(e.relatedTarget as Node)) {
        setShortcutsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    shortcutsRef.current?.addEventListener('mouseleave', handleLeave)
    const ref = shortcutsRef.current
    return () => {
      document.removeEventListener('mousedown', handleClick)
      ref?.removeEventListener('mouseleave', handleLeave)
    }
  }, [shortcutsOpen])

  useEffect(() => {
    const toggle = () => setShortcutsOpen(o => !o)
    window.addEventListener('toggle-shortcuts', toggle)
    return () => window.removeEventListener('toggle-shortcuts', toggle)
  }, [])

  const sidebar = (
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

      {/* Collapsed project indicator */}
      {collapsed && activeProjectData && (
        <button
          onClick={toggleSidebar}
          title={activeProjectData.name}
          className="mx-auto mb-2 flex items-center justify-center"
          aria-label={`Active project: ${activeProjectData.name}`}
        >
          <span className={`w-2.5 h-2.5 rounded-full ${
            activeProjectData.status === 'active' ? 'bg-ax-accent' :
            activeProjectData.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
          }`} />
        </button>
      )}

      {/* Project Switcher */}
      {!collapsed && (<>
        <div className="px-3 pb-3 mx-2 pt-3 rounded-xl bg-white/[0.03]" role="group" aria-label="Project switcher">
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)]">
              Projects
            </span>
            {archivedProjects.length > 0 && (
              <button
                onClick={() => setShowArchived(v => !v)}
                className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors
                  ${showArchived
                    ? 'text-[var(--ax-text-on-dark)] bg-white/10'
                    : 'text-[var(--ax-text-on-dark-muted)] hover:text-[var(--ax-text-on-dark)]'
                  }`}
              >
                {showArchived ? 'All' : 'Active'}
              </button>
            )}
          </div>
          <div ref={listRef} className="overflow-y-auto max-h-[40vh]">
          {(dragIdx !== null && dragThreshold.current ? getDragOrder() : (showArchived ? [...activeProjects, ...archivedProjects] : activeProjects)).map((p, _i) => {
            const isToday = p.lastRollup === today
            const isArchived = p.status === 'archived'
            const isGenesis = p.episodeCount === 0 && p.genesisStatus === 'running'
            const isDragging = dragIdx !== null && dragThreshold.current
            const isDraggedItem = isDragging && overIdx !== null &&
              p.name === activeProjects[dragIdx!]?.name
            return (
              <button
                key={p.name}
                data-drag-item
                onClick={(e) => {
                  if (!dragThreshold.current) {
                    setActiveProject(p.name)
                    showHint(['⌘', '↑', '↓'], 'to switch projects', e.currentTarget)
                  }
                }}
                onPointerDown={isArchived ? undefined : (e) => handlePointerDown(e, activeProjects.findIndex(ap => ap.name === p.name))}
                onPointerMove={isArchived ? undefined : handlePointerMove}
                onPointerUp={isArchived ? undefined : handlePointerUp}
                aria-label={`Switch to ${p.name}${isArchived ? ' (archived)' : ''}${p.openLoopCount > 0 ? `, ${p.openLoopCount} open loops` : ''}`}
                aria-pressed={activeProject === p.name}
                className={`w-full text-left px-3 py-1.5 rounded-lg mb-0.5 flex items-center gap-2.5 transition-all duration-150 select-none group
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                  ${isDraggedItem ? 'bg-white/15 shadow-lg scale-[1.02]' : ''}
                  ${isArchived ? 'opacity-50 hover:opacity-70' : ''}
                  ${activeProject === p.name
                    ? 'bg-white/10 text-[var(--ax-text-on-dark)] border-l-2 border-l-[var(--ax-brand-primary)]'
                    : 'text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] border-l-2 border-l-transparent'
                  }`}
                style={{ cursor: isDragging ? 'grabbing' : undefined }}
              >
                {!isArchived && <GripVertical size={10} className="shrink-0 opacity-0 group-hover:opacity-30 transition-opacity" aria-hidden="true" />}
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  isGenesis ? 'bg-ax-brand animate-pulse-dot' :
                  p.status === 'active' ? 'bg-ax-accent' :
                  p.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
                } ${isToday && !isGenesis ? 'animate-pulse-dot' : ''}`} aria-hidden="true" />
                <span className="font-mono text-micro truncate">{p.name}</span>
                {isGenesis ? (
                  <span className="ml-auto font-mono text-[9px] text-[var(--ax-brand-primary)] opacity-60">init...</span>
                ) : p.openLoopCount > 0 ? (
                  <span className="ml-auto font-mono text-micro bg-white/10 px-1.5 py-0.5 rounded" aria-hidden="true">
                    {p.openLoopCount}
                  </span>
                ) : null}
              </button>
            )
          })}
          </div>

          <button
            onClick={() => setView('onboarding')}
            aria-label={`Add new project${discoveredRepos.length > 0 ? ` (${discoveredRepos.length} repos found)` : ''}`}
            className="w-full text-left px-3 py-1.5 rounded-lg mt-1.5 flex items-center gap-2.5 transition-all duration-150
              text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]
              border border-dashed border-white/10 hover:border-white/20
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
          >
            <Plus size={13} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-micro">New Project</span>
            {discoveredRepos.length > 0 && (
              <span className="ml-auto font-mono text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-[var(--ax-text-on-dark-muted)]">
                {discoveredRepos.length}
              </span>
            )}
          </button>
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
        {mainNav.map((item) => {
          const isActive = activeView === item.id || (item.id === 'timeline' && ['rollup-detail', 'state', 'decisions'].includes(activeView))
          const disabled = isUninitialized
          return (
            <button
              key={item.id}
              onClick={(e) => {
                if (disabled) return
                setView(item.id)
                if (!collapsed) showHint(['⌘', '←', '→'], 'to slide views', e.currentTarget)
              }}
              title={collapsed ? item.label : undefined}
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
        {utilNav.map((item, idx) => {
          const isActive = activeView === item.id
          const keyNum = mainNav.length + idx + 1
          return (
            <button
              key={item.id}
              onClick={(e) => {
                setView(item.id)
                if (!collapsed) showHint(['⌘', String(keyNum)], `for ${item.label}`, e.currentTarget)
              }}
              title={collapsed ? item.label : undefined}
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

  const hintBubble = hint && !collapsed ? createPortal(
    <div
      className="animate-hint-flash"
      style={{
        position: 'fixed',
        zIndex: 99999,
        top: `${Math.round(hint.top)}px`,
        left: '272px',
        pointerEvents: 'auto',
      }}
    >
      {/* Vertically center on the button */}
      <div style={{ transform: 'translateY(-50%)' }}>
        {/* Left-pointing arrow */}
        <div
          style={{
            position: 'absolute',
            left: -4,
            top: '50%',
            width: 8,
            height: 8,
            background: '#1e1b18',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRight: 'none',
            borderTop: 'none',
            transform: 'translateY(-50%) rotate(45deg)',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#1e1b18',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '6px 8px 6px 12px',
            whiteSpace: 'nowrap',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
          }}
        >
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-mono)' }}>Tip</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {hint.keys.map((k) => (
              <kbd
                key={k}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.85)',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  padding: '2px 5px',
                  borderRadius: 4,
                  lineHeight: 1,
                }}
              >
                {k}
              </kbd>
            ))}
          </span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)' }}>{hint.desc}</span>
          <button
            onClick={(e) => { e.stopPropagation(); dismissHints() }}
            style={{
              marginLeft: 2,
              padding: 2,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            aria-label="Don't show hints again"
          >
            <X size={11} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <>
      {sidebar}
      {hintBubble}
    </>
  )
}
