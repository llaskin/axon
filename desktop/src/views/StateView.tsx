import { useEffect, useState } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useBackend } from '@/providers/DataProvider'
import { formatDate, getGreeting } from '@/lib/utils'

interface ParsedState {
  project: string
  lastRollup: string
  lastActivity: string
  currentFocus: string
  workstreams: Array<{ name: string; status: string }>
  openLoops: Array<{ text: string; checked: boolean }>
  suggestedNextMove: string[]
  keyFiles: Array<{ file: string; purpose: string }>
  recentTimeline: Array<{ date: string; text: string }>
}

function parseStateMd(content: string): ParsedState {
  const state: ParsedState = {
    project: '',
    lastRollup: '',
    lastActivity: '',
    currentFocus: '',
    workstreams: [],
    openLoops: [],
    suggestedNextMove: [],
    keyFiles: [],
    recentTimeline: [],
  }

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const body = fmMatch ? fmMatch[2] : content
  if (fmMatch) {
    const fm = fmMatch[1]
    state.project = fm.match(/^project:\s*(.+)$/m)?.[1]?.trim() || ''
    state.lastRollup = fm.match(/^last_rollup:\s*(.+)$/m)?.[1]?.trim() || ''
    state.lastActivity = fm.match(/^last_activity:\s*(.+)$/m)?.[1]?.trim() || ''
  }

  const sections = body.split(/\n(?=##\s)/).filter(s => s.trim())

  for (const section of sections) {
    const lines = section.split('\n')
    const heading = lines[0]?.replace(/^#+\s*/, '').trim() || ''
    const sectionContent = lines.slice(1).join('\n').trim()
    const headingLower = heading.toLowerCase()

    if (headingLower.includes('current focus') || headingLower.includes('current state')) {
      state.currentFocus = sectionContent.split('\n')[0]?.trim() || sectionContent.trim()
    }

    if (headingLower.includes('where things stand') || headingLower.includes('workstream')) {
      const tableLines = sectionContent.split('\n').filter(l => l.includes('|') && !l.match(/^\s*\|?\s*[-]+/))
      for (const line of tableLines.slice(1)) {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean)
        if (cells.length >= 2) {
          state.workstreams.push({ name: cells[0], status: cells[1] })
        }
      }
    }

    if (headingLower.includes('open loop')) {
      const items = sectionContent.split('\n').filter(l => l.match(/^\s*-\s*\[/))
      for (const item of items) {
        const checked = item.includes('[x]')
        const text = item.replace(/^\s*-\s*\[[ x>]\]\s*/, '').trim()
        state.openLoops.push({ text, checked })
      }
    }

    if (headingLower.includes('suggested next') || headingLower.includes('recommended')) {
      const items = sectionContent.split('\n').filter(l => l.match(/^\s*\d+\.\s/) || l.match(/^\s*[-*]\s/))
      for (const item of items) {
        state.suggestedNextMove.push(item.replace(/^\s*\d+\.\s+/, '').replace(/^\s*[-*]\s+/, '').trim())
      }
    }

    if (headingLower.includes('key file')) {
      const tableLines = sectionContent.split('\n').filter(l => l.includes('|') && !l.match(/^\s*\|?\s*[-]+/))
      for (const line of tableLines.slice(1)) {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean)
        if (cells.length >= 2) {
          state.keyFiles.push({ file: cells[0].replace(/`/g, ''), purpose: cells[1] })
        }
      }
    }

    if (headingLower.includes('recent timeline') || headingLower === 'timeline') {
      const items = sectionContent.split('\n').filter(l => l.match(/^\s*[-*]\s*\*\*/))
      for (const item of items) {
        const dateMatch = item.match(/\*\*([^*]+)\*\*\s*[-—]\s*(.+)/)
        if (dateMatch) {
          state.recentTimeline.push({ date: dateMatch[1], text: dateMatch[2] })
        }
      }
    }
  }

  return state
}

function StatCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-ax-elevated rounded-xl border border-ax-border p-5 ${className}`}>
      <h3 className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary mb-3">{title}</h3>
      {children}
    </div>
  )
}

export function StateView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const backend = useBackend()
  const [state, setState] = useState<ParsedState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!activeProject) {
      setState(null)
      setLoading(false)
      return
    }
    setLoading(true)
    backend.getState(activeProject).then(content => {
      setState(parseStateMd(content))
      setLoading(false)
    }).catch(() => {
      setState(null)
      setLoading(false)
    })
  }, [activeProject, backend])

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

  if (!state || !activeProject) {
    return (
      <div className="text-center py-20">
        <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">No state loaded</p>
        <p className="text-body text-ax-text-tertiary">Select a project to view its current state</p>
      </div>
    )
  }

  const openCount = state.openLoops.filter(l => !l.checked).length
  const doneCount = state.openLoops.filter(l => l.checked).length

  // Staleness: days since last rollup
  let staleDays = 0
  let staleLevel: 'fresh' | 'amber' | 'red' = 'fresh'
  if (state.lastRollup && state.lastRollup !== 'genesis') {
    const rollupDate = new Date(state.lastRollup)
    const now = new Date()
    staleDays = Math.floor((now.getTime() - rollupDate.getTime()) / (1000 * 60 * 60 * 24))
    if (staleDays >= 3) staleLevel = 'red'
    else if (staleDays >= 1) staleLevel = 'amber'
  }

  return (
    <div>
      <header className="mb-8">
        <p className="font-serif italic text-body text-ax-text-tertiary mb-1">
          {getGreeting()}
        </p>
        <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
          State
        </h1>
        <div className="flex items-center gap-3 mt-2">
          <p className="text-body text-ax-text-secondary">
            Current context for <span className="font-mono">{activeProject}</span>
            {state.lastRollup && (
              <span className="text-ax-text-tertiary"> &middot; last rollup {formatDate(state.lastRollup)}</span>
            )}
          </p>
          {staleLevel !== 'fresh' && (
            <span className={`font-mono text-micro px-2 py-0.5 rounded-full ${
              staleLevel === 'red'
                ? 'bg-ax-error-subtle text-ax-error'
                : 'bg-ax-warning-subtle text-ax-warning'
            }`}>
              {staleDays}d stale
            </span>
          )}
        </div>
      </header>

      {/* Current Focus — full width hero */}
      {state.currentFocus && (
        <div className="bg-ax-brand-subtle border border-ax-brand/20 rounded-xl p-6 mb-5 animate-fade-in-up">
          <h3 className="font-mono text-micro uppercase tracking-widest text-ax-brand mb-2">Current Focus</h3>
          <p className="text-body text-ax-text-primary leading-relaxed">{renderInline(state.currentFocus)}</p>
        </div>
      )}

      {/* Suggested Next Move — full width */}
      {state.suggestedNextMove.length > 0 && (
        <div className="bg-ax-accent-subtle border border-ax-accent/20 rounded-xl p-6 mb-5 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
          <h3 className="font-mono text-micro uppercase tracking-widest text-ax-accent mb-3">Suggested Next Move</h3>
          <div className="space-y-2.5">
            {state.suggestedNextMove.map((move, i) => (
              <div key={i} className="flex gap-3 text-body text-ax-text-primary">
                <span className="font-mono text-ax-accent shrink-0 w-5 text-right">{i + 1}.</span>
                <span className="leading-relaxed">{renderInline(move)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Loops — full width */}
      <StatCard
        title={`Open Loops`}
        className="mb-5 animate-fade-in-up"
      >
        <div className="flex gap-3 mb-3">
          <span className="font-mono text-micro text-ax-text-tertiary">{openCount} open</span>
          {doneCount > 0 && (
            <span className="font-mono text-micro text-ax-success">{doneCount} done</span>
          )}
        </div>
        <div className="space-y-2">
          {state.openLoops.map((loop, i) => (
            <div key={i} className="flex gap-2.5 text-body">
              <span className={`shrink-0 mt-0.5 ${loop.checked ? 'text-ax-success' : 'text-ax-text-tertiary'}`}>
                {loop.checked ? '✓' : '○'}
              </span>
              <span className={loop.checked ? 'line-through text-ax-text-tertiary' : 'text-ax-text-secondary leading-relaxed'}>
                {renderInline(loop.text)}
              </span>
            </div>
          ))}
          {state.openLoops.length === 0 && (
            <p className="text-small text-ax-text-tertiary italic">No open loops tracked</p>
          )}
        </div>
      </StatCard>

      {/* Workstreams — full width table */}
      {state.workstreams.length > 0 && (
        <StatCard title="Workstreams" className="mb-5 animate-fade-in-up">
          <div className="space-y-0">
            {state.workstreams.map((ws, i) => (
              <div key={i} className="flex items-baseline gap-4 py-2.5 border-b border-ax-border-subtle last:border-0">
                <span className="text-body text-ax-text-primary font-medium w-36 shrink-0">{ws.name}</span>
                <span className="text-small text-ax-text-secondary leading-relaxed">
                  {renderInline(ws.status)}
                </span>
              </div>
            ))}
          </div>
        </StatCard>
      )}

      {/* Key Files — full width */}
      {state.keyFiles.length > 0 && (
        <StatCard title="Key Files" className="mb-5 animate-fade-in-up">
          <div className="space-y-0">
            {state.keyFiles.map((kf, i) => (
              <div key={i} className="flex items-baseline gap-4 py-2 border-b border-ax-border-subtle last:border-0">
                <code className="font-mono text-small text-ax-brand shrink-0">
                  {kf.file}
                </code>
                <span className="text-small text-ax-text-secondary">{kf.purpose}</span>
              </div>
            ))}
          </div>
        </StatCard>
      )}

      {/* Recent Timeline — full width */}
      {state.recentTimeline.length > 0 && (
        <StatCard title="Recent Timeline" className="animate-fade-in-up">
          <div className="space-y-0">
            {state.recentTimeline.map((entry, i) => (
              <div key={i} className="flex items-baseline gap-4 py-2.5 border-b border-ax-border-subtle last:border-0">
                <span className="font-mono text-small text-ax-text-tertiary shrink-0 w-24">{entry.date}</span>
                <span className="text-small text-ax-text-secondary leading-relaxed">{renderInline(entry.text)}</span>
              </div>
            ))}
          </div>
        </StatCard>
      )}
    </div>
  )
}

/** Render inline markdown: **bold**, `code`, and strip stray asterisks */
function renderInline(text: string): React.ReactNode {
  // Split on **bold** patterns — handle both **text** and stray *text*
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-ax-text-primary font-medium">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="font-mono text-small bg-ax-sunken px-1 py-0.5 rounded">{part.slice(1, -1)}</code>
    }
    return <span key={i}>{part}</span>
  })
}
