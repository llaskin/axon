import { useState, useEffect, useRef, useMemo } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { Clock, Layers, Brain, Settings, Sun, Moon, FolderOpen, Coffee, Terminal } from 'lucide-react'

interface Command {
  id: string
  label: string
  category: 'navigation' | 'project' | 'action'
  icon: typeof Clock
  action: () => void
  keywords?: string
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const { projects, setActiveProject } = useProjectStore()
  const { setView, theme, toggleTheme } = useUIStore()

  // Build command list
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      // Navigation
      { id: 'nav-timeline', label: 'Timeline', category: 'navigation', icon: Clock, action: () => { setView('timeline'); onClose() }, keywords: 'rollups history' },
      { id: 'nav-morning', label: 'Morning', category: 'navigation', icon: Coffee, action: () => { setView('morning'); onClose() }, keywords: 'briefing session chat' },
      { id: 'nav-state', label: 'State', category: 'navigation', icon: Layers, action: () => { setView('state'); onClose() }, keywords: 'dashboard focus' },
      { id: 'nav-decisions', label: 'Decisions', category: 'navigation', icon: Brain, action: () => { setView('decisions'); onClose() }, keywords: 'traces search' },
      { id: 'nav-agent', label: 'Agent', category: 'navigation', icon: Terminal, action: () => { setView('agent'); onClose() }, keywords: 'agent run claude tools terminal' },
      { id: 'nav-settings', label: 'Settings', category: 'navigation', icon: Settings, action: () => { setView('settings'); onClose() }, keywords: 'config preferences' },
      // Actions
      { id: 'action-theme', label: theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode', category: 'action', icon: theme === 'light' ? Moon : Sun, action: () => { toggleTheme(); onClose() }, keywords: 'theme dark light mode' },
    ]

    // Projects
    for (const p of projects) {
      cmds.push({
        id: `project-${p.name}`,
        label: p.name,
        category: 'project',
        icon: FolderOpen,
        action: () => { setActiveProject(p.name); onClose() },
        keywords: `project switch ${p.status}`,
      })
    }

    return cmds
  }, [projects, setActiveProject, setView, theme, toggleTheme, onClose])

  // Filter by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.category.includes(q) ||
      c.keywords?.toLowerCase().includes(q)
    )
  }, [commands, query])

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIdx(0)
  }, [filtered.length])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.children[selectedIdx] as HTMLElement
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter' && filtered[selectedIdx]) {
      e.preventDefault()
      filtered[selectedIdx].action()
      return
    }
  }

  const categoryLabels: Record<string, string> = {
    navigation: 'Views',
    project: 'Projects',
    action: 'Actions',
  }

  // Group by category
  const grouped: Array<{ category: string; items: Array<Command & { globalIdx: number }> }> = []
  let globalIdx = 0
  const seen = new Set<string>()
  for (const cmd of filtered) {
    if (!seen.has(cmd.category)) {
      seen.add(cmd.category)
      grouped.push({ category: cmd.category, items: [] })
    }
    const group = grouped.find(g => g.category === cmd.category)!
    group.items.push({ ...cmd, globalIdx })
    globalIdx++
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Palette */}
      <div
        className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 animate-fade-in"
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
      >
        <div className="bg-ax-elevated rounded-xl border border-ax-border shadow-[0_20px_60px_rgba(0,0,0,0.3)] overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-ax-border-subtle">
            <span className="text-ax-text-tertiary" aria-hidden="true">⌘</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command..."
              aria-label="Search commands"
              className="flex-1 bg-transparent text-body text-ax-text-primary placeholder-ax-text-tertiary
                focus:outline-none"
            />
            <kbd className="font-mono text-micro text-ax-text-tertiary bg-ax-sunken px-1.5 py-0.5 rounded">esc</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[300px] overflow-y-auto py-2" role="listbox">
            {filtered.length === 0 && (
              <div className="px-4 py-8 text-center text-small text-ax-text-tertiary">
                No commands matching "{query}"
              </div>
            )}

            {grouped.map(({ category, items }) => (
              <div key={category}>
                <div className="px-4 py-1.5 font-mono text-micro uppercase tracking-widest text-ax-text-tertiary">
                  {categoryLabels[category] || category}
                </div>
                {items.map((cmd) => (
                  <button
                    key={cmd.id}
                    role="option"
                    aria-selected={cmd.globalIdx === selectedIdx}
                    onClick={cmd.action}
                    onMouseEnter={() => setSelectedIdx(cmd.globalIdx)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors
                      ${cmd.globalIdx === selectedIdx
                        ? 'bg-ax-brand/10 text-ax-text-primary'
                        : 'text-ax-text-secondary hover:bg-ax-sunken'
                      }`}
                  >
                    <cmd.icon size={16} strokeWidth={1.5} className="shrink-0 text-ax-text-tertiary" aria-hidden="true" />
                    <span className="text-body">{cmd.label}</span>
                    {cmd.category === 'project' && (
                      <span className="ml-auto font-mono text-micro text-ax-text-tertiary">project</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Footer hints */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-ax-border-subtle text-micro text-ax-text-tertiary">
            <span><kbd className="font-mono bg-ax-sunken px-1 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono bg-ax-sunken px-1 rounded">↵</kbd> select</span>
            <span><kbd className="font-mono bg-ax-sunken px-1 rounded">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </>
  )
}
