import { useState, useMemo } from 'react'
import { Coffee, Brain, Clock, GitBranch, CheckSquare, Terminal, Settings, Search, MoreHorizontal, X, Sun, Moon, HelpCircle, ChevronDown, FolderOpen } from 'lucide-react'
import { useUIStore, type ViewId } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'
import { useProjects } from '@/hooks/useProjects'

/* ── Bottom Tab Bar ─────────────────────────────────────────── */

const TABS: { id: ViewId; icon: typeof Clock; label: string }[] = [
  { id: 'morning', icon: Coffee, label: 'Morning' },
  { id: 'agents', icon: Brain, label: 'Agents' },
  { id: 'timeline', icon: Clock, label: 'Timeline' },
  { id: 'source', icon: GitBranch, label: 'Source' },
  { id: 'todos', icon: CheckSquare, label: 'Tasks' },
]

export function BottomTabBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const activeView = useUIStore(s => s.activeView)
  const setView = useUIStore(s => s.setView)
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 bg-ax-elevated/95 backdrop-blur-md border-t border-ax-border-subtle safe-area-bottom"
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="flex items-center justify-around px-2">
          {TABS.map(({ id, icon: Icon, label }) => {
            const isActive = activeView === id
            return (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] min-h-[44px] transition-colors
                  ${isActive ? 'text-ax-brand' : 'text-ax-text-tertiary'}`}
              >
                <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                <span className="text-[9px] font-mono">{label}</span>
              </button>
            )
          })}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="More options"
            className={`flex flex-col items-center gap-0.5 py-2 px-3 min-w-[56px] min-h-[44px] transition-colors
              ${drawerOpen ? 'text-ax-brand' : 'text-ax-text-tertiary'}`}
          >
            <MoreHorizontal size={20} strokeWidth={1.5} />
            <span className="text-[9px] font-mono">More</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      {drawerOpen && <MoreDrawer onClose={() => setDrawerOpen(false)} onOpenPalette={() => { setDrawerOpen(false); onOpenPalette() }} />}
    </>
  )
}

/* ── More Drawer ────────────────────────────────────────────── */

function MoreDrawer({ onClose, onOpenPalette }: { onClose: () => void; onOpenPalette: () => void }) {
  const setView = useUIStore(s => s.setView)
  const { theme, toggleTheme } = useUIStore()

  const items: { id: string; icon: typeof Clock; label: string; action: () => void }[] = [
    { id: 'search', icon: Search, label: 'Search', action: () => { onOpenPalette(); onClose() } },
    { id: 'terminal', icon: Terminal, label: 'Terminal', action: () => { setView('terminal'); onClose() } },
    { id: 'settings', icon: Settings, label: 'Settings', action: () => { setView('settings'); onClose() } },
    { id: 'about', icon: HelpCircle, label: 'About', action: () => { setView('about'); onClose() } },
    { id: 'theme', icon: theme === 'light' ? Moon : Sun, label: theme === 'light' ? 'Dark mode' : 'Light mode', action: () => { toggleTheme(); onClose() } },
  ]

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[45] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed bottom-0 left-0 right-0 z-[46] bg-ax-elevated rounded-t-2xl border-t border-ax-border shadow-[0_-10px_40px_rgba(0,0,0,0.15)] safe-area-bottom animate-slide-up-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-ax-border-subtle">
          <span className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary">More</span>
          <button onClick={onClose} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ax-text-tertiary" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="py-2">
          {items.map(({ id, icon: Icon, label, action }) => (
            <button
              key={id}
              onClick={action}
              className="w-full flex items-center gap-4 px-5 py-3 min-h-[48px] text-left text-ax-text-secondary hover:bg-ax-sunken transition-colors"
            >
              <Icon size={20} strokeWidth={1.5} className="text-ax-text-tertiary shrink-0" />
              <span className="text-body">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

/* ── Project Picker Sheet ───────────────────────────────────── */

function ProjectPickerSheet({ onClose }: { onClose: () => void }) {
  const { projects, activeProject, setActiveProject } = useProjects()
  const [search, setSearch] = useState('')

  const activeProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects])
  const archivedProjects = useMemo(() => projects.filter(p => p.status === 'archived'), [projects])
  const [showArchived, setShowArchived] = useState(false)

  const displayed = useMemo(() => {
    const list = showArchived ? [...activeProjects, ...archivedProjects] : activeProjects
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(p => p.name.toLowerCase().includes(q))
  }, [activeProjects, archivedProjects, showArchived, search])

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[47] animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[48] bg-ax-elevated rounded-t-2xl border-t border-ax-border shadow-[0_-10px_40px_rgba(0,0,0,0.15)] safe-area-bottom animate-slide-up-in"
        style={{ maxHeight: '70vh' }}
        role="dialog"
        aria-modal="true"
        aria-label="Project picker"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-ax-border-subtle">
          <span className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary">Projects</span>
          <div className="flex items-center gap-2">
            {archivedProjects.length > 0 && (
              <button
                onClick={() => setShowArchived(v => !v)}
                className={`font-mono text-[9px] uppercase tracking-wider px-2 py-1 rounded transition-colors
                  ${showArchived ? 'text-ax-text-primary bg-ax-sunken' : 'text-ax-text-tertiary'}`}
              >
                {showArchived ? 'All' : 'Active'}
              </button>
            )}
            <button onClick={onClose} className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ax-text-tertiary" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Search */}
        {projects.length > 5 && (
          <div className="px-4 py-2 border-b border-ax-border-subtle">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter projects..."
              aria-label="Filter projects"
              autoFocus
              className="w-full bg-ax-sunken rounded-lg px-3 py-2 text-small text-ax-text-primary
                placeholder-ax-text-tertiary/50 outline-none focus:ring-1 focus:ring-ax-brand/30
                font-mono"
            />
          </div>
        )}

        {/* Project list */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 120px)' }}>
          {displayed.map(p => {
            const isActive = activeProject === p.name
            const isArchived = p.status === 'archived'
            const isGenesis = p.episodeCount === 0 && p.genesisStatus === 'running'
            return (
              <button
                key={p.name}
                onClick={() => { setActiveProject(p.name); onClose() }}
                className={`w-full flex items-center gap-3 px-5 py-3 min-h-[48px] text-left transition-colors
                  ${isActive ? 'bg-ax-brand/10 text-ax-text-primary' : 'text-ax-text-secondary hover:bg-ax-sunken'}
                  ${isArchived ? 'opacity-50' : ''}`}
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isGenesis ? 'bg-ax-brand animate-pulse-dot' :
                  p.status === 'active' ? 'bg-ax-accent' :
                  p.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
                }`} />
                <span className="font-mono text-small truncate flex-1">{p.name}</span>
                {isGenesis ? (
                  <span className="font-mono text-[9px] text-ax-brand opacity-60 shrink-0">init...</span>
                ) : p.openLoopCount > 0 ? (
                  <span className="font-mono text-micro bg-ax-sunken px-1.5 py-0.5 rounded shrink-0">{p.openLoopCount}</span>
                ) : null}
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-ax-brand shrink-0" />
                )}
              </button>
            )
          })}
          {displayed.length === 0 && (
            <div className="px-5 py-8 text-center text-small text-ax-text-tertiary">
              No projects matching "{search}"
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/* ── Mobile Top Bar ─────────────────────────────────────────── */

export function MobileTopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const activeProject = useProjectStore(s => s.activeProject)
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between px-4 py-2 bg-ax-elevated/95 backdrop-blur-md border-b border-ax-border-subtle safe-area-top min-h-[48px]">
        {/* Project name — tap to open picker */}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-2 min-h-[44px] text-left"
          aria-label={`Current project: ${activeProject || 'None'}. Tap to switch.`}
        >
          <FolderOpen size={16} className="text-ax-text-tertiary shrink-0" />
          <span className="font-mono text-small text-ax-text-primary truncate max-w-[200px]">
            {activeProject || 'No project'}
          </span>
          <ChevronDown size={12} className="text-ax-text-ghost shrink-0" />
        </button>

        {/* Search */}
        <button
          onClick={onOpenPalette}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-ax-text-tertiary hover:text-ax-text-primary transition-colors"
          aria-label="Search"
        >
          <Search size={18} />
        </button>
      </div>

      {pickerOpen && <ProjectPickerSheet onClose={() => setPickerOpen(false)} />}
    </>
  )
}
