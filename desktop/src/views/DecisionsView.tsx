import { useState, useMemo, useEffect } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useRollups } from '@/hooks/useRollups'
import { useUIStore } from '@/store/uiStore'
import { parseFrontmatter, parseDecisionTraces } from '@/lib/parser'
import { formatDate } from '@/lib/utils'
import { Search, Globe, FolderOpen } from 'lucide-react'
import type { RollupEpisode, RollupFrontmatter } from '@/lib/types'
import { extractSummary } from '@/lib/parser'

interface DecisionWithContext {
  id: string
  title: string
  input: string
  constraint: string
  tradeoff: string
  decision: string
  rollupDate: string
  rollupFilename: string
  rollupHeadline: string
  projectName: string
}

/** Fetch rollups for all projects */
function useAllProjectRollups(enabled: boolean) {
  const projects = useProjectStore((s) => s.projects)
  const [allRollups, setAllRollups] = useState<(RollupEpisode & { projectName: string })[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || projects.length === 0) {
      setAllRollups([])
      return
    }

    setLoading(true)
    setError(null)

    Promise.all(
      projects.map(p =>
        fetch(`/api/axon/projects/${encodeURIComponent(p.name)}/rollups`)
          .then(r => r.ok ? r.json() : [])
          .then((raw: Array<{ filename: string; content: string }>) =>
            raw.map(r => {
              const result = parseFrontmatter<RollupFrontmatter>(r.content)
              const ep: RollupEpisode & { projectName: string } = result.ok && result.data ? {
                filename: r.filename,
                frontmatter: { ...{ type: 'rollup' as const, date: '', project: p.name }, ...result.data.frontmatter },
                summary: extractSummary(result.data.body),
                body: result.data.body,
                projectName: p.name,
              } : {
                filename: r.filename,
                frontmatter: { type: 'rollup' as const, date: '', project: p.name },
                summary: '',
                body: r.content,
                projectName: p.name,
              }
              return ep
            })
          )
          .catch(() => [] as (RollupEpisode & { projectName: string })[])
      )
    ).then(results => {
      setAllRollups(results.flat())
      setLoading(false)
    }).catch(e => {
      setError(e instanceof Error ? e.message : 'Failed to load cross-project rollups')
      setLoading(false)
    })
  }, [enabled, projects])

  return { allRollups, loading, error }
}

export function DecisionsView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const projects = useProjectStore((s) => s.projects)
  const openRollup = useUIStore((s) => s.openRollup)
  const { rollups, loading, error } = useRollups(activeProject)
  const [search, setSearch] = useState('')
  const [crossProject, setCrossProject] = useState(false)

  const { allRollups, loading: crossLoading, error: crossError } = useAllProjectRollups(crossProject)

  // Extract all decisions from rollups (current project or all projects)
  const allDecisions = useMemo(() => {
    const decisions: DecisionWithContext[] = []
    const sourceRollups = crossProject
      ? allRollups
      : rollups.map(r => ({ ...r, projectName: activeProject || '' }))
    for (const rollup of sourceRollups) {
      const traces = parseDecisionTraces(rollup.body)
      for (const dt of traces) {
        decisions.push({
          ...dt,
          rollupDate: rollup.frontmatter.date || '',
          rollupFilename: rollup.filename,
          rollupHeadline: rollup.frontmatter.headline || rollup.filename,
          projectName: rollup.projectName,
        })
      }
    }
    return decisions
  }, [rollups, allRollups, crossProject, activeProject])

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return allDecisions
    const q = search.toLowerCase()
    return allDecisions.filter(d =>
      d.title.toLowerCase().includes(q) ||
      d.input.toLowerCase().includes(q) ||
      d.decision.toLowerCase().includes(q) ||
      d.constraint.toLowerCase().includes(q) ||
      d.tradeoff.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q)
    )
  }, [allDecisions, search])

  // Group by rollup date
  const grouped = useMemo(() => {
    const groups: Record<string, DecisionWithContext[]> = {}
    for (const d of filtered) {
      const key = d.rollupDate || 'unknown'
      if (!groups[key]) groups[key] = []
      groups[key].push(d)
    }
    // Sort dates descending
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const isLoading = crossProject ? crossLoading : loading
  const currentError = crossProject ? crossError : error

  if (isLoading) {
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
            <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
              Decisions
            </h1>
            <p className="text-body text-ax-text-secondary mt-2">
              {crossProject ? (
                <>
                  <span className="font-mono">{allDecisions.length}</span> decision traces across{' '}
                  <span className="font-mono">{projects.length}</span> projects
                </>
              ) : activeProject ? (
                <>
                  <span className="font-mono">{allDecisions.length}</span> decision traces across{' '}
                  <span className="font-mono">{rollups.length}</span> rollups
                </>
              ) : (
                'Select a project to explore decisions'
              )}
            </p>
          </div>

          {/* Cross-project toggle */}
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
      </header>

      {currentError && (
        <div className="bg-ax-error-subtle border border-ax-error/20 rounded-xl p-5 mb-6">
          <p className="text-body text-ax-error">{currentError}</p>
        </div>
      )}

      {/* Search */}
      {allDecisions.length > 0 && (
        <div className="relative mb-6">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ax-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setSearch('') }}
            placeholder="Search decisions..."
            aria-label="Search decision traces"
            className="w-full bg-ax-elevated border border-ax-border rounded-lg pl-10 pr-4 py-2.5
              text-body text-ax-text-primary placeholder-ax-text-tertiary
              focus:outline-none focus:border-ax-brand focus:ring-1 focus:ring-ax-brand/20
              transition-colors"
          />
          {search && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-micro text-ax-text-tertiary">
              {filtered.length}/{allDecisions.length}
            </span>
          )}
        </div>
      )}

      {/* Decision list */}
      {allDecisions.length === 0 && activeProject && (
        <div className="text-center py-20">
          <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No decisions found</p>
          <p className="text-body text-ax-text-tertiary">
            Decision traces will appear here as rollups accumulate
          </p>
        </div>
      )}

      {filtered.length === 0 && search && (
        <div className="text-center py-16">
          <p className="text-body text-ax-text-tertiary">
            No decisions matching "<span className="font-medium text-ax-text-secondary">{search}</span>"
          </p>
        </div>
      )}

      <div className="space-y-8">
        {grouped.map(([date, decisions]) => (
          <div key={date} className="animate-fade-in-up">
            {/* Date group header */}
            <div className="flex items-center gap-3 mb-3">
              <time className="font-mono text-small text-ax-text-tertiary shrink-0">
                {date !== 'unknown' ? formatDate(date) : 'Unknown date'}
              </time>
              <div className="flex-1 border-t border-ax-border-subtle" />
              <button
                onClick={() => openRollup(decisions[0].rollupFilename)}
                className="font-mono text-micro text-ax-brand hover:text-ax-brand-hover transition-colors"
              >
                view rollup
              </button>
            </div>

            {/* Decision cards for this date */}
            <div className="space-y-3">
              {decisions.map((dt) => (
                <div
                  key={`${dt.rollupFilename}-${dt.id}`}
                  className="bg-ax-elevated rounded-xl border border-ax-border p-5 hover:border-ax-border-strong transition-colors"
                >
                  <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                    <span className="font-mono text-micro text-ax-brand font-medium px-1.5 py-0.5 bg-ax-brand-subtle rounded">
                      {dt.id}
                    </span>
                    <h3 className="font-serif text-h4 text-ax-text-primary">{dt.title}</h3>
                    {crossProject && (
                      <span className="font-mono text-micro text-ax-text-tertiary px-1.5 py-0.5 bg-ax-sunken rounded ml-auto">
                        {dt.projectName}
                      </span>
                    )}
                  </div>

                  {/* Compact view — show decision first, then expandable details */}
                  {dt.decision && (
                    <p className="text-body text-ax-text-primary font-medium mb-2 leading-relaxed">
                      {dt.decision}
                    </p>
                  )}

                  <div className="space-y-1.5 text-small text-ax-text-secondary">
                    {dt.input && (
                      <div className="flex gap-2">
                        <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider shrink-0 w-20">Input</span>
                        <span className="leading-relaxed">{dt.input}</span>
                      </div>
                    )}
                    {dt.constraint && (
                      <div className="flex gap-2">
                        <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider shrink-0 w-20">Constraint</span>
                        <span className="leading-relaxed">{dt.constraint}</span>
                      </div>
                    )}
                    {dt.tradeoff && (
                      <div className="flex gap-2">
                        <span className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider shrink-0 w-20">Tradeoff</span>
                        <span className="leading-relaxed">{dt.tradeoff}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
