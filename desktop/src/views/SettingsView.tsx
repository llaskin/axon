import { useEffect, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { formatDate } from '@/lib/utils'

interface ProjectConfig {
  project: string
  projectPath: string
  createdAt: string
  status: string
  timezone: string
  dendrites: Record<string, { enabled: boolean; maxCommits?: number }>
  rollup: { autoCollect: boolean; contextWindow: number; model: string }
}

function parseConfig(content: string): ProjectConfig {
  const config: ProjectConfig = {
    project: '',
    projectPath: '',
    createdAt: '',
    status: 'active',
    timezone: '',
    dendrites: {},
    rollup: { autoCollect: true, contextWindow: 3, model: 'claude-opus-4-6' },
  }

  if (!content) return config

  config.project = content.match(/^project:\s*(.+)$/m)?.[1]?.trim() || ''
  config.projectPath = content.match(/^project_path:\s*(.+)$/m)?.[1]?.trim() || ''
  config.createdAt = content.match(/^created_at:\s*(.+)$/m)?.[1]?.trim() || ''
  config.status = content.match(/^status:\s*(.+)$/m)?.[1]?.trim() || 'active'
  config.timezone = content.match(/^timezone:\s*(.+)$/m)?.[1]?.trim() || ''

  // Parse dendrites section
  const dendriteBlock = content.match(/^dendrites:\n((?:\s+.+\n)*)/m)?.[1] || ''
  const dendriteEntries = dendriteBlock.matchAll(/^\s{2}(\S+):\n\s+enabled:\s*(true|false)(?:\n\s+max_commits:\s*(\d+))?/gm)
  for (const match of dendriteEntries) {
    config.dendrites[match[1]] = {
      enabled: match[2] === 'true',
      ...(match[3] ? { maxCommits: parseInt(match[3]) } : {}),
    }
  }

  // Parse rollup section
  const autoCollect = content.match(/^\s+auto_collect:\s*(true|false)$/m)?.[1]
  if (autoCollect) config.rollup.autoCollect = autoCollect === 'true'
  const contextWindow = content.match(/^\s+context_window:\s*(\d+)$/m)?.[1]
  if (contextWindow) config.rollup.contextWindow = parseInt(contextWindow)
  const model = content.match(/^\s+model:\s*(.+)$/m)?.[1]?.trim()
  if (model) config.rollup.model = model

  return config
}

function SettingsCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ax-elevated rounded-xl border border-ax-border p-5 ${className}`}>
      <h3 className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary mb-3">{title}</h3>
      {children}
    </div>
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
  const { projects, activeProject } = useProjectStore()
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeProject) {
      setConfig(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/axon/projects/${encodeURIComponent(activeProject)}/config`)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load config (${r.status})`)
        return r.json()
      })
      .then(data => {
        setConfig(parseConfig(data.content))
        setLoading(false)
      })
      .catch(e => {
        setError(e instanceof Error ? e.message : 'Failed to load config')
        setLoading(false)
      })
  }, [activeProject])

  const activeProjectData = projects.find(p => p.name === activeProject)

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-ax-sunken rounded w-48" />
        <div className="h-4 bg-ax-sunken rounded w-64" />
        <div className="space-y-4 mt-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-32 bg-ax-sunken rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="font-serif italic text-h3 text-ax-error mb-2">Error</p>
        <p className="text-body text-ax-text-secondary">{error}</p>
      </div>
    )
  }

  if (!config || !activeProject) {
    return (
      <div className="text-center py-20">
        <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No project selected</p>
        <p className="text-body text-ax-text-tertiary">Select a project to view its settings</p>
      </div>
    )
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
          Settings
        </h1>
        <p className="text-body text-ax-text-secondary mt-2">
          Configuration for <span className="font-mono">{activeProject}</span>
        </p>
      </header>

      {/* Project Info */}
      <SettingsCard title="Project" className="mb-5 animate-fade-in-up">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Name</span>
            <span className="font-mono text-body text-ax-text-primary">{config.project}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Status</span>
            <StatusBadge status={config.status} />
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
      {activeProjectData && (
        <SettingsCard title="Stats" className="mb-5 animate-fade-in-up" >
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">{activeProjectData.episodeCount}</div>
              <div className="text-micro text-ax-text-tertiary">Episodes</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">{activeProjectData.openLoopCount}</div>
              <div className="text-micro text-ax-text-tertiary">Open Loops</div>
            </div>
            <div className="text-center">
              <div className="font-mono text-h3 text-ax-text-primary">
                {activeProjectData.lastRollup ? formatDate(activeProjectData.lastRollup) : '—'}
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
                <span className={`w-2 h-2 rounded-full ${settings.enabled ? 'bg-ax-success' : 'bg-ax-text-tertiary'}`} />
                <span className="font-mono text-body text-ax-text-primary">{name}</span>
              </div>
              <div className="flex items-center gap-3">
                {settings.maxCommits && (
                  <span className="font-mono text-micro text-ax-text-tertiary">max {settings.maxCommits}</span>
                )}
                <span className={`font-mono text-micro px-2 py-0.5 rounded-full ${
                  settings.enabled
                    ? 'bg-ax-success-subtle text-ax-success'
                    : 'bg-ax-sunken text-ax-text-tertiary'
                }`}>
                  {settings.enabled ? 'on' : 'off'}
                </span>
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
            <span className={`font-mono text-micro px-2 py-0.5 rounded-full ${
              config.rollup.autoCollect
                ? 'bg-ax-success-subtle text-ax-success'
                : 'bg-ax-sunken text-ax-text-tertiary'
            }`}>
              {config.rollup.autoCollect ? 'on' : 'off'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Context Window</span>
            <span className="font-mono text-small text-ax-text-secondary">{config.rollup.contextWindow} episodes</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-small text-ax-text-tertiary">Model</span>
            <span className="font-mono text-small text-ax-text-secondary">{config.rollup.model}</span>
          </div>
        </div>
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
                  p.name === activeProject ? 'text-ax-text-primary font-medium' : 'text-ax-text-secondary'
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
    </div>
  )
}
