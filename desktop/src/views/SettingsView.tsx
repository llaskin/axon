import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Loader2, Clock, Zap, Eye, FileText, Terminal, Search, X } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { useBackend } from '@/providers/DataProvider'
import { formatDate } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { PreflightCheck } from '@/components/shared/PreflightCheck'

// ─── Types ───────────────────────────────────────────────────────

interface ProjectConfig {
  project: string
  projectPath: string
  createdAt: string
  status: string
  timezone: string
  userContext: string
  dendrites: Record<string, { enabled: boolean; maxCommits?: number }>
  rollup: { autoCollect: boolean; contextWindow: number; model: string }
}

interface JobItem {
  id: number
  type: string
  status: string
  error?: string
  started_at: string
  finished_at?: string
  duration_s?: number
  cost?: number
  episode?: string
  meta?: Record<string, unknown>
}

interface JobSummaryData {
  total: number
  success: number
  failed: number
  running: number
  total_cost: number
  avg_duration_s: number
  last_run?: JobItem
}

interface CronStatus {
  installed: boolean
  loaded: boolean
  hour?: number
  minute?: number
  schedule?: string
}

// ─── Helpers ─────────────────────────────────────────────────────

function parseConfig(content: string): ProjectConfig {
  const defaults: ProjectConfig = {
    project: '',
    projectPath: '',
    createdAt: '',
    status: 'active',
    timezone: '',
    userContext: '',
    dendrites: {},
    rollup: { autoCollect: true, contextWindow: 10, model: 'claude-opus-4-6' },
  }
  if (!content) return defaults

  try {
    const raw = parseYaml(content) as Record<string, unknown>
    defaults.project = String(raw.project || '')
    defaults.projectPath = String(raw.project_path || '')
    defaults.createdAt = String(raw.created_at || '')
    defaults.status = String(raw.status || 'active')
    defaults.timezone = String(raw.timezone || '')
    defaults.userContext = String(raw.user_context || '')

    if (raw.dendrites && typeof raw.dendrites === 'object') {
      for (const [key, val] of Object.entries(raw.dendrites as Record<string, Record<string, unknown>>)) {
        defaults.dendrites[key] = {
          enabled: (val as Record<string, unknown>).enabled === true,
          ...(typeof (val as Record<string, unknown>).max_commits === 'number'
            ? { maxCommits: (val as Record<string, unknown>).max_commits as number }
            : {}),
        }
      }
    }

    if (raw.rollup && typeof raw.rollup === 'object') {
      const r = raw.rollup as Record<string, unknown>
      if (typeof r.auto_collect === 'boolean') defaults.rollup.autoCollect = r.auto_collect
      if (typeof r.context_window === 'number') defaults.rollup.contextWindow = r.context_window
      if (typeof r.model === 'string') defaults.rollup.model = r.model
    }
  } catch {
    // Fall back to defaults on parse error
  }

  return defaults
}

async function patchConfig(project: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error('Failed to update config')
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`
}

function formatJobTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffHrs = diffMs / (1000 * 60 * 60)

  if (diffHrs < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffHrs < 168) return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

// ─── Shared Components ───────────────────────────────────────────

function Card({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ax-elevated rounded-xl border border-ax-border p-4 ${className}`}>
      {title && <h3 className="font-mono text-[10px] uppercase tracking-[0.15em] text-ax-text-tertiary mb-2.5">{title}</h3>}
      {children}
    </div>
  )
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        enabled ? 'bg-ax-success' : 'bg-ax-sunken'
      }`}
    >
      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
        enabled ? 'translate-x-[16px]' : 'translate-x-[3px]'
      }`} />
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[13px] text-ax-text-tertiary">{label}</span>
      {children}
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const cls = status === 'active' ? 'bg-ax-success' : status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
  return <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />
}

function JobStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success': return <CheckCircle2 size={13} className="text-ax-success" />
    case 'failed': return <XCircle size={13} className="text-ax-error" />
    case 'running': return <Loader2 size={13} className="text-ax-brand-primary animate-spin" />
    default: return <Clock size={13} className="text-ax-text-tertiary" />
  }
}

// ─── Live Feed Panel ─────────────────────────────────────────────

interface FeedEvent {
  kind: string
  id: string
  text?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  content?: string
  isError?: boolean
  status?: string
}

function LiveFeedPanel({ project, jobId, onClose }: { project: string; jobId: number; onClose: () => void }) {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [done, setDone] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller

    const connect = async () => {
      try {
        const res = await fetch(
          `/api/axon/projects/${encodeURIComponent(project)}/jobs/${jobId}/watch`,
          { signal: controller.signal }
        )
        if (!res.ok || !res.body) return
        setConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done: streamDone, value } = await reader.read()
          if (streamDone) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const evt = JSON.parse(line.slice(6)) as FeedEvent
              if (evt.kind === 'done') {
                setDone(true)
                continue
              }
              // Skip thinking and tool_result content (too verbose)
              if (evt.kind === 'thinking') continue
              setEvents(prev => [...prev.slice(-200), evt]) // keep last 200
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setDone(true)
        }
      }
    }

    connect()
    return () => {
      controller.abort()
      abortRef.current = null
    }
  }, [project, jobId])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  const toolIcon = (name: string) => {
    switch (name) {
      case 'Read': case 'Glob': case 'Grep': return <Search size={10} className="text-blue-400" />
      case 'Bash': return <Terminal size={10} className="text-green-400" />
      case 'Write': case 'Edit': return <FileText size={10} className="text-amber-400" />
      default: return <Zap size={10} className="text-ax-brand-primary" />
    }
  }

  const toolCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const evt of events) {
      if (evt.kind === 'tool_use' && evt.toolName) {
        counts[evt.toolName] = (counts[evt.toolName] || 0) + 1
      }
    }
    return counts
  }, [events])

  return (
    <div className="mt-3 bg-ax-base rounded-lg border border-ax-brand-primary/20 overflow-hidden animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-ax-brand-primary/8 border-b border-ax-brand-primary/15">
        <div className="flex items-center gap-2">
          {!done && <div className="w-1.5 h-1.5 rounded-full bg-ax-brand-primary animate-pulse" />}
          <span className="font-mono text-[10px] text-ax-text-secondary">
            {done ? 'Session complete' : connected ? 'Watching live' : 'Connecting...'}
          </span>
          {Object.keys(toolCounts).length > 0 && (
            <span className="font-mono text-[9px] text-ax-text-tertiary">
              {Object.values(toolCounts).reduce((a, b) => a + b, 0)} tools
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-0.5 rounded hover:bg-ax-sunken text-ax-text-tertiary hover:text-ax-text-secondary transition-colors">
          <X size={12} />
        </button>
      </div>

      {/* Tool summary bar */}
      {Object.keys(toolCounts).length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-ax-border-subtle/50 overflow-x-auto">
          {Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <span key={name} className="flex items-center gap-1 font-mono text-[9px] text-ax-text-tertiary whitespace-nowrap">
              {toolIcon(name)} {name} {count}
            </span>
          ))}
        </div>
      )}

      {/* Event feed */}
      <div ref={scrollRef} className="max-h-[200px] overflow-y-auto scrollbar-hide">
        {events.length === 0 && !done && (
          <div className="py-4 text-center">
            <Loader2 size={14} className="animate-spin text-ax-brand-primary mx-auto mb-1" />
            <p className="font-mono text-[10px] text-ax-text-tertiary">Waiting for events...</p>
          </div>
        )}
        {events.map((evt, i) => (
          <div key={`${evt.id}-${i}`} className="px-3 py-1 border-b border-ax-border-subtle/30 last:border-0 hover:bg-ax-sunken/50">
            {evt.kind === 'tool_use' && (
              <div className="flex items-center gap-1.5">
                {toolIcon(evt.toolName || '')}
                <span className="font-mono text-[10px] text-ax-text-primary font-medium">{evt.toolName}</span>
                <span className="font-mono text-[9px] text-ax-text-tertiary truncate flex-1">
                  {evt.toolInput?.file_path as string ||
                   evt.toolInput?.command as string ||
                   evt.toolInput?.pattern as string ||
                   ''}
                </span>
              </div>
            )}
            {evt.kind === 'tool_result' && (
              <div className={`font-mono text-[9px] truncate ${evt.isError ? 'text-ax-error' : 'text-ax-text-tertiary'}`}>
                {(evt.content || '').slice(0, 120)}
              </div>
            )}
            {evt.kind === 'text' && (
              <p className="font-mono text-[10px] text-ax-text-secondary truncate">{(evt.text || '').slice(0, 150)}</p>
            )}
            {evt.kind === 'result' && (
              <div className="flex items-center gap-2 font-mono text-[10px] text-ax-success">
                <CheckCircle2 size={10} /> Complete
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Rollups Panel (Right Column) ────────────────────────────────

function CronJobsPanel({ project }: { project: string }) {
  const [cron, setCron] = useState<CronStatus | null>(null)
  const [summary, setSummary] = useState<JobSummaryData | null>(null)
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [cronAction, setCronAction] = useState<'idle' | 'installing' | 'removing'>('idle')
  const [watchingJobId, setWatchingJobId] = useState<number | null>(null)

  const initialLoad = useRef(true)

  const loadData = useCallback(() => {
    // Only show skeleton on first load — subsequent refreshes update in-place
    if (initialLoad.current) setLoading(true)
    Promise.all([
      fetch(`/api/axon/projects/${encodeURIComponent(project)}/cron`).then(r => r.json()).catch(() => ({ installed: false, loaded: false })),
      fetch(`/api/axon/projects/${encodeURIComponent(project)}/jobs/summary`).then(r => r.json()).catch(() => null),
      fetch(`/api/axon/projects/${encodeURIComponent(project)}/jobs?limit=15`).then(r => r.json()).catch(() => ({ items: [] })),
    ]).then(([c, s, j]) => {
      setCron(c)
      setSummary(s)
      setJobs(j.items || [])
      setLoading(false)
      initialLoad.current = false
    })
  }, [project])

  useEffect(() => {
    initialLoad.current = true
    setWatchingJobId(null)
    loadData()
  }, [loadData])

  // Poll when a job is running
  useEffect(() => {
    if (!summary || summary.running <= 0) return
    const interval = setInterval(loadData, 5000)
    return () => clearInterval(interval)
  }, [summary?.running, loadData])

  // Auto-watch running jobs that have a session_id
  useEffect(() => {
    if (watchingJobId !== null) return
    const running = jobs.find(j => j.status === 'running' && j.meta?.session_id)
    if (running) setWatchingJobId(running.id)
  }, [jobs, watchingJobId])

  const handleCronToggle = async () => {
    const action = cron?.installed ? 'remove' : 'install'
    setCronAction(action === 'install' ? 'installing' : 'removing')
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, time: '02:00' }),
      })
      if (!res.ok) throw new Error('Failed')
      // Reload cron status
      const updated = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/cron`).then(r => r.json())
      setCron(updated)
    } catch {
      // Silent fail
    } finally {
      setCronAction('idle')
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-24 bg-ax-sunken rounded-xl" />
        <div className="h-48 bg-ax-sunken rounded-xl" />
      </div>
    )
  }

  const successRate = summary && summary.total > 0 ? Math.round((summary.success / summary.total) * 100) : null
  const hasJobs = summary && summary.total > 0
  const isRunning = summary && summary.running > 0
  const lastSuccess = jobs.find(j => j.status === 'success')
  // const lastFailure = jobs.find(j => j.status === 'failed')

  // Check if running job seems stale (>15 min)
  const runningJob = jobs.find(j => j.status === 'running')
  const runningElapsed = runningJob ? (Date.now() - new Date(runningJob.started_at).getTime()) / 1000 : 0
  const isStale = runningElapsed > 900 // 15 min

  return (
    <div className="animate-fade-in-up">
      <Card className="overflow-hidden">

        {/* ─ Header: Current State ─ */}
        <div className={`-mx-4 -mt-4 px-4 py-3 mb-4 ${
          isRunning
            ? 'bg-ax-brand-primary/8 border-b border-ax-brand-primary/15'
            : 'border-b border-ax-border-subtle'
        }`}>
          <div className="flex items-center gap-3">
            {isRunning ? (
              <>
                <div className="relative flex items-center justify-center w-7 h-7 shrink-0">
                  <div className={`absolute inset-0 rounded-full border-2 animate-spin ${
                    isStale ? 'border-ax-warning/25 border-t-ax-warning' : 'border-ax-brand-primary/25 border-t-ax-brand-primary'
                  }`} />
                  <Zap size={12} className={isStale ? 'text-ax-warning' : 'text-ax-brand-primary'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-ax-text-primary font-medium">
                    {isStale ? 'Rollup may be stale' : 'Rollup running'}
                  </div>
                  <div className="font-mono text-[10px] text-ax-text-tertiary">
                    {formatDuration(runningElapsed)} elapsed
                    {isStale && ' — will auto-timeout at 30m'}
                  </div>
                </div>
              </>
            ) : lastSuccess ? (
              <>
                <CheckCircle2 size={16} className="text-ax-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[13px] text-ax-text-primary">Last run succeeded</div>
                  <div className="font-mono text-[10px] text-ax-text-tertiary">
                    {formatJobTime(lastSuccess.started_at)}
                    {lastSuccess.duration_s != null && <> &middot; {formatDuration(lastSuccess.duration_s)}</>}
                    {lastSuccess.cost != null && <> &middot; ${lastSuccess.cost.toFixed(2)}</>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <Clock size={16} className="text-ax-text-tertiary shrink-0" />
                <div className="font-mono text-[13px] text-ax-text-tertiary">No rollups recorded yet</div>
              </>
            )}

            {/* Cron badge / toggle */}
            <button
              onClick={handleCronToggle}
              disabled={cronAction !== 'idle'}
              className={`font-mono text-[9px] px-1.5 py-0.5 rounded-full shrink-0 cursor-pointer transition-colors ${
                cronAction !== 'idle'
                  ? 'bg-ax-sunken text-ax-text-tertiary animate-pulse'
                  : cron?.installed && cron?.loaded
                    ? 'bg-ax-success/12 text-ax-success hover:bg-ax-success/20'
                    : cron?.installed
                      ? 'bg-ax-warning/12 text-ax-warning hover:bg-ax-warning/20'
                      : 'bg-ax-brand-primary/12 text-ax-brand-primary hover:bg-ax-brand-primary/20'
              }`}
              title={cron?.installed ? 'Click to remove cron schedule' : 'Click to enable nightly rollups at 02:00'}
            >
              {cronAction === 'installing' ? 'enabling...'
                : cronAction === 'removing' ? 'removing...'
                : cron?.installed ? `cron ${cron.schedule || ''}`
                : '+ enable cron'
              }
            </button>
          </div>
        </div>

        {/* ─ Stats Row (only when we have data) ─ */}
        {hasJobs && (
          <div className="grid grid-cols-4 gap-1.5 mb-4">
            <div className="bg-ax-sunken rounded-lg px-2 py-1.5 text-center">
              <div className="font-mono text-[14px] text-ax-text-primary">{summary.total}</div>
              <div className="font-mono text-[8px] uppercase tracking-widest text-ax-text-tertiary">Runs</div>
            </div>
            <div className="bg-ax-sunken rounded-lg px-2 py-1.5 text-center">
              <div className={`font-mono text-[14px] ${successRate != null && successRate >= 80 ? 'text-ax-success' : successRate != null && successRate >= 50 ? 'text-ax-warning' : 'text-ax-error'}`}>
                {successRate ?? 0}%
              </div>
              <div className="font-mono text-[8px] uppercase tracking-widest text-ax-text-tertiary">Pass</div>
            </div>
            <div className="bg-ax-sunken rounded-lg px-2 py-1.5 text-center">
              <div className="font-mono text-[14px] text-ax-text-primary">${summary.total_cost.toFixed(2)}</div>
              <div className="font-mono text-[8px] uppercase tracking-widest text-ax-text-tertiary">Cost</div>
            </div>
            <div className="bg-ax-sunken rounded-lg px-2 py-1.5 text-center">
              <div className="font-mono text-[14px] text-ax-text-primary">{formatDuration(summary.avg_duration_s)}</div>
              <div className="font-mono text-[8px] uppercase tracking-widest text-ax-text-tertiary">Avg</div>
            </div>
          </div>
        )}

        {/* ─ Not configured — enable button ─ */}
        {!cron?.installed && (
          <button
            onClick={handleCronToggle}
            disabled={cronAction !== 'idle'}
            className="w-full bg-ax-brand-primary/8 hover:bg-ax-brand-primary/15 border border-ax-brand-primary/20 rounded-lg px-3 py-2.5 mb-4 text-center transition-colors cursor-pointer disabled:opacity-50"
          >
            {cronAction === 'installing' ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={12} className="animate-spin text-ax-brand-primary" />
                <span className="font-mono text-[11px] text-ax-brand-primary">Enabling nightly rollups...</span>
              </span>
            ) : (
              <p className="font-mono text-[11px] text-ax-brand-primary">
                Enable nightly rollups at 02:00
              </p>
            )}
          </button>
        )}

        {/* ─ Run History ─ */}
        <h4 className="font-mono text-[9px] uppercase tracking-[0.15em] text-ax-text-tertiary mb-1.5">History</h4>
        {jobs.length > 0 ? (
          <div className="space-y-0">
            {jobs.map(job => (
              <div key={job.id} className={`flex items-center gap-2 py-1.5 border-b border-ax-border-subtle/50 last:border-0 ${
                job.status === 'running' ? 'bg-ax-brand-primary/5 -mx-1 px-1 rounded' : ''
              }`}>
                <JobStatusIcon status={job.status} />
                <span className={`font-mono text-[11px] flex-1 min-w-0 truncate ${
                  job.error === 'stale_timeout' ? 'text-ax-warning' : 'text-ax-text-primary'
                }`}>
                  {job.status === 'running' ? 'Running...'
                    : job.error === 'stale_timeout' ? 'Timed out (stale)'
                    : job.error === 'process_killed' ? 'Process killed'
                    : job.episode || job.error || job.type}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(job.meta?.session_id as string) && (
                    <button
                      onClick={() => setWatchingJobId(watchingJobId === job.id ? null : job.id)}
                      className={`p-0.5 rounded transition-colors ${
                        watchingJobId === job.id
                          ? 'text-ax-brand-primary bg-ax-brand-primary/10'
                          : 'text-ax-text-tertiary hover:text-ax-brand-primary'
                      }`}
                      title={watchingJobId === job.id ? 'Close live feed' : 'Watch session'}
                    >
                      <Eye size={11} />
                    </button>
                  )}
                  {job.cost != null && (
                    <span className="font-mono text-[9px] text-ax-text-tertiary">${job.cost.toFixed(2)}</span>
                  )}
                  {job.duration_s != null && (
                    <span className="font-mono text-[9px] text-ax-text-tertiary">{formatDuration(job.duration_s)}</span>
                  )}
                  <span className="font-mono text-[9px] text-ax-text-tertiary/60">{formatJobTime(job.started_at)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-ax-text-tertiary/60 italic py-3 text-center">Runs appear here after rollups execute</p>
        )}

        {/* Live Feed Panel */}
        {watchingJobId && (
          <LiveFeedPanel
            project={project}
            jobId={watchingJobId}
            onClose={() => setWatchingJobId(null)}
          />
        )}

      </Card>
    </div>
  )
}

// ─── Main Settings View ──────────────────────────────────────────

function SystemHealthButton() {
  const [showPreflight, setShowPreflight] = useState(false)

  return (
    <>
      <Card title="System" className="animate-fade-in-up">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] text-ax-text-primary">System Health</p>
            <p className="text-[10px] text-ax-text-tertiary">Check prerequisites</p>
          </div>
          <button
            onClick={() => setShowPreflight(true)}
            className="flex items-center gap-1.5 font-mono text-[10px] px-2.5 py-1 rounded-lg bg-ax-sunken text-ax-text-secondary border border-ax-border-subtle hover:bg-ax-sunken/80 transition-colors"
          >
            <Terminal size={11} />
            Run check
          </button>
        </div>
      </Card>
      {showPreflight && (
        <PreflightCheck forceVisible onDismiss={() => setShowPreflight(false)} />
      )}
    </>
  )
}

export function SettingsView() {
  const { projects, activeProject, setProjects, setActiveProject } = useProjectStore()
  const setView = useUIStore(s => s.setView)
  const backend = useBackend()
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [showRemoveDialog, setShowRemoveDialog] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedProject, _setSelectedProject] = useState<string | null>(activeProject)

  // Wrap setter to also update the sidebar's active project
  const setSelectedProject = useCallback((name: string | null) => {
    _setSelectedProject(name)
    if (name) setActiveProject(name)
  }, [setActiveProject])

  // Sync when sidebar changes active project externally
  useEffect(() => {
    _setSelectedProject(activeProject)
  }, [activeProject])

  const [contextDraft, setContextDraft] = useState('')
  const [contextSaving, setContextSaving] = useState(false)
  const contextLoaded = useRef(false)

  const loadConfig = useCallback(() => {
    if (!selectedProject) {
      setConfig(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    backend.getConfig(selectedProject)
      .then(content => {
        const parsed = parseConfig(content)
        setConfig(parsed)
        if (!contextLoaded.current) {
          setContextDraft(parsed.userContext)
          contextLoaded.current = true
        }
        setLoading(false)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load config')
        setLoading(false)
      })
  }, [selectedProject, backend])

  useEffect(() => {
    contextLoaded.current = false
    loadConfig()
  }, [selectedProject, loadConfig])

  const handleDendriteToggle = async (name: string, enabled: boolean) => {
    if (!config || !selectedProject) return
    const prev = { ...config.dendrites[name] }
    setConfig({ ...config, dendrites: { ...config.dendrites, [name]: { ...prev, enabled } } })
    try {
      await patchConfig(selectedProject, { dendrites: { [name]: { enabled } } })
    } catch {
      setConfig(c => c ? { ...c, dendrites: { ...c.dendrites, [name]: prev } } : c)
    }
  }

  const handleAutoCollectToggle = async (enabled: boolean) => {
    if (!config || !selectedProject) return
    const prev = config.rollup.autoCollect
    setConfig({ ...config, rollup: { ...config.rollup, autoCollect: enabled } })
    try {
      await patchConfig(selectedProject, { rollup: { auto_collect: enabled } })
    } catch {
      setConfig(c => c ? { ...c, rollup: { ...c.rollup, autoCollect: prev } } : c)
    }
  }

  const handleContextWindowChange = async (value: number) => {
    if (!config || !selectedProject) return
    const prev = config.rollup.contextWindow
    setConfig({ ...config, rollup: { ...config.rollup, contextWindow: value } })
    try {
      await patchConfig(selectedProject, { rollup: { context_window: value } })
    } catch {
      setConfig(c => c ? { ...c, rollup: { ...c.rollup, contextWindow: prev } } : c)
    }
  }

  const handleStatusChange = async (status: string) => {
    if (!config || !selectedProject) return
    const prev = config.status
    setConfig({ ...config, status })
    try {
      await patchConfig(selectedProject, { status })
      const updated = await backend.getProjects()
      setProjects(updated)
    } catch {
      setConfig(c => c ? { ...c, status: prev } : c)
    }
  }

  const handleContextSave = async () => {
    if (!selectedProject) return
    setContextSaving(true)
    try {
      const value = contextDraft.trim()
      await patchConfig(selectedProject, { user_context: value || null })
      setConfig(c => c ? { ...c, userContext: value } : c)
    } catch {
      // Silent fail — user can retry
    } finally {
      setContextSaving(false)
    }
  }

  const selectedProjectData = projects.find(p => p.name === selectedProject)
  const handleRemoveProject = async (mode: string) => {
    if (!selectedProject) return
    setShowRemoveDialog(false)
    try {
      await fetch(`/api/axon/projects/${encodeURIComponent(selectedProject)}?mode=${mode}`, { method: 'DELETE' })
      const updated = await backend.getProjects()
      setProjects(updated)
      const remaining = updated.filter(p => p.status === 'active')
      if (selectedProject === activeProject) {
        if (remaining.length > 0) {
          setActiveProject(remaining[0].name)
        } else {
          setView('onboarding')
        }
      }
      setSelectedProject(remaining[0]?.name ?? null)
    } catch {
      // Silent fail
    }
  }

  const visibleProjects = useMemo(() => projects.filter(p => p.status !== 'archived'), [projects])
  const selectedIdx = visibleProjects.findIndex(p => p.name === selectedProject)
  const pillsRef = useRef<HTMLDivElement>(null)
  const [pillOffsets, setPillOffsets] = useState<{ left: string; width: string } | null>(null)

  const measurePill = useCallback(() => {
    if (!pillsRef.current || !selectedProject) return
    const container = pillsRef.current
    const pill = container.querySelector(`[data-project="${CSS.escape(selectedProject)}"]`) as HTMLElement | null
    if (!pill) return
    const containerRect = container.getBoundingClientRect()
    const pillRect = pill.getBoundingClientRect()
    setPillOffsets({
      left: `${pillRect.left - containerRect.left + container.scrollLeft}px`,
      width: `${pillRect.width}px`,
    })
    pill.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedProject])

  // Measure immediately on layout, then again after fonts settle
  useLayoutEffect(() => {
    measurePill()
    // Re-measure after fonts load (fixes first-render misalignment)
    const frame = requestAnimationFrame(() => measurePill())
    const timer = setTimeout(() => measurePill(), 100)
    return () => { cancelAnimationFrame(frame); clearTimeout(timer) }
  }, [selectedProject, visibleProjects, measurePill])

  // Re-measure if container resizes (font load, window resize)
  useEffect(() => {
    if (!pillsRef.current) return
    const observer = new ResizeObserver(() => measurePill())
    observer.observe(pillsRef.current)
    return () => observer.disconnect()
  }, [measurePill])

  const navigateProject = useCallback((dir: -1 | 1) => {
    const idx = selectedIdx + dir
    if (idx >= 0 && idx < visibleProjects.length) setSelectedProject(visibleProjects[idx].name)
  }, [selectedIdx, visibleProjects])

  const contextDirty = config ? contextDraft.trim() !== (config.userContext || '') : false

  // ─── Header ──────────────────────────────────────────────────

  const header = (
    <header className="mb-5">
      <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
        Settings
      </h1>

      {visibleProjects.length > 1 && (
        <div className="flex items-center gap-1.5 mt-2.5">
          <button
            onClick={() => navigateProject(-1)}
            disabled={selectedIdx <= 0}
            aria-label="Previous project"
            className="p-1 rounded text-ax-text-tertiary hover:text-ax-text-secondary hover:bg-ax-sunken transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
          >
            <ChevronLeft size={14} />
          </button>
          <div ref={pillsRef} className="relative flex items-center gap-0 overflow-x-auto scrollbar-hide rounded-lg bg-ax-sunken p-0.5">
            {pillOffsets && (
              <div
                className="absolute top-0.5 bottom-0.5 rounded-md bg-ax-elevated shadow-sm border border-ax-border-subtle transition-[left,width] duration-200 ease-out"
                style={{ left: pillOffsets.left, width: pillOffsets.width }}
              />
            )}
            {visibleProjects.map(p => (
              <button
                key={p.name}
                data-project={p.name}
                onClick={() => setSelectedProject(p.name)}
                className={`relative z-[1] font-mono text-[11px] px-2.5 py-1 rounded-md whitespace-nowrap transition-colors duration-150
                  ${selectedProject === p.name
                    ? 'text-ax-text-primary'
                    : 'text-ax-text-tertiary hover:text-ax-text-secondary'
                  }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button
            onClick={() => navigateProject(1)}
            disabled={selectedIdx >= visibleProjects.length - 1}
            aria-label="Next project"
            className="p-1 rounded text-ax-text-tertiary hover:text-ax-text-secondary hover:bg-ax-sunken transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </header>
  )

  // ─── Loading / Error / Empty ─────────────────────────────────

  if (loading) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-5">
          <div className="space-y-4 animate-pulse">
            {[0, 1, 2].map(i => <div key={i} className="h-28 bg-ax-sunken rounded-xl" />)}
          </div>
          <div className="space-y-4 animate-pulse">
            {[0, 1].map(i => <div key={i} className="h-28 bg-ax-sunken rounded-xl" />)}
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        <div className="text-center py-16">
          <p className="font-serif italic text-h3 text-ax-error mb-2">Error</p>
          <p className="text-body text-ax-text-secondary">{error}</p>
        </div>
      </div>
    )
  }

  if (!config || !selectedProject) {
    return (
      <div>
        {header}
        <div className="text-center py-16">
          <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No project selected</p>
          <p className="text-body text-ax-text-tertiary">Select a project to view its settings</p>
        </div>
      </div>
    )
  }

  // ─── Main Layout ─────────────────────────────────────────────

  return (
    <div>
      {header}

      <div key={selectedProject} className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-5 items-start">

        {/* ─── Left Column: Configuration ─── */}
        <div className="space-y-4">

          {/* Project + Stats combined */}
          <Card className="animate-fade-in-up">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h2 className="font-mono text-[15px] text-ax-text-primary font-medium">{config.project}</h2>
                <p className="font-mono text-[11px] text-ax-text-tertiary truncate max-w-[280px]">{config.projectPath}</p>
              </div>
              <select
                value={config.status}
                onChange={e => handleStatusChange(e.target.value)}
                className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-ax-sunken text-ax-text-primary border-none outline-none cursor-pointer appearance-none"
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="archived">archived</option>
              </select>
            </div>

            {/* Inline stats */}
            {selectedProjectData && (
              <div className="flex gap-4 pt-2 border-t border-ax-border-subtle">
                <div>
                  <span className="font-mono text-[15px] text-ax-text-primary">{selectedProjectData.episodeCount}</span>
                  <span className="font-mono text-[10px] text-ax-text-tertiary ml-1.5">episodes</span>
                </div>
                <div>
                  <span className="font-mono text-[15px] text-ax-text-primary">{selectedProjectData.openLoopCount}</span>
                  <span className="font-mono text-[10px] text-ax-text-tertiary ml-1.5">open loops</span>
                </div>
                <div className="ml-auto">
                  <span className="font-mono text-[10px] text-ax-text-tertiary">last rollup </span>
                  <span className="font-mono text-[12px] text-ax-text-secondary">
                    {selectedProjectData.lastRollup ? formatDate(selectedProjectData.lastRollup) : '—'}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Dendrites + Rollup side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Dendrites */}
            <Card title="Dendrites" className="animate-fade-in-up">
              <div className="space-y-0">
                {Object.entries(config.dendrites).map(([name, settings]) => (
                  <div key={name} className="flex items-center justify-between py-1.5 border-b border-ax-border-subtle last:border-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full transition-colors ${settings.enabled ? 'bg-ax-success' : 'bg-ax-text-tertiary/40'}`} />
                      <span className="font-mono text-[12px] text-ax-text-primary">{name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {settings.maxCommits && (
                        <span className="font-mono text-[10px] text-ax-text-tertiary">max {settings.maxCommits}</span>
                      )}
                      <Toggle enabled={settings.enabled} onChange={v => handleDendriteToggle(name, v)} />
                    </div>
                  </div>
                ))}
                {Object.keys(config.dendrites).length === 0 && (
                  <p className="text-[12px] text-ax-text-tertiary italic py-1">No dendrite config</p>
                )}
              </div>
            </Card>

            {/* Rollup Config */}
            <Card title="Rollup" className="animate-fade-in-up">
              <div className="space-y-0">
                <Row label="Auto Collect">
                  <Toggle enabled={config.rollup.autoCollect} onChange={handleAutoCollectToggle} />
                </Row>
                <Row label="Context Window">
                  <select
                    value={config.rollup.contextWindow}
                    onChange={e => handleContextWindowChange(parseInt(e.target.value))}
                    className="font-mono text-[12px] px-1.5 py-0.5 rounded bg-ax-sunken text-ax-text-primary border-none outline-none cursor-pointer"
                  >
                    {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => (
                      <option key={n} value={n}>{n} episodes</option>
                    ))}
                  </select>
                </Row>
                <Row label="Model">
                  <span className="font-mono text-[12px] text-ax-text-secondary">{config.rollup.model}</span>
                </Row>
                <Row label="Created">
                  <span className="text-[12px] text-ax-text-secondary">{config.createdAt ? formatDate(config.createdAt.split('T')[0]) : '—'}</span>
                </Row>
                <Row label="Timezone">
                  <span className="font-mono text-[12px] text-ax-text-secondary">{config.timezone || '—'}</span>
                </Row>
              </div>
            </Card>
          </div>

          {/* User Context */}
          <Card title="User Context" className="animate-fade-in-up">
            <p className="text-[11px] text-ax-text-tertiary mb-2">
              Describe your role — injected into rollups and briefings
            </p>
            <textarea
              value={contextDraft}
              onChange={e => setContextDraft(e.target.value)}
              placeholder="e.g. I'm the lead on the frontend, focused on React components..."
              rows={2}
              className="w-full bg-ax-sunken rounded-lg border border-ax-border-subtle px-3 py-2 text-[12px] text-ax-text-primary placeholder:text-ax-text-tertiary/50 resize-none outline-none focus:border-ax-brand-primary transition-colors font-mono"
            />
            {contextDirty && (
              <div className="flex justify-end mt-1.5">
                <button
                  onClick={handleContextSave}
                  disabled={contextSaving}
                  className="font-mono text-[10px] px-3 py-1 rounded-full bg-ax-brand-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {contextSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </Card>

          {/* All Projects + Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="All Projects" className="animate-fade-in-up">
              <div className="space-y-0">
                {projects.map(p => (
                  <div key={p.name} className="flex items-center justify-between py-1.5 border-b border-ax-border-subtle last:border-0">
                    <div className="flex items-center gap-2">
                      <StatusDot status={p.status} />
                      <span className={`font-mono text-[12px] ${
                        p.name === selectedProject ? 'text-ax-text-primary font-medium' : 'text-ax-text-secondary'
                      }`}>{p.name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-ax-text-tertiary">{p.episodeCount} ep</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Project Actions" className="animate-fade-in-up">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-ax-text-primary">Archive</p>
                    <p className="text-[10px] text-ax-text-tertiary">Hide, keep data</p>
                  </div>
                  <button
                    onClick={() => handleRemoveProject('archive')}
                    className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-ax-sunken text-ax-text-secondary border border-ax-border-subtle hover:bg-ax-sunken/80 transition-colors"
                  >
                    Archive
                  </button>
                </div>
                <div className="border-t border-ax-border-subtle" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-ax-error">Delete</p>
                    <p className="text-[10px] text-ax-text-tertiary">Remove all data</p>
                  </div>
                  <button
                    onClick={() => setShowRemoveDialog(true)}
                    className="font-mono text-[10px] px-2.5 py-1 rounded-lg bg-ax-error/10 text-ax-error border border-ax-error/20 hover:bg-ax-error/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* ─── Right Column: Cron + Jobs + System Health ─── */}
        <div className="lg:sticky lg:top-0 space-y-4">
          <CronJobsPanel project={selectedProject} />
          <SystemHealthButton />
        </div>

      </div>

      {showRemoveDialog && (
        <ConfirmDialog
          title={`Delete ${selectedProject}?`}
          message="This will permanently remove all Axon data for this project — rollups, state, dendrites, and todos. This cannot be undone."
          options={[
            { label: 'Delete everything', value: 'delete', variant: 'danger' },
          ]}
          onSelect={handleRemoveProject}
          onCancel={() => setShowRemoveDialog(false)}
        />
      )}
    </div>
  )
}
