import { useState, useRef, useEffect } from 'react'
import { useProjects } from '@/hooks/useProjects'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { Clock, Settings, Search, Sun, Moon, Coffee, Plus, Terminal, Brain, PanelLeftClose, PanelLeftOpen, Keyboard, CheckSquare } from 'lucide-react'

const mainNav: { id: ViewId; label: string; icon: typeof Clock }[] = [
  { id: 'morning', label: 'Morning', icon: Coffee },
  { id: 'agents', label: 'Agents', icon: Brain },
  { id: 'timeline', label: 'Timeline', icon: Clock },
  { id: 'todos', label: 'Tasks', icon: CheckSquare },
]

const utilNav: { id: ViewId; label: string; icon: typeof Clock }[] = [
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Cmd', '1–6'], label: 'Switch view' },
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
      <div className={`flex items-center ${collapsed ? 'justify-center py-4' : 'px-5 py-6'}`}>
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
        <div className="px-3 mb-4" role="group" aria-label="Project switcher">
          <div className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)] px-2 mb-2" aria-hidden="true">
            Projects
          </div>
          <button
            onClick={() => setView('onboarding')}
            aria-label="Add new project"
            className="w-full text-left px-3 py-2 rounded-lg mb-2 flex items-center gap-3 transition-all duration-150
              text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)]
              border border-dashed border-white/10 hover:border-white/20
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]"
          >
            <Plus size={14} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-small">New Project</span>
          </button>
          {projects.map((p) => {
            const isToday = p.lastRollup === today
            return (
              <button
                key={p.name}
                onClick={() => setActiveProject(p.name)}
                aria-label={`Switch to ${p.name}${p.openLoopCount > 0 ? `, ${p.openLoopCount} open loops` : ''}`}
                aria-pressed={activeProject === p.name}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 flex items-center gap-3 transition-all duration-150
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                  ${activeProject === p.name
                    ? 'bg-white/10 text-[var(--ax-text-on-dark)] border-l-2 border-l-[var(--ax-brand-primary)]'
                    : 'text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] border-l-2 border-l-transparent'
                  }`}
              >
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  p.status === 'active' ? 'bg-ax-accent' :
                  p.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
                } ${isToday ? 'animate-pulse-dot' : ''}`} aria-hidden="true" />
                <span className="font-mono text-small truncate">{p.name}</span>
                {p.openLoopCount > 0 && (
                  <span className="ml-auto font-mono text-micro bg-white/10 px-1.5 py-0.5 rounded" aria-hidden="true">
                    {p.openLoopCount}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Navigation */}
      <nav className={`${collapsed ? 'px-1' : 'px-3'} flex-1 flex flex-col`} aria-label="Main views">
        {!collapsed && (
          <div className="text-micro font-mono uppercase tracking-widest text-[var(--ax-text-on-dark-muted)] px-2 mb-2" aria-hidden="true">
            Views
          </div>
        )}
        {mainNav.map((item) => {
          const isActive = activeView === item.id || (item.id === 'timeline' && ['rollup-detail', 'state', 'decisions'].includes(activeView))
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full text-left rounded-lg mb-1 flex items-center transition-all duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                ${collapsed ? 'justify-center p-2' : 'px-3 py-2 gap-3'}
                ${isActive
                  ? `bg-white/10 text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-[var(--ax-brand-primary)]'}`
                  : `text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-transparent'}`
                }`}
            >
              <item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} aria-hidden="true" />
              {!collapsed && <span className="text-small">{item.label}</span>}
              {!collapsed && item.id === 'todos' && (
                <span className="ml-auto flex items-center gap-0.5" aria-hidden="true">
                  <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">&#8679;</kbd>
                  <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">T</kbd>
                </span>
              )}
            </button>
          )
        })}

        {/* Separator */}
        <div className={`border-t border-white/10 ${collapsed ? 'mx-1' : 'mx-2'} mt-auto mb-2`} />

        {utilNav.map((item) => {
          const isActive = activeView === item.id
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full text-left rounded-lg mb-1 flex items-center transition-all duration-150
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
                ${collapsed ? 'justify-center p-2' : 'px-3 py-2 gap-3'}
                ${isActive
                  ? `bg-white/10 text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-[var(--ax-brand-primary)]'}`
                  : `text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 hover:text-[var(--ax-text-on-dark)] ${collapsed ? '' : 'border-l-2 border-l-transparent'}`
                }`}
            >
              <item.icon size={collapsed ? 18 : 16} strokeWidth={1.5} aria-hidden="true" />
              {!collapsed && <span className="text-small">{item.label}</span>}
            </button>
          )
        })}
      </nav>

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

      {/* Footer */}
      <div className={`${collapsed ? 'px-1' : 'px-3'} pb-5 space-y-1 relative`}>
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
          className={`w-full flex items-center rounded-lg
            text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 transition-colors text-small
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
            ${collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'}`}
        >
          <Search size={collapsed ? 18 : 14} strokeWidth={1.5} aria-hidden="true" />
          {!collapsed && <span>Search</span>}
          {!collapsed && (
            <span className="ml-auto flex items-center gap-0.5" aria-hidden="true">
              <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">Cmd</kbd>
              <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">K</kbd>
            </span>
          )}
        </button>
        <button
          onClick={() => setShortcutsOpen(o => !o)}
          aria-label="Keyboard shortcuts"
          className={`w-full flex items-center rounded-lg
            text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 transition-colors text-small
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
            ${collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'}
            ${shortcutsOpen ? 'bg-white/5 text-[var(--ax-text-on-dark)]' : ''}`}
        >
          <Keyboard size={collapsed ? 18 : 14} strokeWidth={1.5} aria-hidden="true" />
          {!collapsed && <span>Shortcuts</span>}
          {!collapsed && (
            <span className="ml-auto flex items-center gap-0.5" aria-hidden="true">
              <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">Cmd</kbd>
              <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">Shift</kbd>
              <kbd className="font-mono text-[9px] opacity-40 bg-white/5 px-1 py-px rounded leading-none">/</kbd>
            </span>
          )}
        </button>
        <button
          onClick={toggleTheme}
          aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          className={`w-full flex items-center rounded-lg
            text-[var(--ax-text-on-dark-muted)] hover:bg-white/5 transition-colors text-small
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ax-brand-primary)]
            ${collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'}`}
        >
          {theme === 'light' ? (
            <Moon size={collapsed ? 18 : 14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Sun size={collapsed ? 18 : 14} strokeWidth={1.5} aria-hidden="true" />
          )}
          {!collapsed && <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>}
        </button>
      </div>
    </aside>
  )
}
