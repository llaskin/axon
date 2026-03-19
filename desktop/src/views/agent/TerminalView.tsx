import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { RotateCcw } from 'lucide-react'
import { useTerminalSession } from './useTerminalSession'

/* ── Resolve xterm theme from Axon CSS vars ────────────────────── */

function resolveTerminalTheme(): Record<string, string> {
  const s = getComputedStyle(document.documentElement)
  const get = (prop: string, fallback: string) =>
    s.getPropertyValue(prop).trim() || fallback

  return {
    background: get('--ax-bg-sunken', '#1a1915'),
    foreground: get('--ax-text-primary', '#e8e4dc'),
    cursor: get('--ax-brand-primary', '#C8956C'),
    cursorAccent: get('--ax-bg-sunken', '#1a1915'),
    selectionBackground: 'rgba(200, 149, 108, 0.3)',
    black: get('--ax-bg-sunken', '#1a1915'),
    red: get('--ax-error', '#B85450'),
    green: get('--ax-success', '#7B9E7B'),
    yellow: get('--ax-warning', '#C4933B'),
    blue: get('--ax-info', '#6B8FAD'),
    magenta: '#b87fd9',
    cyan: '#5cc8c8',
    white: get('--ax-text-primary', '#e8e4dc'),
    brightBlack: get('--ax-text-ghost', '#6b6560'),
    brightRed: '#d4706c',
    brightGreen: '#93b893',
    brightYellow: '#d4a84d',
    brightBlue: '#85a9c3',
    brightMagenta: '#c993e8',
    brightCyan: '#6bd9d9',
    brightWhite: '#ffffff',
  }
}

/* ── TerminalView component ────────────────────────────────────── */

interface TerminalViewProps {
  project: string
  resumeSessionId?: string | null
  onClearResume?: () => void
  onSessionActive?: (active: boolean) => void
  onFileReferenceHandler?: (handler: (path: string) => void) => void
}

export function TerminalView({
  project,
  resumeSessionId,
  onClearResume,
  onSessionActive,
  onFileReferenceHandler,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const spawnedRef = useRef(false)

  const { terminalId, status, exitCode, spawn, sendInput, sendResize, kill, onData } =
    useTerminalSession()

  // Register data handler: PTY output → xterm.write
  useEffect(() => {
    onData((data: string) => {
      xtermRef.current?.write(data)
    })
  }, [onData])

  // Expose sendInput for FileTree @ references
  useEffect(() => {
    if (onFileReferenceHandler) {
      onFileReferenceHandler((path: string) => sendInput(`@${path} `))
    }
  }, [onFileReferenceHandler, sendInput])

  // Report session status
  useEffect(() => {
    onSessionActive?.(status === 'connected' || status === 'spawning' || status === 'connecting')
  }, [status, onSessionActive])

  // Initialize xterm once
  useEffect(() => {
    if (!containerRef.current || xtermRef.current) return

    const theme = resolveTerminalTheme()
    const term = new XTerm({
      fontFamily: "'Berkeley Mono', 'SF Mono', 'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar' as const,
      theme,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)

    fitAddon.fit()
    const t1 = setTimeout(() => fitAddon.fit(), 50)
    const t2 = setTimeout(() => fitAddon.fit(), 200)

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      term.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  // Theme sync on data-theme change
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (xtermRef.current) {
        xtermRef.current.options.theme = resolveTerminalTheme()
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  // ResizeObserver
  const fit = useCallback(() => {
    if (fitAddonRef.current && containerRef.current?.offsetHeight) {
      try {
        fitAddonRef.current.fit()
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims) sendResize(dims.cols, dims.rows)
      } catch { /* not visible */ }
    }
  }, [sendResize])

  useEffect(() => {
    let raf: number
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(fit)
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => { cancelAnimationFrame(raf); observer.disconnect() }
  }, [fit])

  // Wire xterm input → WebSocket when connected
  useEffect(() => {
    const term = xtermRef.current
    if (!term || !terminalId || status !== 'connected') return

    const disposable = term.onData((data) => sendInput(data))
    fit()
    return () => disposable.dispose()
  }, [terminalId, status, sendInput, fit])

  // Handle resume requests — if a terminal is already running, restart it with the resume ID
  const lastResumeRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resumeSessionId || resumeSessionId === lastResumeRef.current) return
    lastResumeRef.current = resumeSessionId

    if (spawnedRef.current) {
      // Terminal already running — restart with resume
      kill()
      spawnedRef.current = false
      setTimeout(() => {
        spawnedRef.current = true
        spawn(project, resumeSessionId)
        onClearResume?.()
      }, 200)
    }
  }, [resumeSessionId, project, spawn, kill, onClearResume])

  // Auto-spawn on mount
  useEffect(() => {
    if (spawnedRef.current || !project || status !== 'idle') return
    spawnedRef.current = true
    spawn(project, resumeSessionId || undefined)
    if (resumeSessionId) {
      onClearResume?.()
    }
  }, [project, resumeSessionId, status, spawn, onClearResume])

  const handleRestart = useCallback(() => {
    kill()
    spawnedRef.current = false
    setTimeout(() => {
      spawnedRef.current = true
      spawn(project)
    }, 100)
  }, [kill, spawn, project])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Status indicators */}
      {(status === 'spawning' || status === 'connecting') && (
        <div className="shrink-0 px-4 py-1 bg-ax-sunken border-b border-ax-border-subtle">
          <span className="font-mono text-[10px] text-ax-text-tertiary animate-pulse">
            {status === 'spawning' ? 'Starting terminal...' : 'Connecting...'}
          </span>
        </div>
      )}
      {status === 'error' && (
        <div className="shrink-0 px-4 py-1 bg-ax-error-subtle border-b border-ax-error/20 flex items-center gap-2">
          <span className="font-mono text-[10px] text-ax-error">
            Terminal connection lost
          </span>
          <button
            onClick={handleRestart}
            className="font-mono text-[10px] text-ax-text-secondary hover:text-ax-text-primary
              flex items-center gap-1 transition-colors"
          >
            <RotateCcw size={9} /> Reconnect
          </button>
        </div>
      )}
      {status === 'exited' && (
        <div className="shrink-0 px-4 py-1 bg-ax-sunken border-b border-ax-border-subtle flex items-center gap-2">
          <span className="font-mono text-[10px] text-ax-text-tertiary">
            Process exited{exitCode != null ? ` (code ${exitCode})` : ''}
          </span>
          <button
            onClick={handleRestart}
            className="font-mono text-[10px] text-ax-text-secondary hover:text-ax-text-primary
              flex items-center gap-1 transition-colors"
          >
            <RotateCcw size={9} /> New terminal
          </button>
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0"
        style={{ padding: '8px 4px 4px 8px' }}
      />
    </div>
  )
}
