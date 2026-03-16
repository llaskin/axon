import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '@/store/projectStore'
import { GitBranch, ArrowUp, ArrowDown, ChevronDown, Loader2, Check, AlertTriangle, Copy, GitCommit, Tag, Rocket } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface GitInfo {
  branch: string
  shortSha: string
  isDetached: boolean
  remote: string
  hasUpstream: boolean
  ahead: number
  behind: number
  error?: string
}

interface GitCommitEntry {
  hash: string
  short: string
  message: string
  author: string
  date: string
}

interface GitBranchEntry {
  name: string
  isCurrent: boolean
  upstream: string
  shortSha: string
}

interface GitTag {
  name: string
  shortSha: string
  date: string
  message: string
}

// ─── Helpers ─────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
  })
}

// ─── Data Hook ───────────────────────────────────────────────────

function useGitData(project: string | null) {
  const [info, setInfo] = useState<GitInfo | null>(null)
  const [commits, setCommits] = useState<GitCommitEntry[]>([])
  const [branches, setBranches] = useState<GitBranchEntry[]>([])
  const [tags, setTags] = useState<GitTag[]>([])
  const [loading, setLoading] = useState(true)

  const fetchInfo = useCallback(async () => {
    if (!project) { setInfo(null); return }
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/git/info`)
      setInfo(await res.json())
    } catch { setInfo(null) }
  }, [project])

  const fetchLog = useCallback(async () => {
    if (!project) { setCommits([]); return }
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/git/log?limit=50`)
      const data = await res.json()
      setCommits(data.commits || [])
    } catch { setCommits([]) }
  }, [project])

  const fetchBranches = useCallback(async () => {
    if (!project) { setBranches([]); return }
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/git/branches`)
      const data = await res.json()
      setBranches(data.branches || [])
    } catch { setBranches([]) }
  }, [project])

  const fetchTags = useCallback(async () => {
    if (!project) { setTags([]); return }
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/git/tags`)
      const data = await res.json()
      setTags(data.tags || [])
    } catch { setTags([]) }
  }, [project])

  const refresh = useCallback(async () => {
    await Promise.all([fetchInfo(), fetchLog(), fetchTags()])
  }, [fetchInfo, fetchLog, fetchTags])

  // Initial load
  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [refresh])

  // Poll info every 10s (lightweight)
  useEffect(() => {
    const interval = setInterval(fetchInfo, 10000)
    return () => clearInterval(interval)
  }, [fetchInfo])

  // Refresh on window focus
  useEffect(() => {
    const handler = () => refresh()
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [refresh])

  return { info, commits, branches, tags, loading, refresh, fetchBranches }
}

// ─── Action Toast ────────────────────────────────────────────────

function ActionToast({ message, ok }: { message: string; ok: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border-l-3
      ${ok
        ? 'bg-[var(--ax-success)]/10 border-l-[var(--ax-success)] text-ax-text-primary'
        : 'bg-[var(--ax-error)]/10 border-l-[var(--ax-error)] text-ax-text-primary'
      }
      animate-fade-in`}
    >
      {ok
        ? <Check size={14} className="text-[var(--ax-success)] shrink-0" />
        : <AlertTriangle size={14} className="text-[var(--ax-error)] shrink-0" />
      }
      <span className="text-small font-mono truncate">{message}</span>
    </div>
  )
}

// ─── Branch Switcher Popover ─────────────────────────────────────

function BranchSwitcher({
  branches, current, project, onSwitch, onClose,
}: {
  branches: GitBranchEntry[]
  current: string
  project: string
  onSwitch: (result: { ok: boolean; message: string }) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = branches.filter(b =>
    b.name.toLowerCase().includes(filter.toLowerCase())
  )

  const handleSwitch = async (branch: string) => {
    if (branch === current) return
    setSwitching(branch)
    setError(null)
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(project)}/git/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      })
      const result = await res.json()
      if (result.ok) {
        onSwitch(result)
        onClose()
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setSwitching(null)
    }
  }

  return (
    <div ref={ref} className="absolute top-full left-0 mt-1 z-50
      bg-ax-elevated border border-ax-border rounded-xl shadow-lg
      w-64 overflow-hidden animate-fade-in"
    >
      <div className="p-2 border-b border-ax-border-subtle">
        <input
          autoFocus
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter branches..."
          className="w-full bg-ax-sunken text-small text-ax-text-primary
            px-2.5 py-1.5 rounded-lg border border-ax-border-subtle
            outline-none focus:border-ax-brand
            placeholder:text-ax-text-ghost font-mono"
        />
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.map(b => (
          <button
            key={b.name}
            onClick={() => handleSwitch(b.name)}
            disabled={!!switching}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left
              transition-colors text-small font-mono
              ${b.isCurrent
                ? 'text-ax-brand font-medium'
                : 'text-ax-text-primary hover:bg-ax-sunken'
              }
              ${switching === b.name ? 'opacity-50' : ''}
            `}
          >
            {b.isCurrent
              ? <div className="w-2 h-2 rounded-full bg-ax-brand shrink-0" />
              : <div className="w-2 h-2 shrink-0" />
            }
            <span className="truncate">{b.name}</span>
            {switching === b.name && <Loader2 size={12} className="animate-spin ml-auto shrink-0" />}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-micro text-ax-text-ghost">No branches match</div>
        )}
      </div>
      {error && (
        <div className="px-3 py-2 border-t border-ax-border-subtle">
          <p className="text-micro text-[var(--ax-error)]">{error}</p>
        </div>
      )}
      <div className="px-3 py-1.5 border-t border-ax-border-subtle">
        <span className="text-micro text-ax-text-ghost font-mono">{branches.length} branches</span>
      </div>
    </div>
  )
}

// ─── Commit Row ──────────────────────────────────────────────────

function CommitRow({ commit, isLocal, tags }: { commit: GitCommitEntry; isLocal?: boolean; tags?: string[] }) {
  const [copied, setCopied] = useState(false)

  const copyHash = () => {
    navigator.clipboard.writeText(commit.short)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-lg
      transition-colors group cursor-default
      ${isLocal ? 'bg-[var(--ax-warning)]/[0.08] hover:bg-[var(--ax-warning)]/[0.14]' : 'hover:bg-ax-sunken'}`}
    >
      <button
        onClick={copyHash}
        className="font-mono text-micro text-ax-text-tertiary hover:text-ax-brand
          transition-colors shrink-0 flex items-center gap-1"
        title="Copy hash"
      >
        {copied ? <Check size={10} className="text-[var(--ax-success)]" /> : <Copy size={10} className="opacity-0 group-hover:opacity-60" />}
        {commit.short}
      </button>
      <span className="text-body text-ax-text-primary truncate flex-1 min-w-0">
        {commit.message}
      </span>
      {tags && tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
          bg-ax-brand/10 text-ax-brand font-mono text-micro shrink-0">
          <Tag size={8} /> {t}
        </span>
      ))}
      {isLocal && (
        <span className="font-mono text-micro text-[var(--ax-warning)] shrink-0">local</span>
      )}
      <span className="font-mono text-micro text-ax-text-ghost shrink-0">
        {relativeTime(commit.date)}
      </span>
    </div>
  )
}

// ─── Push + Tag Modal ────────────────────────────────────────────

/** Bump the patch of a semver tag: "v1.2.3" → "v1.2.4", "desktop-v0.1.0" → "desktop-v0.1.1" */
function nextPatch(tag: string): string {
  const m = tag.match(/^(.*?)(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return tag
  return `${m[1]}${m[2]}.${m[3]}.${Number(m[4]) + 1}`
}

interface TagSuggestion {
  label: string
  value: string
  hint: string
}

function computeTagSuggestions(tags: GitTag[]): TagSuggestion[] {
  const suggestions: TagSuggestion[] = []

  // Find latest desktop-v* tag → suggest next patch
  const desktopTag = tags.find(t => /^desktop-v\d+\.\d+\.\d+$/.test(t.name))
  suggestions.push({
    label: 'Desktop',
    value: desktopTag ? nextPatch(desktopTag.name) : 'desktop-v0.1.0',
    hint: 'Build .dmg',
  })

  // Find latest v* tag (not desktop-v*) → suggest next patch
  const releaseTag = tags.find(t => /^v\d+\.\d+\.\d+$/.test(t.name))
  suggestions.push({
    label: 'Release',
    value: releaseTag ? nextPatch(releaseTag.name) : 'v0.1.0',
    hint: 'npm publish',
  })

  return suggestions
}

function PushModal({
  info, tags, tagName, setTagName,
  tagging, pushing, onPush, onTag, onCancel,
}: {
  info: GitInfo
  tags: GitTag[]
  tagName: string
  setTagName: (v: string) => void
  tagging: boolean
  pushing: boolean
  onPush: () => void
  onTag: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onCancel])

  const suggestions = computeTagSuggestions(tags)

  const tagHint = tagName.startsWith('desktop-v')
    ? 'Triggers desktop build (.dmg)'
    : tagName.startsWith('v') && !tagName.startsWith('desktop-v')
    ? 'Triggers npm publish'
    : null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-ax-elevated rounded-xl border border-ax-border p-6 max-w-md w-full mx-4 shadow-xl animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-serif italic text-h3 text-ax-text-primary mb-1">Push to remote</h3>
        <p className="text-small text-ax-text-secondary mb-5">
          {info.ahead} commit{info.ahead !== 1 ? 's' : ''} to {info.hasUpstream ? 'upstream' : `origin/${info.branch}`}
        </p>

        {/* Push button */}
        <button
          onClick={onPush}
          disabled={pushing}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
            font-mono text-small text-white
            bg-ax-brand hover:bg-ax-brand-hover transition-colors
            disabled:opacity-50"
        >
          {pushing ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
          Push {info.ahead} commit{info.ahead !== 1 ? 's' : ''}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-ax-border-subtle" />
          <span className="text-micro text-ax-text-ghost font-mono">or tag & push</span>
          <div className="flex-1 h-px bg-ax-border-subtle" />
        </div>

        {/* Tag suggestions */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {suggestions.map(s => (
            <button
              key={s.value}
              onClick={() => setTagName(s.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg
                font-mono text-micro transition-colors border
                ${tagName === s.value
                  ? 'border-ax-brand bg-ax-brand/10 text-ax-brand'
                  : 'border-ax-border-subtle bg-ax-sunken text-ax-text-secondary hover:border-ax-brand/50 hover:text-ax-text-primary'
                }`}
            >
              <Rocket size={9} className={tagName === s.value ? 'text-ax-brand' : 'text-ax-text-ghost'} />
              {s.value}
              <span className="text-ax-text-ghost">· {s.hint}</span>
            </button>
          ))}
        </div>

        {/* Tag form */}
        <div className="space-y-2">
          <input
            value={tagName}
            onChange={e => setTagName(e.target.value)}
            placeholder="Or type a custom tag..."
            className="w-full bg-ax-sunken text-small text-ax-text-primary font-mono
              px-3 py-2 rounded-lg border border-ax-border-subtle
              outline-none focus:border-ax-brand
              placeholder:text-ax-text-ghost"
            onKeyDown={e => { if (e.key === 'Enter' && tagName.trim()) onTag() }}
          />
          {tagHint && (
            <p className="text-micro text-ax-text-ghost font-mono flex items-center gap-1.5">
              <Rocket size={10} className="text-ax-brand" /> {tagHint}
            </p>
          )}
          <button
            onClick={onTag}
            disabled={!tagName.trim() || tagging}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
              font-mono text-small
              bg-ax-sunken text-ax-text-primary hover:bg-ax-border-subtle
              border border-ax-border-subtle transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {tagging ? <Loader2 size={14} className="animate-spin" /> : <Rocket size={14} />}
            Create Tag & Push
          </button>
        </div>

        {/* Cancel */}
        <button
          onClick={onCancel}
          className="w-full mt-3 px-4 py-2 rounded-lg text-small text-ax-text-tertiary
            hover:text-ax-text-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ─── Main View ───────────────────────────────────────────────────

export function SourceControlView() {
  const { activeProject, projects } = useProjectStore()
  const activeProjectData = projects.find(p => p.name === activeProject)
  const { info, commits, branches, tags, loading, refresh, fetchBranches } = useGitData(activeProject)

  const [showSwitcher, setShowSwitcher] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [confirmPush, setConfirmPush] = useState(false)
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagging, setTagging] = useState(false)

  // Clear toast after 4s
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  // Fetch branches when switcher opens
  useEffect(() => {
    if (showSwitcher) fetchBranches()
  }, [showSwitcher, fetchBranches])

  const handlePush = async () => {
    if (!activeProject || pushing) return
    setPushing(true)
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(activeProject)}/git/push`, {
        method: 'POST',
      })
      const result = await res.json()
      setToast({ message: result.message, ok: result.ok })
      if (result.ok) refresh()
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Push failed', ok: false })
    } finally {
      setPushing(false)
    }
  }

  const handlePull = async () => {
    if (!activeProject || pulling) return
    setPulling(true)
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(activeProject)}/git/pull`, {
        method: 'POST',
      })
      const result = await res.json()
      setToast({ message: result.message, ok: result.ok })
      if (result.ok) refresh()
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Pull failed', ok: false })
    } finally {
      setPulling(false)
    }
  }

  const handleBranchSwitch = (result: { ok: boolean; message: string }) => {
    setToast({ message: result.message, ok: result.ok })
    refresh()
  }

  const handleCreateTag = async () => {
    if (!activeProject || !tagName.trim() || tagging) return
    setTagging(true)
    try {
      const res = await fetch(`/api/axon/projects/${encodeURIComponent(activeProject)}/git/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName.trim(), message: tagName.trim() }),
      })
      const result = await res.json()
      setToast({ message: result.message, ok: result.ok })
      if (result.ok) {
        setShowTagForm(false)
        setTagName('')
        refresh()
      }
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Tag failed', ok: false })
    } finally {
      setTagging(false)
    }
  }

  // Local-only commits (not yet pushed)
  const localCommitCount = info?.ahead || 0
  const localHashes = new Set(commits.slice(0, localCommitCount).map(c => c.hash))

  // Map tags to commit short hashes for inline badges
  const tagsByCommit = new Map<string, string[]>()
  for (const t of tags) {
    const existing = tagsByCommit.get(t.shortSha) || []
    existing.push(t.name)
    tagsByCommit.set(t.shortSha, existing)
  }

  // Group commits by rollup boundary
  const lastRollupTime = activeProjectData?.lastRollup
    ? new Date(activeProjectData.lastRollup).getTime()
    : null

  const sinceRollup: GitCommitEntry[] = []
  const earlier: GitCommitEntry[] = []

  for (const c of commits) {
    if (lastRollupTime && new Date(c.date).getTime() > lastRollupTime) {
      sinceRollup.push(c)
    } else {
      earlier.push(c)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif italic text-h2 text-ax-text-primary">Source Control</h1>
        <div className="flex items-center gap-2 text-ax-text-ghost">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-small font-mono">Loading git info...</span>
        </div>
      </div>
    )
  }

  // Not a git repo
  if (info?.error === 'not-a-git-repo' || !info) {
    return (
      <div className="space-y-6">
        <h1 className="font-serif italic text-h2 text-ax-text-primary">Source Control</h1>
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-full bg-ax-sunken flex items-center justify-center">
            <GitBranch size={20} className="text-ax-text-ghost" />
          </div>
          <p className="text-body text-ax-text-secondary">Not a git repository</p>
          <p className="text-small text-ax-text-ghost max-w-xs text-center">
            Initialize git in this project or check the project path in Settings.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <h1 className="font-serif italic text-h2 text-ax-text-primary">Source Control</h1>

      {/* Branch Bar */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Branch name + switcher */}
          <div className="relative">
            <button
              onClick={() => setShowSwitcher(!showSwitcher)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg
                bg-ax-sunken hover:bg-ax-border-subtle transition-colors"
            >
              <GitBranch size={14} className="text-ax-brand shrink-0" />
              <span className="font-mono text-body text-ax-text-primary font-medium">
                {info.isDetached ? info.shortSha : info.branch}
              </span>
              <ChevronDown size={12} className={`text-ax-text-ghost transition-transform ${showSwitcher ? 'rotate-180' : ''}`} />
            </button>

            {info.isDetached && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                bg-[var(--ax-warning)]/15 text-[var(--ax-warning)]
                text-micro font-mono uppercase tracking-wider"
              >
                <AlertTriangle size={10} /> detached
              </span>
            )}

            {showSwitcher && (
              <BranchSwitcher
                branches={branches}
                current={info.branch}
                project={activeProject!}
                onSwitch={handleBranchSwitch}
                onClose={() => setShowSwitcher(false)}
              />
            )}
          </div>

          {/* Ahead/behind badges */}
          {info.hasUpstream && (info.ahead > 0 || info.behind > 0) && (
            <div className="flex items-center gap-2">
              {info.ahead > 0 && (
                <span className="flex items-center gap-1 font-mono text-micro text-[var(--ax-success)]">
                  <ArrowUp size={12} /> {info.ahead}
                </span>
              )}
              {info.behind > 0 && (
                <span className="flex items-center gap-1 font-mono text-micro text-[var(--ax-warning)]">
                  <ArrowDown size={12} /> {info.behind}
                </span>
              )}
            </div>
          )}

          {/* No remote label */}
          {!info.remote && (
            <span className="font-mono text-micro text-ax-text-ghost">No remote</span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Pull + Push buttons */}
          {info.remote && !info.isDetached && (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePull}
                disabled={pulling || info.behind === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                  border border-ax-border text-small font-mono
                  text-ax-text-secondary hover:text-ax-text-primary
                  hover:bg-ax-sunken transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {pulling ? <Loader2 size={12} className="animate-spin" /> : <ArrowDown size={12} />}
                Pull
              </button>
              <button
                onClick={() => setConfirmPush(true)}
                disabled={pushing || info.ahead === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                  text-small font-mono text-white
                  bg-ax-brand hover:bg-ax-brand-hover transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {pushing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUp size={12} />}
                {info.hasUpstream ? 'Push' : 'Publish'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && <ActionToast message={toast.message} ok={toast.ok} />}

      {/* Commit Log */}
      {commits.length === 0 ? (
        <div className="flex flex-col items-center py-12 gap-3">
          <GitCommit size={20} className="text-ax-text-ghost" />
          <p className="text-small text-ax-text-ghost">No commits yet</p>
        </div>
      ) : lastRollupTime && sinceRollup.length > 0 ? (
        <>
          {/* Since last rollup — highlighted */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="font-mono text-micro text-ax-text-secondary uppercase tracking-wider">
                Since last rollup
              </h2>
              <span className="font-mono text-micro text-ax-text-ghost">
                {formatDate(activeProjectData!.lastRollup!)}
              </span>
              <span className="font-mono text-micro text-ax-brand">
                {sinceRollup.length} commit{sinceRollup.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="border-l-2 border-l-[var(--ax-brand)] rounded-lg
              bg-[var(--ax-brand)]/[0.04]"
            >
              {sinceRollup.map(c => <CommitRow key={c.hash} commit={c} isLocal={localHashes.has(c.hash)} tags={tagsByCommit.get(c.short)} />)}
            </div>
          </div>

          {/* Earlier */}
          {earlier.length > 0 && (
            <div>
              <h2 className="font-mono text-micro text-ax-text-ghost uppercase tracking-wider mb-2">
                Earlier
              </h2>
              <div className="rounded-lg">
                {earlier.map(c => <CommitRow key={c.hash} commit={c} isLocal={localHashes.has(c.hash)} tags={tagsByCommit.get(c.short)} />)}
              </div>
            </div>
          )}
        </>
      ) : (
        /* No rollup — single list */
        <div>
          <h2 className="font-mono text-micro text-ax-text-secondary uppercase tracking-wider mb-2">
            Recent commits
          </h2>
          <div className="rounded-lg">
            {commits.map(c => <CommitRow key={c.hash} commit={c} isLocal={localHashes.has(c.hash)} tags={tagsByCommit.get(c.short)} />)}
          </div>
        </div>
      )}

      {/* Tags — compact list if any exist */}
      {tags.length > 0 && (
        <div>
          <h2 className="font-mono text-micro text-ax-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
            <Tag size={13} /> Tags
            <span className="text-ax-text-ghost">{tags.length}</span>
          </h2>
          <div className="bg-ax-elevated rounded-xl border border-ax-border py-1">
            {tags.slice(0, 6).map(t => (
              <div key={t.name} className="flex items-center gap-3 px-3 py-2 rounded-lg
                hover:bg-ax-sunken transition-colors"
              >
                <Tag size={12} className="text-ax-brand shrink-0" />
                <span className="font-mono text-body text-ax-text-primary font-medium">{t.name}</span>
                <span className="font-mono text-micro text-ax-text-ghost">{t.shortSha}</span>
                {t.message && (
                  <span className="text-small text-ax-text-secondary truncate flex-1 min-w-0">{t.message}</span>
                )}
                <span className="font-mono text-micro text-ax-text-ghost shrink-0">
                  {relativeTime(t.date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Push + Tag modal */}
      {confirmPush && info && (
        <PushModal
          info={info}
          tags={tags}
          tagName={tagName}
          setTagName={setTagName}
          tagging={tagging}
          pushing={pushing}
          onPush={() => { setConfirmPush(false); handlePush() }}
          onTag={() => handleCreateTag().then(() => setConfirmPush(false))}
          onCancel={() => { setConfirmPush(false); setTagName('') }}
        />
      )}
    </div>
  )
}
