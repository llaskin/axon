import { useState, useEffect, useCallback } from 'react'
import { Check, AlertTriangle, X, Loader2, Terminal } from 'lucide-react'

const STORAGE_KEY = 'axon-preflight-passed'

interface PreflightItem {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  action?: string
}

export function PreflightCheck() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY))
  const [checks, setChecks] = useState<PreflightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fading, setFading] = useState(false)

  const runChecks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/axon/preflight')
      const data = await res.json()
      setChecks(data.checks || [])
      // Auto-dismiss if everything passes
      if (data.ok) {
        localStorage.setItem(STORAGE_KEY, '1')
        setFading(true)
        setTimeout(() => setVisible(false), 800)
      }
    } catch {
      setChecks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) runChecks()
  }, [visible, runChecks])

  const dismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setFading(true)
    setTimeout(() => setVisible(false), 800)
  }, [])

  if (!visible) return null

  const hasFailures = checks.some(c => c.status === 'fail')

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-ax-base/95 backdrop-blur-sm"
      style={{
        opacity: fading ? 0 : 1,
        transition: 'opacity 800ms ease-in-out',
      }}
    >
      <div className="max-w-lg w-full mx-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-ax-brand/10 flex items-center justify-center">
            <Terminal size={18} className="text-ax-brand" />
          </div>
          <div>
            <h2 className="font-serif italic text-h3 text-ax-text-primary">System Check</h2>
            <p className="text-small text-ax-text-secondary">Checking prerequisites</p>
          </div>
        </div>

        <div className="bg-ax-elevated rounded-xl border border-ax-border overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-ax-text-ghost">
              <Loader2 size={16} className="animate-spin" />
              <span className="font-mono text-small">Running checks...</span>
            </div>
          ) : (
            <div className="divide-y divide-ax-border-subtle">
              {checks.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                  {c.status === 'pass' && <Check size={14} className="text-[var(--ax-success)] shrink-0" />}
                  {c.status === 'warn' && <AlertTriangle size={14} className="text-[var(--ax-warning)] shrink-0" />}
                  {c.status === 'fail' && <X size={14} className="text-[var(--ax-error)] shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-body text-ax-text-primary font-medium">{c.label}</span>
                      <span className="font-mono text-micro text-ax-text-ghost truncate">{c.detail}</span>
                    </div>
                    {c.action && c.status !== 'pass' && (
                      <p className="font-mono text-micro text-ax-text-tertiary mt-0.5">{c.action}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && (
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={runChecks}
              className="px-4 py-2 rounded-lg font-mono text-small
                text-ax-text-secondary hover:text-ax-text-primary
                border border-ax-border-subtle hover:border-ax-border
                transition-colors"
            >
              Re-check
            </button>
            <button
              onClick={dismiss}
              className={`px-6 py-2 rounded-lg font-mono text-small transition-colors ${
                hasFailures
                  ? 'bg-ax-sunken text-ax-text-secondary hover:bg-ax-border-subtle'
                  : 'bg-ax-brand text-white hover:bg-ax-brand-hover'
              }`}
            >
              {hasFailures ? 'Continue anyway' : 'Continue'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
