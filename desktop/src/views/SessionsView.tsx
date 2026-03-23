import { useState, useMemo, useEffect, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { useSessions, useSessionSearch, type SessionSummary, type SearchResult } from '@/hooks/useSessions'
import { Search, Globe, FolderOpen, GitBranch, MessageSquare, Wrench, DollarSign, Star, ChevronDown, FileText, Terminal as TerminalIcon, AlertCircle, Play, LayoutGrid, List, Maximize, Minimize } from 'lucide-react'
import { CanvasView } from './agent/CanvasView'
import { ZoneTree } from './agent/ZoneTree'
import { useCanvasState } from './agent/useCanvasState'
import { useDebugStore } from '@/store/debugStore'
import { TILE_W, TILE_H, ZONE_COLORS, snap, type TileState, type ZoneState } from './agent/zoneReducers'

type SessionsMode = 'canvas' | 'list'

// Heat strip colors — warm palette from design system
const HEAT_COLORS: Record<string, string> = {
  read: '#6B8FAD',
  write: '#7B9E7B',
  edit: '#C8956C',
  bash: '#C4933B',
  error: '#B85450',
  chat: '#9B8E83',
}

function HeatStrip({ json, height = 'h-1' }: { json: string | null; height?: string }) {
  if (!json) return null
  let segments: { type: string }[]
  try { segments = JSON.parse(json) } catch { return null }
  if (!segments.length) return null

  // Downsample to ~60 segments
  const MAX = 60
  const step = Math.max(1, Math.ceil(segments.length / MAX))
  const sampled = segments.filter((_, i) => i % step === 0).slice(0, MAX)

  return (
    <div className={`flex ${height} rounded-full overflow-hidden gap-px`} aria-label="Session activity heat strip">
      {sampled.map((seg, i) => (
        <div
          key={i}
          className="flex-1 min-w-[2px]"
          style={{ backgroundColor: HEAT_COLORS[seg.type] || HEAT_COLORS.chat }}
        />
      ))}
    </div>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return dateStr }
}

function groupByTime<T>(items: T[], getDate: (item: T) => string | null): [string, T[]][] {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86400000)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const groups: Record<string, T[]> = {}

  for (const item of items) {
    const dateStr = getDate(item)
    if (!dateStr) { (groups['Older'] ??= []).push(item); continue }
    const d = new Date(dateStr)
    if (d >= todayStart) (groups['Today'] ??= []).push(item)
    else if (d >= weekStart) (groups['This week'] ??= []).push(item)
    else if (d >= monthStart) (groups['This month'] ??= []).push(item)
    else (groups['Older'] ??= []).push(item)
  }

  const order = ['Today', 'This week', 'This month', 'Older']
  return order.filter(k => groups[k]).map(k => [k, groups[k]])
}

function formatCost(cost: number | null): string {
  if (cost === null || cost === undefined) return ''
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}k`
  return String(tokens)
}

type Filter = 'all' | 'pinned' | 'tagged'

// --- Session Detail Panel (fetched on expand) ---

interface SessionDetail {
  session: SessionSummary & {
    estimated_input_tokens: number
    estimated_output_tokens: number
    tool_calls_json: string | null
    git_commands_json: string | null
  }
  filesTouched: { file_path: string; operations: string; count: number }[]
}

function SessionDetailPanel({ sessionId }: { sessionId: string }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/axon/sessions/${sessionId}`)
      .then(r => r.json())
      .then(setDetail)
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) {
    return (
      <div className="mt-4 pt-4 border-t border-ax-border-subtle space-y-2 animate-pulse">
        <div className="h-4 bg-ax-sunken rounded w-32" />
        <div className="h-3 bg-ax-sunken rounded w-48" />
        <div className="h-3 bg-ax-sunken rounded w-40" />
      </div>
    )
  }

  if (!detail?.session) return null

  const s = detail.session
  const toolCalls: { tool: string; count: number }[] = s.tool_calls_json
    ? (() => { try { return JSON.parse(s.tool_calls_json) } catch { return [] } })()
    : []
  const gitCommands: string[] = s.git_commands_json
    ? (() => { try { return JSON.parse(s.git_commands_json) } catch { return [] } })()
    : []

  const maxToolCount = Math.max(...toolCalls.map(t => t.count), 1)

  return (
    <div className="mt-4 pt-4 border-t border-ax-border-subtle space-y-4">
      {/* Timestamps + tokens */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-small">
        {s.created_at && (
          <>
            <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider">Started</span>
            <span className="text-ax-text-secondary">{formatDate(s.created_at)}</span>
          </>
        )}
        {s.modified_at && (
          <>
            <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider">Last active</span>
            <span className="text-ax-text-secondary">{formatDate(s.modified_at)}</span>
          </>
        )}
        {(s.estimated_input_tokens > 0 || s.estimated_output_tokens > 0) && (
          <>
            <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider">Tokens</span>
            <span className="text-ax-text-secondary font-mono text-small">
              {formatTokens(s.estimated_input_tokens)} in / {formatTokens(s.estimated_output_tokens)} out
            </span>
          </>
        )}
      </div>

      {/* Heat strip — larger in detail */}
      <HeatStrip json={s.heatstrip_json} height="h-2" />

      {/* Tool usage histogram */}
      {toolCalls.length > 0 && (
        <div>
          <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-2">Tool Usage</h4>
          <div className="space-y-1">
            {toolCalls.slice(0, 8).map(tc => (
              <div key={tc.tool} className="flex items-center gap-2">
                <span className="font-mono text-micro text-ax-text-secondary w-16 shrink-0 text-right">{tc.tool}</span>
                <div className="flex-1 h-3 bg-ax-sunken rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round((tc.count / maxToolCount) * 100)}%`,
                      backgroundColor: HEAT_COLORS[tc.tool.toLowerCase()] || HEAT_COLORS.chat,
                    }}
                  />
                </div>
                <span className="font-mono text-micro text-ax-text-tertiary w-8">{tc.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files touched */}
      {detail.filesTouched.length > 0 && (
        <div>
          <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-2">
            Files Touched ({detail.filesTouched.length})
          </h4>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {detail.filesTouched.slice(0, 20).map(f => {
              let ops: string[] = []
              try { ops = JSON.parse(f.operations) } catch { ops = [f.operations] }
              return (
                <div key={f.file_path} className="flex items-center gap-2 py-0.5">
                  <FileText size={10} className="text-ax-text-tertiary shrink-0" />
                  <span className="font-mono text-micro text-ax-text-secondary truncate flex-1">{f.file_path}</span>
                  <span className="font-mono text-micro text-ax-text-tertiary shrink-0">{ops.join(', ')}</span>
                  <span className="font-mono text-micro text-ax-text-tertiary shrink-0 w-6 text-right">{f.count}x</span>
                </div>
              )
            })}
            {detail.filesTouched.length > 20 && (
              <p className="font-mono text-micro text-ax-text-tertiary mt-1">
                +{detail.filesTouched.length - 20} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Git commits */}
      {gitCommands.length > 0 && (
        <div>
          <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-2">
            Git Commits ({gitCommands.length})
          </h4>
          <div className="space-y-1">
            {gitCommands.slice(0, 5).map((cmd, i) => (
              <div key={i} className="flex items-start gap-2">
                <TerminalIcon size={10} className="text-ax-text-tertiary mt-0.5 shrink-0" />
                <code className="font-mono text-micro text-ax-text-secondary break-all">{cmd}</code>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions + Session ID */}
      <div className="pt-3 border-t border-ax-border-subtle flex items-center gap-3">
        <button
          onClick={() => useUIStore.getState().openTerminal(sessionId)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-ax-brand text-white rounded-lg
            text-small font-mono hover:bg-ax-brand-hover transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand"
        >
          <Play size={12} />
          Resume in Terminal
        </button>
        <span className="font-mono text-micro text-ax-text-tertiary select-all ml-auto">{sessionId}</span>
      </div>
    </div>
  )
}

// --- Session Card (clickable, expands to show detail) ---

function SessionCard({ session, expanded, onToggle }: {
  session: SessionSummary | SearchResult
  expanded: boolean
  onToggle: () => void
}) {
  const s = session as SessionSummary & SearchResult
  const title = s.nickname || s.first_prompt || 'Untitled session'
  const snippet = 'snippet' in s ? s.snippet : null

  return (
    <div
      className={`bg-ax-elevated rounded-xl border p-5 transition-colors cursor-pointer ${
        expanded ? 'border-ax-brand/40 shadow-sm' : 'border-ax-border hover:border-ax-border-strong'
      }`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      aria-expanded={expanded}
    >
      {/* Title row */}
      <div className="flex items-start gap-2 mb-2">
        {s.pinned && <Star size={14} className="text-ax-warning mt-1 shrink-0 fill-current" />}
        <h3 className="font-serif italic text-h4 text-ax-text-primary line-clamp-2 flex-1">
          {title}
        </h3>
        <ChevronDown
          size={16}
          className={`text-ax-text-tertiary shrink-0 mt-1 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </div>

      {/* Heuristic summary */}
      {s.heuristic_summary && (
        <p className="text-small text-ax-text-secondary mb-2">{s.heuristic_summary}</p>
      )}

      {/* Search snippet */}
      {snippet && (
        <p
          className="text-small text-ax-text-secondary mb-2 line-clamp-2"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      )}

      {/* Metadata badges */}
      <div className="flex items-center gap-3 flex-wrap mb-2">
        <span className="font-mono text-micro text-ax-text-tertiary">
          {timeAgo(s.modified_at)}
        </span>
        {s.message_count > 0 && (
          <span className="font-mono text-micro text-ax-text-tertiary flex items-center gap-1">
            <MessageSquare size={10} /> {s.message_count}
          </span>
        )}
        {s.tool_call_count > 0 && (
          <span className="font-mono text-micro text-ax-text-tertiary flex items-center gap-1">
            <Wrench size={10} /> {s.tool_call_count}
          </span>
        )}
        {s.estimated_cost_usd != null && s.estimated_cost_usd > 0 && (
          <span className="font-mono text-micro text-ax-text-tertiary flex items-center gap-1">
            <DollarSign size={10} /> {formatCost(s.estimated_cost_usd)}
          </span>
        )}
        {s.git_branch && (
          <span className="font-mono text-micro text-ax-text-tertiary flex items-center gap-1">
            <GitBranch size={10} /> {s.git_branch}
          </span>
        )}
        {s.errors != null && (s as SessionSummary).errors > 0 && (
          <span className="font-mono text-micro text-ax-error flex items-center gap-1">
            <AlertCircle size={10} /> {(s as SessionSummary).errors}
          </span>
        )}
        {'project_name' in s && s.project_name && (
          <span className="font-mono text-micro text-ax-text-tertiary ml-auto px-1.5 py-0.5 bg-ax-sunken rounded">
            {s.project_name}
          </span>
        )}
      </div>

      {/* Heat strip */}
      <HeatStrip json={s.heatstrip_json} />

      {/* Tags */}
      {s.tags && s.tags.length > 0 && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {s.tags.map(tag => (
            <span key={tag} className="font-mono text-micro bg-ax-brand-subtle text-ax-brand px-2 py-0.5 rounded-full">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Expandable detail panel */}
      {expanded && (
        <div onClick={(e) => e.stopPropagation()}>
          <SessionDetailPanel sessionId={s.id} />
        </div>
      )}
    </div>
  )
}

// --- Session List (editorial column) ---

function SessionList({ sessions, indexStatus, loading, error }: {
  sessions: SessionSummary[]
  indexStatus: { totalSessions: number; analyticsIndexed: number; ftsIndexed: number; ready: boolean }
  loading: boolean
  error: string | null
}) {
  const activeProject = useProjectStore((s) => s.activeProject)
  const projects = useProjectStore((s) => s.projects)
  const [search, setSearch] = useState('')
  const [crossProject, setCrossProject] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { results: searchResults, loading: searchLoading } = useSessionSearch(search)

  const isSearching = search.trim().length > 0

  // Apply local filters
  const filtered = useMemo(() => {
    let list = sessions
    if (filter === 'pinned') list = list.filter(s => s.pinned)
    if (filter === 'tagged') list = list.filter(s => s.tags && s.tags.length > 0)
    return list
  }, [sessions, filter])

  const grouped = useMemo(() => groupByTime(filtered, s => s.modified_at), [filtered])

  const indexing = indexStatus.ready && indexStatus.analyticsIndexed < indexStatus.totalSessions

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id)

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-ax-sunken rounded w-48" />
        <div className="h-10 bg-ax-sunken rounded w-full" />
        <div className="space-y-4 mt-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-32 bg-ax-sunken rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-body text-ax-text-secondary mt-2">
              <span className="font-mono">{sessions.length}</span> Claude Code sessions
              {activeProject && !crossProject && (
                <> in <span className="font-mono">{activeProject}</span></>
              )}
              {crossProject && (
                <> across <span className="font-mono">{projects.length}</span> projects</>
              )}
            </p>
          </div>

          {projects.length > 1 && (
            <button
              onClick={() => setCrossProject(v => !v)}
              aria-label={crossProject ? 'Show current project only' : 'Search across all projects'}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-small font-mono transition-all
                focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand
                ${crossProject
                  ? 'bg-ax-brand-subtle text-ax-brand border border-ax-brand/30'
                  : 'bg-ax-sunken text-ax-text-tertiary hover:text-ax-text-secondary border border-ax-border-subtle'
                }`}
            >
              {crossProject ? <Globe size={14} /> : <FolderOpen size={14} />}
              {crossProject ? 'All projects' : 'This project'}
            </button>
          )}
        </div>

        {/* Index progress */}
        {indexing && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-micro font-mono text-ax-text-tertiary">
              <div className="w-2 h-2 rounded-full bg-ax-brand animate-pulse" />
              Indexing sessions... {indexStatus.analyticsIndexed}/{indexStatus.totalSessions}
            </div>
            <div className="mt-1 h-0.5 bg-ax-sunken rounded-full overflow-hidden">
              <div
                className="h-full bg-ax-brand transition-all duration-500"
                style={{ width: `${Math.round((indexStatus.analyticsIndexed / Math.max(1, indexStatus.totalSessions)) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {error && (
        <div className="bg-ax-error-subtle border border-ax-error/20 rounded-xl p-5 mb-6">
          <p className="text-body text-ax-error">{error}</p>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ax-text-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
          placeholder="Search sessions..."
          aria-label="Search sessions via full-text search"
          className="w-full bg-ax-elevated border border-ax-border rounded-lg pl-10 pr-4 py-2.5
            text-body text-ax-text-primary placeholder-ax-text-tertiary
            focus:outline-none focus:border-ax-brand focus:ring-1 focus:ring-ax-brand/20
            transition-colors"
        />
        {search && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-micro text-ax-text-tertiary">
            {searchLoading ? '...' : `${searchResults.length} results`}
          </span>
        )}
      </div>

      {/* Filter pills */}
      {!isSearching && sessions.length > 0 && (
        <div className="flex gap-2 mb-6">
          {(['all', 'pinned', 'tagged'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`font-mono text-micro px-3 py-1 rounded-full transition-all
                focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand
                ${filter === f
                  ? 'bg-ax-brand-subtle text-ax-brand'
                  : 'bg-ax-sunken text-ax-text-tertiary hover:text-ax-text-secondary'
                }`}
            >
              {f === 'all' ? 'All' : f === 'pinned' ? 'Pinned' : 'Tagged'}
            </button>
          ))}
        </div>
      )}

      {/* Search results */}
      {isSearching && (
        <div className="space-y-3">
          {searchResults.length === 0 && !searchLoading && (
            <div className="text-center py-16">
              <p className="text-body text-ax-text-tertiary">
                No sessions matching "<span className="font-medium text-ax-text-secondary">{search}</span>"
              </p>
            </div>
          )}
          {searchResults.map(r => (
            <SessionCard
              key={r.id}
              session={r}
              expanded={expandedId === r.id}
              onToggle={() => toggleExpand(r.id)}
            />
          ))}
        </div>
      )}

      {/* Grouped session list */}
      {!isSearching && (
        <>
          {sessions.length === 0 && (
            <div className="text-center py-20">
              <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No sessions found</p>
              <p className="text-body text-ax-text-tertiary">
                {indexStatus.totalSessions === 0
                  ? 'No Claude Code sessions detected in ~/.claude/projects/'
                  : 'Sessions are being indexed...'}
              </p>
            </div>
          )}

          {filtered.length === 0 && sessions.length > 0 && (
            <div className="text-center py-16">
              <p className="text-body text-ax-text-tertiary">
                No {filter === 'pinned' ? 'pinned' : 'tagged'} sessions
              </p>
            </div>
          )}

          <div className="space-y-8">
            {grouped.map(([label, items]) => (
              <div key={label} className="animate-fade-in-up">
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-mono text-small text-ax-text-tertiary shrink-0">
                    {label}
                  </span>
                  <div className="flex-1 border-t border-ax-border-subtle" />
                  <span className="font-mono text-micro text-ax-text-tertiary">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {items.map(s => (
                    <SessionCard
                      key={s.id}
                      session={s}
                      expanded={expandedId === s.id}
                      onToggle={() => toggleExpand(s.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// --- Demo data generator ---

function generateDemoData(): {
  zones: ZoneState[]
  tiles: TileState[]
  sessions: SessionSummary[]
} {
  const now = new Date()
  const hours = (h: number) => new Date(now.getTime() - h * 3600000).toISOString()
  const days = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()

  const makeSession = (
    id: string, nickname: string, summary: string,
    msgs: number, tools: number, cost: number,
    modified: string, branch?: string, pinned?: boolean,
    heatstrip?: { type: string }[]
  ): SessionSummary => ({
    id, project_id: 'demo', project_name: 'axon', project_path: null,
    first_prompt: nickname, custom_title: null, nickname,
    heuristic_summary: summary,
    message_count: msgs, tool_call_count: tools, errors: 0,
    estimated_cost_usd: cost,
    git_branch: branch || 'main',
    heatstrip_json: heatstrip ? JSON.stringify(heatstrip) : null,
    created_at: modified, modified_at: modified,
    analytics_indexed: 1, tags: [], pinned: pinned || false,
  })

  const heat = (types: string[]) => types.map(t => ({ type: t }))

  // Sessions — mix of active, recent, older
  const demoSessions: SessionSummary[] = [
    // Active cluster
    makeSession('demo-1', 'Canvas spatial layout engine', 'Implementing zone-based tile positioning with drag-and-drop, snap-to-grid, and automatic compaction', 47, 89, 1.24, hours(1), 'feat/canvas', true, heat(['edit', 'edit', 'bash', 'read', 'edit', 'write', 'bash', 'edit', 'edit', 'read'])),
    makeSession('demo-2', 'Morning briefing chat UX', 'Building the Claude-powered morning briefing with streaming SSE, editorial typography, and frosted glass effects', 32, 56, 0.87, hours(2), 'feat/morning', false, heat(['chat', 'edit', 'edit', 'read', 'write', 'edit', 'bash', 'chat'])),
    makeSession('demo-3', 'Terminal persistence layer', 'WebSocket PTY management, XTerm.js integration, data buffering for view-switch survival', 28, 41, 0.63, hours(3), 'feat/terminal', false, heat(['bash', 'edit', 'read', 'bash', 'write', 'edit', 'bash', 'edit', 'bash'])),
    makeSession('demo-4', 'Carousel view transitions', 'Three-desktop horizontal slide system with CSS transforms and lazy mounting', 19, 34, 0.52, hours(5), 'feat/carousel', false, heat(['edit', 'edit', 'read', 'edit', 'write'])),

    // Research cluster
    makeSession('demo-5', 'Explore Tauri v2 migration', 'Investigating portable_pty, plugin-shell, and Tauri event system for native terminal support', 15, 22, 0.31, days(1), 'research/tauri', false, heat(['read', 'read', 'chat', 'read', 'read', 'chat'])),
    makeSession('demo-6', 'Design system audit', 'Reviewing editorial neural aesthetic, font hierarchy, color semantics, and component patterns', 12, 8, 0.18, days(2), 'main', false, heat(['read', 'read', 'read', 'chat', 'read'])),
    makeSession('demo-7', 'Plugin architecture RFC', 'Designing the extension system — hooks, lifecycle events, sandboxed execution, and manifest format', 24, 31, 0.45, days(2), 'research/plugins', false, heat(['chat', 'chat', 'edit', 'write', 'read', 'chat', 'edit'])),
    makeSession('demo-8', 'Agent orchestration patterns', 'Multi-agent coordination, task delegation, context sharing, and output routing strategies', 18, 14, 0.28, days(3), 'research/agents', false, heat(['chat', 'read', 'chat', 'chat', 'read'])),

    // Infra cluster
    makeSession('demo-9', 'CI/CD pipeline setup', 'GitHub Actions for desktop builds, CLI releases, and cross-platform testing', 21, 45, 0.58, days(1), 'infra/ci', false, heat(['bash', 'write', 'bash', 'edit', 'bash', 'bash', 'read'])),
    makeSession('demo-10', 'Database schema evolution', 'Session analytics tables, FTS indexing, migration strategy, and query optimization', 16, 27, 0.39, days(4), 'infra/db', false, heat(['edit', 'bash', 'read', 'edit', 'bash'])),
    makeSession('demo-11', 'Performance profiling', 'Canvas rendering benchmarks, terminal throughput, and memory usage under sustained load', 11, 19, 0.22, days(5), 'main', false, heat(['bash', 'bash', 'read', 'bash'])),

    // Older
    makeSession('demo-12', 'Initial CLI scaffolding', 'Setting up the Axon CLI — 15 commands, config management, nightly cron, dendrite format', 38, 67, 0.92, days(8), 'main', true, heat(['write', 'edit', 'bash', 'write', 'edit', 'bash', 'write', 'bash'])),
    makeSession('demo-13', 'Rollup summarization engine', 'Nightly AI rollups from git activity — markdown output, frontmatter, decision extraction', 29, 44, 0.71, days(10), 'main', false, heat(['edit', 'read', 'bash', 'edit', 'write', 'bash'])),
    makeSession('demo-14', 'Open source licensing review', 'MIT vs Apache 2.0, contributor agreements, monetization compatibility', 8, 3, 0.09, days(12), 'main', false, heat(['chat', 'read', 'chat'])),
  ]

  // Zones — nicely laid out
  const GAP = 40
  const ZONE_W = 3 * (TILE_W + 10) - 10 + 32 // 3 cols of tiles + padding

  const zones: ZoneState[] = [
    // Row 1: Active work
    { id: 'demo-zone-active', label: 'Active Sprint', x: 0, y: 0, color: ZONE_COLORS[0] },
    { id: 'demo-zone-research', label: 'Research', x: snap(ZONE_W + GAP * 2), y: 0, color: ZONE_COLORS[2] },

    // Row 2: Infra + Archive
    { id: 'demo-zone-infra', label: 'Infrastructure', x: 0, y: snap(4 * (TILE_H + 10) + 80), color: ZONE_COLORS[1] },
    { id: 'demo-zone-archive', label: 'Archive', x: snap(ZONE_W + GAP * 2), y: snap(4 * (TILE_H + 10) + 80), color: ZONE_COLORS[5] },

    // Sub-zone inside Research
    { id: 'demo-zone-agents', label: 'Agent Design', x: snap(ZONE_W + GAP * 2 + 16), y: snap(2 * (TILE_H + 10) + 60), color: ZONE_COLORS[3], parentZoneId: 'demo-zone-research' },
  ]

  const tiles: TileState[] = [
    // Active Sprint
    { sessionId: 'demo-1', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-active' },
    { sessionId: 'demo-2', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-active' },
    { sessionId: 'demo-3', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-active' },
    { sessionId: 'demo-4', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-active' },

    // Research
    { sessionId: 'demo-5', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-research' },
    { sessionId: 'demo-6', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-research' },
    { sessionId: 'demo-7', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-research' },

    // Agent Design (sub-zone of Research)
    { sessionId: 'demo-8', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-agents' },

    // Infrastructure
    { sessionId: 'demo-9', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-infra' },
    { sessionId: 'demo-10', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-infra' },
    { sessionId: 'demo-11', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-infra' },

    // Archive
    { sessionId: 'demo-12', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-archive' },
    { sessionId: 'demo-13', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-archive' },
    { sessionId: 'demo-14', x: 0, y: 0, width: TILE_W, height: TILE_H, zoneId: 'demo-zone-archive' },
  ]

  return { zones, tiles, sessions: demoSessions }
}

// --- Main Sessions View ---

export function SessionsView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const [mode, setMode] = useState<SessionsMode>('canvas')
  const [fullscreen, setFullscreen] = useState(false)
  const [demoSessions, setDemoSessions] = useState<SessionSummary[]>([])

  // Escape exits fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [fullscreen])

  // Always fetch sessions (needed for both modes)
  const { sessions: realSessions, indexStatus, loading, error, refetch } = useSessions(activeProject)

  // Merge real + demo sessions
  const sessions = useMemo(() => {
    if (demoSessions.length === 0) return realSessions
    const realIds = new Set(realSessions.map(s => s.id))
    return [...realSessions, ...demoSessions.filter(d => !realIds.has(d.id))]
  }, [realSessions, demoSessions])

  // Canvas state — only fetches layout when in canvas mode
  const canvasState = useCanvasState(mode === 'canvas' ? activeProject : null)

  // Demo mode toggle
  const populateDemo = useCallback(() => {
    const { zones, tiles, sessions: fakeSessions } = generateDemoData()
    // Merge into existing canvas state
    canvasState.dispatchZones({ type: 'SET_ALL', zones: [...canvasState.zones, ...zones] })
    canvasState.dispatchTiles({ type: 'SET_ALL', tiles: [...canvasState.tiles, ...tiles] })
    setDemoSessions(fakeSessions)
  }, [canvasState])

  const clearDemo = useCallback(() => {
    // Remove demo zones and tiles
    const cleanZones = canvasState.zones.filter(z => !z.id.startsWith('demo-'))
    const cleanTiles = canvasState.tiles.filter(t => !t.sessionId.startsWith('demo-'))
    canvasState.dispatchZones({ type: 'SET_ALL', zones: cleanZones })
    canvasState.dispatchTiles({ type: 'SET_ALL', tiles: cleanTiles })
    setDemoSessions([])
  }, [canvasState])

  // Register demo debug action (only for dev mode)
  const hasDemoData = demoSessions.length > 0
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const id = 'demo-canvas'
    useDebugStore.getState().register({
      id,
      label: 'Demo Canvas Data',
      active: hasDemoData,
      toggle: () => {
        if (hasDemoData) clearDemo()
        else populateDemo()
      },
    })
    return () => useDebugStore.getState().unregister(id)
  }, [hasDemoData, populateDemo, clearDemo])

  return (
    <div className="flex h-full">
      {/* Zone tree sidebar — canvas mode only, hidden in fullscreen */}
      {mode === 'canvas' && activeProject && !fullscreen && (
        <div className="hidden sm:block w-56 shrink-0 border-r border-ax-border bg-ax-elevated overflow-hidden">
          <ZoneTree
            sessions={sessions}
            tiles={canvasState.tiles}
            zones={canvasState.zones}
            createZone={() => canvasState.createZone()}
            renameZone={canvasState.renameZone}
            deleteZone={canvasState.deleteZone}
            assignTileZone={canvasState.assignTileZone}
            addTile={canvasState.addTile}
            removeTile={canvasState.removeTile}
          />
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar with mode toggle — hidden in fullscreen */}
        {fullscreen ? (
          <button
            onClick={() => setFullscreen(false)}
            className="absolute top-3 right-3 z-20 p-2 bg-ax-elevated/80 backdrop-blur-sm border border-ax-border-subtle rounded-lg
              text-ax-text-tertiary hover:text-ax-text-primary transition-colors shadow-sm"
            aria-label="Exit fullscreen"
          >
            <Minimize size={14} />
          </button>
        ) : null}
        <div className={`shrink-0 flex items-center gap-2 px-4 py-1 border-b border-ax-border-subtle bg-ax-base ${fullscreen ? 'hidden' : ''}`}>
          <div className="flex items-center gap-0.5 bg-ax-sunken rounded-md p-0.5">
            <button
              onClick={() => setMode('canvas')}
              className={`flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] rounded transition-colors
                ${mode === 'canvas'
                  ? 'bg-ax-elevated text-ax-text-primary shadow-sm'
                  : 'text-ax-text-tertiary hover:text-ax-text-secondary'
                }`}
            >
              <LayoutGrid size={10} />
              Canvas
            </button>
            <button
              onClick={() => setMode('list')}
              className={`flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] rounded transition-colors
                ${mode === 'list'
                  ? 'bg-ax-elevated text-ax-text-primary shadow-sm'
                  : 'text-ax-text-tertiary hover:text-ax-text-secondary'
                }`}
            >
              <List size={10} />
              List
            </button>
          </div>
          <h1 className="font-serif italic text-[16px] text-ax-text-primary">
            Sessions
          </h1>
          {activeProject && (
            <span className="font-mono text-[10px] text-ax-text-tertiary truncate max-w-[140px]">
              {activeProject}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[10px] text-ax-text-ghost">
              {sessions.length}
            </span>
            {mode === 'canvas' && (
              <button
                onClick={() => setFullscreen(true)}
                className="p-1 text-ax-text-ghost hover:text-ax-text-primary transition-colors"
                aria-label="Fullscreen canvas"
                title="Fullscreen canvas"
              >
                <Maximize size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {mode === 'canvas' ? (
          activeProject && canvasState.loaded ? (
            <CanvasView
              sessions={sessions}
              tiles={canvasState.tiles}
              zones={canvasState.zones}
              viewport={canvasState.viewport}
              zoneLayouts={canvasState.zoneLayouts}
              tilePositionMap={canvasState.tilePositionMap}
              dispatchTiles={canvasState.dispatchTiles}
              dispatchZones={canvasState.dispatchZones}
              setViewport={canvasState.setViewport}
              scheduleSave={canvasState.scheduleSave}
              immediateSave={canvasState.immediateSave}
              reorgActive={canvasState.reorgActive}
              onReorganize={() => canvasState.reorganize(sessions)}
              onReorgApply={canvasState.applyReorg}
              onReorgCancel={canvasState.cancelReorg}
              onOpenSession={(id) => useUIStore.getState().openTerminal(id)}
              onRemoveTile={canvasState.removeTile}
              onSessionRenamed={refetch}
              onAddTile={canvasState.addTile}
              onAssignTileZone={canvasState.assignTileZone}
              activeProject={activeProject}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <LayoutGrid size={20} className="text-ax-text-ghost mx-auto mb-2" />
                <p className="text-micro text-ax-text-tertiary">
                  {activeProject ? 'Loading canvas...' : 'Select a project to view sessions.'}
                </p>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-8 py-10">
              <SessionList
                sessions={sessions}
                indexStatus={indexStatus}
                loading={loading}
                error={error}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
