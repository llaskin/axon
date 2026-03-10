import { RollupCard } from '@/components/timeline/RollupCard'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'
import { useRollups } from '@/hooks/useRollups'
import { getGreeting } from '@/lib/utils'

export function TimelineView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const openRollup = useUIStore((s) => s.openRollup)
  const { rollups, loading, error } = useRollups(activeProject)

  return (
    <div>
      <header className="mb-10">
        <p className="font-serif italic text-body text-ax-text-tertiary mb-1">
          {getGreeting()}
        </p>
        <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
          Timeline
        </h1>
        <p className="text-body text-ax-text-secondary mt-2">
          {activeProject ? `Rollup history for ${activeProject}` : 'Select a project to begin'}
        </p>
      </header>

      {error && (
        <div className="bg-ax-error-subtle border border-ax-error/20 rounded-xl p-5 mb-6">
          <p className="text-body text-ax-error">{error}</p>
        </div>
      )}

      {loading && !error && (
        <div className="space-y-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-ax-elevated rounded-xl border border-ax-border p-6 animate-pulse">
              <div className="h-4 bg-ax-sunken rounded w-24 mb-3" />
              <div className="h-6 bg-ax-sunken rounded w-3/4 mb-3" />
              <div className="h-4 bg-ax-sunken rounded w-full mb-2" />
              <div className="h-4 bg-ax-sunken rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {!loading && rollups.length === 0 && activeProject && (
        <div className="text-center py-20">
          <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No rollups yet</p>
          <p className="text-body text-ax-text-tertiary">
            Run <code className="font-mono text-small bg-ax-sunken px-2 py-1 rounded">axon rollup --project {activeProject}</code> to generate your first
          </p>
        </div>
      )}

      {!loading && rollups.length > 0 && (
        <div className="space-y-4">
          {rollups.map((rollup, i) => (
            <RollupCard key={rollup.filename} rollup={rollup} index={i} onClick={() => openRollup(rollup.filename)} />
          ))}
        </div>
      )}
    </div>
  )
}
