import { useEffect, useRef, useCallback } from 'react'
import { X, Minimize2 } from 'lucide-react'
import { useTerminalStore } from '@/store/terminalStore'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#1a1714',
  foreground: '#e8e0d8',
  cursor: '#C8956C',
  cursorAccent: '#1a1714',
  selectionBackground: '#C8956C44',
  black: '#2C2420',
  red: '#d9534f',
  green: '#5cb85c',
  yellow: '#f0ad4e',
  blue: '#5bc0de',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#e8e0d8',
  brightBlack: '#6b5d53',
  brightRed: '#e87c78',
  brightGreen: '#80d080',
  brightYellow: '#ffd080',
  brightBlue: '#80d4f0',
  brightMagenta: '#d9a0ee',
  brightCyan: '#6bd9d9',
  brightWhite: '#ffffff',
}

interface Props {
  terminalId: string
  onClose: () => void
}

export function FullscreenTerminal({ terminalId, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const attach = useTerminalStore(s => s.attach)
  const detach = useTerminalStore(s => s.detach)
  const sendInput = useTerminalStore(s => s.sendInput)
  const sendResize = useTerminalStore(s => s.sendResize)

  const doFit = useCallback(() => {
    const fit = fitRef.current
    const term = xtermRef.current
    if (!fit || !term) return
    requestAnimationFrame(() => {
      fit.fit()
      sendResize(terminalId, term.cols, term.rows)
    })
  }, [terminalId, sendResize])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      theme: THEME,
      fontFamily: '"Berkeley Mono", "JetBrains Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      scrollback: 5000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    xtermRef.current = term
    fitRef.current = fit

    // Fit after mount
    requestAnimationFrame(() => {
      fit.fit()
      sendResize(terminalId, term.cols, term.rows)
    })

    // Wire input
    const inputDisposable = term.onData(data => sendInput(terminalId, data))

    // Wire output
    const listener = (data: string) => term.write(data)
    attach(terminalId, listener)

    // Resize on viewport change (keyboard appear/disappear, orientation)
    const handleResize = () => {
      requestAnimationFrame(() => {
        fit.fit()
        sendResize(terminalId, term.cols, term.rows)
      })
    }
    window.visualViewport?.addEventListener('resize', handleResize)
    window.addEventListener('resize', handleResize)
    // Delayed refit for orientation change settling
    const orientationHandler = () => setTimeout(handleResize, 300)
    window.addEventListener('orientationchange', orientationHandler)

    // Focus terminal for keyboard input
    setTimeout(() => term.focus(), 100)

    return () => {
      inputDisposable.dispose()
      detach(terminalId, listener)
      window.visualViewport?.removeEventListener('resize', handleResize)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', orientationHandler)
      term.dispose()
    }
  }, [terminalId, attach, detach, sendInput, sendResize])

  // Tap terminal container to focus (opens mobile keyboard)
  const handleTerminalTap = useCallback(() => {
    xtermRef.current?.focus()
    // On iOS, we need to explicitly focus the hidden textarea
    const textarea = containerRef.current?.querySelector('textarea')
    if (textarea) {
      textarea.focus()
      textarea.click()
    }
  }, [])

  // Refit when component is visible (e.g. after animation)
  useEffect(() => {
    const t = setTimeout(doFit, 400)
    return () => clearTimeout(t)
  }, [doFit])

  return (
    <div className="fixed inset-0 z-[80] bg-[#1a1714] flex flex-col safe-area-top safe-area-bottom animate-fade-in">
      {/* Header — z-10 above terminal to receive taps */}
      <div
        className="flex items-center justify-between px-4 py-2 bg-[#231f1b] border-b border-white/10 min-h-[48px] relative z-10"
        onTouchStart={e => e.stopPropagation()}
      >
        <span className="font-mono text-[11px] text-white/60 truncate">
          Terminal · {terminalId.slice(0, 12)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            onTouchEnd={(e) => { e.preventDefault(); onClose() }}
            className="p-3 min-w-[48px] min-h-[48px] flex items-center justify-center text-white/50 active:text-white transition-colors rounded-lg active:bg-white/10"
            aria-label="Minimize terminal"
          >
            <Minimize2 size={18} />
          </button>
          <button
            onClick={onClose}
            onTouchEnd={(e) => { e.preventDefault(); onClose() }}
            className="p-3 min-w-[48px] min-h-[48px] flex items-center justify-center text-white/50 active:text-white transition-colors rounded-lg active:bg-white/10"
            aria-label="Close terminal"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Terminal — tap to focus/open keyboard */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        onClick={handleTerminalTap}
        onTouchEnd={handleTerminalTap}
      />
    </div>
  )
}
