import { useState, useEffect, useCallback } from 'react'
import { Loader2, Check, AlertCircle, ArrowRight } from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'

export function GenesisProgressView() {
  const activeProject = useProjectStore(s => s.activeProject)
  const setProjects = useProjectStore(s => s.setProjects)
  const setView = useUIStore(s => s.setView)
  const [status, setStatus] = useState<'running' | 'complete' | 'failed' | 'none'>('running')
  const [error, setError] = useState<string | undefined>()
  const [elapsed, setElapsed] = useState(0)

  const poll = useCallback(async () => {
    if (!activeProject) return
    try {
      const res = await fetch(`/api/axon/init-status?project=${encodeURIComponent(activeProject)}`)
      if (!res.ok) return
      const data = await res.json()
      setStatus(data.status)
      if (data.error) setError(data.error)

      if (data.status === 'complete') {
        // Refresh projects and go to timeline
        const projRes = await fetch('/api/axon/projects')
        if (projRes.ok) {
          setProjects(await projRes.json())
        }
        setTimeout(() => setView('timeline'), 500)
      }
    } catch {}
  }, [activeProject, setProjects, setView])

  useEffect(() => {
    poll()
    const interval = setInterval(poll, 3000)
    return () => clearInterval(interval)
  }, [poll])

  useEffect(() => {
    const interval = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-md w-full">
        <div className="bg-ax-elevated rounded-2xl border border-ax-border p-8 shadow-sm">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            {status === 'running' && (
              <Loader2 size={24} className="text-ax-brand animate-spin" />
            )}
            {status === 'complete' && (
              <Check size={24} className="text-ax-accent" />
            )}
            {status === 'failed' && (
              <AlertCircle size={24} className="text-ax-error" />
            )}
            <div>
              <h2 className="font-serif italic text-h3 text-ax-text-primary">
                {status === 'running' && `Initializing ${activeProject}`}
                {status === 'complete' && 'Genesis complete'}
                {status === 'failed' && 'Genesis failed'}
              </h2>
            </div>
          </div>

          {/* Description */}
          {status === 'running' && (
            <p className="text-small text-ax-text-secondary mb-6">
              Axon is reading your project's history and composing its genesis rollup. This usually takes 1–2 minutes.
            </p>
          )}

          {/* Progress steps */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2.5">
              <Check size={14} className="text-ax-accent shrink-0" />
              <span className="font-mono text-micro text-ax-text-secondary">Workspace created</span>
            </div>
            <div className="flex items-center gap-2.5">
              {status === 'running' ? (
                <Loader2 size={14} className="text-ax-brand animate-spin shrink-0" />
              ) : status === 'complete' ? (
                <Check size={14} className="text-ax-accent shrink-0" />
              ) : (
                <AlertCircle size={14} className="text-ax-error shrink-0" />
              )}
              <span className="font-mono text-micro text-ax-text-secondary">
                {status === 'running' ? 'Running genesis rollup...' : status === 'complete' ? 'Genesis rollup complete' : 'Genesis rollup failed'}
              </span>
            </div>
          </div>

          {/* Timer */}
          {status === 'running' && (
            <div className="font-mono text-micro text-ax-text-tertiary">
              {formatTime(elapsed)}
            </div>
          )}

          {/* Error */}
          {status === 'failed' && error && (
            <div className="bg-ax-sunken rounded-lg px-4 py-3 mb-4">
              <p className="font-mono text-micro text-ax-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6">
            {status === 'running' && (
              <button
                onClick={() => setView('terminal')}
                className="font-mono text-micro text-ax-text-tertiary hover:text-ax-text-secondary transition-colors"
              >
                Open Terminal
              </button>
            )}
            {status === 'complete' && (
              <button
                onClick={() => setView('timeline')}
                className="flex items-center gap-2 font-mono text-micro px-4 py-2 rounded-lg bg-ax-brand text-white hover:opacity-90 transition-opacity"
              >
                View Timeline
                <ArrowRight size={12} />
              </button>
            )}
            {status === 'failed' && (
              <button
                onClick={() => setView('onboarding')}
                className="font-mono text-micro px-4 py-2 rounded-lg border border-ax-border text-ax-text-secondary hover:bg-ax-sunken transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
