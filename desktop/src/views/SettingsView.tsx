import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { parse as parseYaml } from 'yaml'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { useBackend } from '@/providers/DataProvider'
import { formatDate } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

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

function SettingsCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ax-elevated rounded-xl border border-ax-border p-5 ${className}`}>
      <h3 className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary mb-3">{title}</h3>
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        enabled ? 'bg-ax-success' : 'bg-ax-sunken'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
        enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-ax-success-subtle text-ax-success',
    paused: 'bg-ax-warning-subtle text-ax-warning',
    archived: 'bg-ax-sunken text-ax-text-tertiary',
  }
  return (
    <span className={`font-mono text-micro px-2 py-0.5 rounded-full ${colors[status] || colors.active}`}>
      {status}
    </span>
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

  // Selected project for settings (defaults to active, can browse others)
  const [selectedProject, setSelectedProject] = useState<string | null>(activeProject)

  // Sync selected when active project changes externally
  useEffect(() => {
    setSelectedProject(activeProject)
  }, [activeProject])

  // User context editing state
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

  // Measure the active pill and position the sliding highlight
  // useLayoutEffect so measurement happens before paint on initial render
  useLayoutEffect(() => {
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

  const navigateProject = useCallback((dir: -1 | 1) => {
    const idx = selectedIdx + dir
    if (idx >= 0 && idx < visibleProjects.length) setSelectedProject(visibleProjects[idx].name)
  }, [selectedIdx, visibleProjects])

  const contextDirty = config ? contextDraft.trim() !== (config.userContext || '') : false

  // Header is always rendered so the pill bar stays mounted and can animate
  const header = (
    <header className="mb-6">
      <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
        Settings
      </h1>

      {/* Project tab selector */}
      {visibleProjects.length > 1 && (
        <div className="flex items-center gap-1.5 mt-3">
          <button
            onClick={() => navigateProject(-1)}
            disabled={selectedIdx <= 0}
            aria-label="Previous project"
            className="p-1 rounded text-ax-text-tertiary hover:text-ax-text-secondary hover:bg-ax-sunken transition-colors disabled:opacity-20 disabled:cursor-not-allowed shrink-0"
          >
            <ChevronLeft size={14} />
          </button>
          <div ref={pillsRef} className="relative flex items-center gap-0 overflow-x-auto scrollbar-hide rounded-lg bg-ax-sunken p-0.5">
            {/* Sliding highlight */}
            {pillOffsets && (
              <div
                className="absolute top-0.5 bottom-0.5 rounded-md bg-ax-elevated shadow-sm border border-ax-border-subtle transition-[left,width] duration-200 ease-out"
                style={{
                  left: pillOffsets.left,
                  width: pillOffsets.width,
                }}
              />
            )}
            {visibleProjects.map(p => (
              <button
                key={p.name}
                data-project={p.name}
                onClick={() => setSelectedProject(p.name)}
                className={`relative z-[1] font-mono text-micro px-3 py-1 rounded-md whitespace-nowrap transition-colors duration-150
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

  if (loading) {
    return (
      <div>
        {header}
        <div className="space-y-4 animate-pulse">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-32 bg-ax-sunken rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        {header}
        <div className="text-center py-20">
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
        <div className="text-center py-20">
          <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No project selected</p>
          <p className="text-body text-ax-text-tertiary">Select a project to view its settings</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {header}

      {/* Keyed container — remounts on project switch for animation */}
      <div key={selectedProject}>

      {/* Project Info */}
      <SettingsCard title="Project" className="mb-5 animate-fade-in-up">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Name</span>
            <span className="font-mono text-body text-ax-text-primary">{config.project}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Status</span>
            <select
              value={config.status}
              onChange={e => handleStatusChange(e.target.value)}
              className="font-mono text-micro px-2 py-0.5 rounded-full bg-ax-sunken text-ax-text-primary border-none outline-none cursor-pointer appearance-none text-right"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Path</span>
            <span className="font-mono text-small text-ax-text-secondary truncate max-w-[60%] text-right">{config.projectPath}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Created</span>
            <span className="text-small text-ax-text-secondary">{config.createdAt ? formatDate(config.createdAt.split('T')[0]) : '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Timezone</span>
            <span className="font-mono text-small text-ax-text-secondary">{config.timezone || '—'}</span>
          </div>
        </div>
      </SettingsCard>

      {/* Stats */}
      {selectedProjectData && (
        <SettingsCard title="Stats" className="mb-5 animate-fade-in-up">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">{selectedProjectData.episodeCount}</div>
              <div className="text-micro text-ax-text-tertiary">Episodes</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">{selectedProjectData.openLoopCount}</div>
              <div className="text-micro text-ax-text-tertiary">Open Loops</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">
                {selectedProjectData.lastRollup ? formatDate(selectedProjectData.lastRollup) : '—'}
              </div>
              <div className="text-micro text-ax-text-tertiary">Last Rollup</div>
            </div>
          </div>
        </SettingsCard>
      )}

      {/* Dendrites */}
      <SettingsCard title="Dendrites" className="mb-5 animate-fade-in-up">
        <p className="text-small text-ax-text-tertiary mb-3">Signal sources collected during each rollup</p>
        <div className="space-y-0">
          {Object.entries(config.dendrites).map(([name, settings]) => (
            <div key={name} className="flex items-center justify-between py-2.5 border-b border-ax-border-subtle last:border-0">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full transition-colors ${settings.enabled ? 'bg-ax-success' : 'bg-ax-text-tertiary'}`} />
                <span className="font-mono text-body text-ax-text-primary">{name}</span>
              </div>
              <div className="flex items-center gap-3">
                {settings.maxCommits && (
                  <span className="font-mono text-micro text-ax-text-tertiary">max {settings.maxCommits}</span>
                )}
                <Toggle enabled={settings.enabled} onChange={v => handleDendriteToggle(name, v)} />
              </div>
            </div>
          ))}
          {Object.keys(config.dendrites).length === 0 && (
            <p className="text-small text-ax-text-tertiary italic py-2">No dendrite config found</p>
          )}
        </div>
      </SettingsCard>

      {/* Rollup Config */}
      <SettingsCard title="Rollup" className="mb-5 animate-fade-in-up">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Auto Collect</span>
            <Toggle enabled={config.rollup.autoCollect} onChange={handleAutoCollectToggle} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Context Window</span>
            <select
              value={config.rollup.contextWindow}
              onChange={e => handleContextWindowChange(parseInt(e.target.value))}
              className="font-mono text-small px-2 py-0.5 rounded bg-ax-sunken text-ax-text-primary border-none outline-none cursor-pointer"
            >
              {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(n => (
                <option key={n} value={n}>{n} episodes</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Model</span>
            <span className="font-mono text-small text-ax-text-secondary">{config.rollup.model}</span>
          </div>
        </div>
      </SettingsCard>

      {/* User Context */}
      <SettingsCard title="User Context" className="mb-5 animate-fade-in-up">
        <p className="text-small text-ax-text-tertiary mb-3">
          Describe your role in this project — injected into rollups and briefings
        </p>
        <textarea
          value={contextDraft}
          onChange={e => setContextDraft(e.target.value)}
          placeholder="e.g. I'm the lead on the frontend, focused on the React components in desktop/src/. I don't touch the CLI scripts."
          rows={3}
          className="w-full bg-ax-sunken rounded-lg border border-ax-border-subtle px-3 py-2 text-small text-ax-text-primary placeholder:text-ax-text-tertiary/50 resize-none outline-none focus:border-ax-brand-primary transition-colors font-mono"
        />
        {contextDirty && (
          <div className="flex justify-end mt-2">
            <button
              onClick={handleContextSave}
              disabled={contextSaving}
              className="font-mono text-micro px-3 py-1 rounded-full bg-ax-brand-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {contextSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </SettingsCard>

      {/* All Projects */}
      <SettingsCard title="All Projects" className="animate-fade-in-up">
        <div className="space-y-0">
          {projects.map(p => (
            <div key={p.name} className="flex items-center justify-between py-2.5 border-b border-ax-border-subtle last:border-0">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${
                  p.status === 'active' ? 'bg-ax-success' :
                  p.status === 'paused' ? 'bg-ax-warning' : 'bg-ax-text-tertiary'
                }`} />
                <span className={`font-mono text-body ${
                  p.name === selectedProject ? 'text-ax-text-primary font-medium' : 'text-ax-text-secondary'
                }`}>{p.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-micro text-ax-text-tertiary">{p.episodeCount} episodes</span>
                <StatusBadge status={p.status} />
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      {/* Project Actions */}
      <SettingsCard title="Project Actions" className="mt-5 animate-fade-in-up">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-small text-ax-text-primary">Archive project</p>
              <p className="text-micro text-ax-text-tertiary">Hide from sidebar, keep all data</p>
            </div>
            <button
              onClick={() => handleRemoveProject('archive')}
              className="font-mono text-micro px-3 py-1.5 rounded-lg bg-ax-sunken text-ax-text-secondary border border-ax-border-subtle hover:bg-ax-sunken/80 transition-colors"
            >
              Archive
            </button>
          </div>
          <div className="border-t border-ax-border-subtle" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-small text-ax-error">Delete project</p>
              <p className="text-micro text-ax-text-tertiary">Permanently remove all Axon data</p>
            </div>
            <button
              onClick={() => setShowRemoveDialog(true)}
              className="font-mono text-micro px-3 py-1.5 rounded-lg bg-ax-error/10 text-ax-error border border-ax-error/20 hover:bg-ax-error/20 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </SettingsCard>

      </div>{/* end keyed container */}

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
