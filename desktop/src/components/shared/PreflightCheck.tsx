import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, AlertTriangle, X, Loader2, Terminal, Download, ExternalLink, RefreshCw } from 'lucide-react'
import { useDebugStore } from '@/store/debugStore'

const STORAGE_KEY = 'axon-preflight-passed'

interface PreflightItem {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  action?: string
  actionType?: string
}

export function PreflightCheck({ forceVisible, onDismiss }: { forceVisible?: boolean; onDismiss?: () => void } = {}) {
  const [visible, setVisible] = useState(() => forceVisible || !localStorage.getItem(STORAGE_KEY))
  const [checks, setChecks] = useState<PreflightItem[]>([])
  const [loading, setLoading] = useState(true)
  const [fading, setFading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionRunning, setActionRunning] = useState<string | null>(null)

  const dismiss = useCallback(() => {
    if (!forceVisible) localStorage.setItem(STORAGE_KEY, '1')
    setFading(true)
    setTimeout(() => {
      setVisible(false)
      onDismiss?.()
    }, 800)
  }, [forceVisible, onDismiss])

  const manualRef = useRef(false)

  const show = useCallback(() => {
    manualRef.current = true
    setFading(false)
    setFetchError(null)
    setVisible(true)
  }, [])

  // Register debug action
  const register = useDebugStore(s => s.register)
  const unregister = useDebugStore(s => s.unregister)

  useEffect(() => {
    register({
      id: 'show-preflight',
      label: 'System Check',
      active: visible,
      toggle: () => {
        if (visible) dismiss()
        else show()
      },
    })
    return () => unregister('show-preflight')
  }, [register, unregister, visible, dismiss, show])

  // Allow Settings to trigger visibility
  useEffect(() => {
    if (forceVisible && !visible) {
      show()
    }
  }, [forceVisible, visible, show])

  const runChecks = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/axon/preflight')
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const data = await res.json()
      setChecks(data.checks || [])
      // Auto-dismiss on first launch if everything passes (not when manually triggered)
      if (data.ok && !manualRef.current) {
        localStorage.setItem(STORAGE_KEY, '1')
        setFading(true)
        setTimeout(() => setVisible(false), 800)
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to run checks')
      setChecks([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) runChecks()
  }, [visible, runChecks])

  const handleAction = useCallback(async (item: PreflightItem) => {
    if (!item.actionType) return

    // URL actions open in browser
    if (item.actionType.startsWith('open-url:')) {
      const url = item.actionType.slice('open-url:'.length)
      window.open(url, '_blank')
      return
    }

    // npm actions run on server
    if (item.actionType === 'install-cli' || item.actionType === 'update-cli') {
      setActionRunning(item.id)
      try {
        const res = await fetch('/api/axon/preflight/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actionType: item.actionType }),
        })
        const data = await res.json()
        if (!data.ok) throw new Error(data.error || 'Action failed')
        // Show success message, then re-run checks
        if (data.message) {
          setChecks(prev => prev.map(c =>
            c.id === item.id
              ? { ...c, detail: data.message, status: 'pass' as const, action: undefined, actionType: undefined }
              : c
          ))
        }
        // Re-run checks after a brief delay so user sees the message
        setTimeout(() => runChecks(), 1500)
      } catch (err) {
        // Update the check to show the error
        setChecks(prev => prev.map(c =>
          c.id === item.id
            ? { ...c, detail: err instanceof Error ? err.message : 'Action failed', status: 'fail' as const }
            : c
        ))
      } finally {
        setActionRunning(null)
      }
    }
  }, [runChecks])

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
          ) : fetchError ? (
            <div className="px-4 py-8 text-center">
              <X size={20} className="text-[var(--ax-error)] mx-auto mb-2" />
              <p className="text-body text-ax-text-primary font-medium mb-1">Failed to run checks</p>
              <p className="font-mono text-micro text-ax-text-tertiary">{fetchError}</p>
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
                    {c.action && c.status !== 'pass' && c.actionType && (
                      <button
                        onClick={() => handleAction(c)}
                        disabled={actionRunning === c.id}
                        className="inline-flex items-center gap-1.5 mt-1 font-mono text-micro
                          text-ax-brand hover:text-ax-brand-hover transition-colors
                          disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionRunning === c.id ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : c.actionType.startsWith('open-url:') ? (
                          <ExternalLink size={10} />
                        ) : c.actionType === 'install-cli' ? (
                          <Download size={10} />
                        ) : (
                          <RefreshCw size={10} />
                        )}
                        {actionRunning === c.id ? 'Running...' : c.action}
                      </button>
                    )}
                    {c.action && c.status !== 'pass' && !c.actionType && (
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
