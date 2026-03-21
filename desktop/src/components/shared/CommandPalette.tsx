import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { Clock, Layers, Brain, Settings, Sun, Moon, FolderOpen, Coffee, Terminal, Search, Sparkles, MessageSquare } from 'lucide-react'

interface Command {
  id: string
  label: string
  category: 'navigation' | 'project' | 'action' | 'session'
  icon: typeof Clock
  action: () => void
  keywords?: string
  detail?: string
  snippet?: string
  meta?: string
}

interface SessionResult {
  id: string
  project_name: string
  first_prompt: string | null
  heuristic_summary: string | null
  message_count: number
  estimated_cost_usd: number | null
  created_at: string | null
  modified_at: string | null
  git_branch: string | null
  snippet: string
  custom_title?: string | null
  nickname?: string | null
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { projects, setActiveProject } = useProjectStore()
  const { setView, theme, toggleTheme, openTerminal } = useUIStore()

  // Build command list
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      // Navigation
      { id: 'nav-timeline', label: 'Timeline', category: 'navigation', icon: Clock, action: () => { setView('timeline'); onClose() }, keywords: 'rollups history' },
      { id: 'nav-morning', label: 'Morning', category: 'navigation', icon: Coffee, action: () => { setView('morning'); onClose() }, keywords: 'briefing session chat' },
      { id: 'nav-state', label: 'State', category: 'navigation', icon: Layers, action: () => { setView('state'); onClose() }, keywords: 'dashboard focus' },
      { id: 'nav-decisions', label: 'Decisions', category: 'navigation', icon: Brain, action: () => { setView('decisions'); onClose() }, keywords: 'traces search' },
      { id: 'nav-agents', label: 'Agents', category: 'navigation', icon: Brain, action: () => { setView('agents'); onClose() }, keywords: 'agents command center sessions canvas' },
      { id: 'nav-terminal', label: 'Terminal', category: 'navigation', icon: Terminal, action: () => { setView('terminal'); onClose() }, keywords: 'terminal run claude tools' },
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

  // Filter commands by query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.category.includes(q) ||
      c.keywords?.toLowerCase().includes(q)
    )
  }, [commands, query])

  // Convert session results to Command items
  const sessionCommands = useMemo<Command[]>(() => {
    return sessionResults.map(s => {
      const title = s.nickname || s.custom_title || s.first_prompt || 'Untitled session'
      const date = s.modified_at ? new Date(s.modified_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
      return {
        id: `session-${s.id}`,
        label: title.length > 60 ? title.slice(0, 57) + '…' : title,
        category: 'session' as const,
        icon: MessageSquare,
        action: () => {
          setActiveProject(s.project_name)
          openTerminal(s.id)
          onClose()
        },
        detail: s.snippet,
        meta: `${s.project_name} · ${date}`,
      }
    })
  }, [sessionResults, setView, onClose])

  // Combined list: commands first, then sessions
  const allItems = useMemo(() => [...filteredCommands, ...sessionCommands], [filteredCommands, sessionCommands])

  // Debounced FTS5 search
  const searchSessions = useCallback((q: string) => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (q.trim().length < 2) {
      setSessionResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/axon/sessions/search?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data = await res.json()
          setSessionResults((data.results || []).slice(0, 8))
        }
      } catch { /* ignore */ }
      setSearching(false)
    }, 250)
  }, [])

  // Trigger search when query changes
  useEffect(() => {
    searchSessions(query)
  }, [query, searchSessions])

  // Reset selection when list changes
  useEffect(() => {
    setSelectedIdx(0)
  }, [allItems.length])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setSessionResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('[aria-selected="true"]') as HTMLElement
      selected?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [])

  if (!open) return null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, allItems.length))  // +1 for deep search button
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIdx < allItems.length && allItems[selectedIdx]) {
        allItems[selectedIdx].action()
      } else if (selectedIdx === allItems.length && query.trim()) {
        // Deep search button selected
        setView('deep-search')
        onClose()
      }
      return
    }
  }

  const categoryLabels: Record<string, string> = {
    navigation: 'Views',
    project: 'Projects',
    action: 'Actions',
    session: 'Sessions',
  }

  // Group by category
  const grouped: Array<{ category: string; items: Array<Command & { globalIdx: number }> }> = []
  let globalIdx = 0
  const seen = new Set<string>()
  for (const cmd of allItems) {
    if (!seen.has(cmd.category)) {
      seen.add(cmd.category)
      grouped.push({ category: cmd.category, items: [] })
    }
    const group = grouped.find(g => g.category === cmd.category)!
    group.items.push({ ...cmd, globalIdx })
    globalIdx++
  }

  const hasQuery = query.trim().length >= 2
  const showDeepSearch = hasQuery

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
            <Search size={14} className="text-ax-text-tertiary shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands, projects, sessions..."
              aria-label="Search"
              className="flex-1 bg-transparent text-body text-ax-text-primary placeholder-ax-text-tertiary
                focus:outline-none"
            />
            {searching && (
              <div className="w-3 h-3 border border-ax-brand/40 border-t-ax-brand rounded-full animate-spin" />
            )}
            <kbd className="font-mono text-micro text-ax-text-tertiary bg-ax-sunken px-1.5 py-0.5 rounded">esc</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[400px] overflow-y-auto py-2" role="listbox">
            {allItems.length === 0 && !searching && hasQuery && (
              <div className="px-4 py-6 text-center text-small text-ax-text-tertiary">
                No results for "{query}"
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
                    className={`w-full flex flex-col gap-0.5 px-4 py-2 text-left transition-colors
                      ${cmd.globalIdx === selectedIdx
                        ? 'bg-ax-brand/10 text-ax-text-primary'
                        : 'text-ax-text-secondary hover:bg-ax-sunken'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <cmd.icon size={14} strokeWidth={1.5} className="shrink-0 text-ax-text-tertiary" aria-hidden="true" />
                      <span className="text-body truncate">{cmd.label}</span>
                      {cmd.category === 'project' && (
                        <span className="ml-auto font-mono text-micro text-ax-text-tertiary">project</span>
                      )}
                      {cmd.meta && (
                        <span className="ml-auto font-mono text-micro text-ax-text-tertiary shrink-0">{cmd.meta}</span>
                      )}
                    </div>
                    {cmd.detail && (
                      <div
                        className="pl-[26px] font-mono text-[10px] text-ax-text-tertiary truncate"
                        dangerouslySetInnerHTML={{ __html: cmd.detail.replace(/<(?!\/?mark>)[^>]+>/gi, '') }}
                      />
                    )}
                  </button>
                ))}
              </div>
            ))}

            {/* Deep Search CTA */}
            {showDeepSearch && (
              <>
                <div className="mx-4 my-1 border-t border-ax-border-subtle" />
                <button
                  role="option"
                  aria-selected={selectedIdx === allItems.length}
                  onClick={() => {
                    // Store the query for the deep search view
                    sessionStorage.setItem('axon-deep-search-query', query)
                    setView('deep-search')
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIdx(allItems.length)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                    ${selectedIdx === allItems.length
                      ? 'bg-ax-brand/10 text-ax-brand'
                      : 'text-ax-text-tertiary hover:bg-ax-sunken hover:text-ax-brand'
                    }`}
                >
                  <Sparkles size={14} strokeWidth={1.5} className="shrink-0" />
                  <span className="text-body">Deep search with AI</span>
                  <span className="ml-auto font-mono text-micro opacity-60">⇧⌘F</span>
                </button>
              </>
            )}
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
