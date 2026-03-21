import { useEffect, useRef } from 'react'
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

    // Resize on viewport change (keyboard appear/disappear)
    const handleResize = () => {
      requestAnimationFrame(() => {
        fit.fit()
        sendResize(terminalId, term.cols, term.rows)
      })
    }
    window.visualViewport?.addEventListener('resize', handleResize)
    window.addEventListener('resize', handleResize)

    // Focus terminal
    setTimeout(() => term.focus(), 100)

    return () => {
      inputDisposable.dispose()
      detach(terminalId, listener)
      window.visualViewport?.removeEventListener('resize', handleResize)
      window.removeEventListener('resize', handleResize)
      term.dispose()
    }
  }, [terminalId, attach, detach, sendInput, sendResize])

  return (
    <div className="fixed inset-0 z-[80] bg-[#1a1714] flex flex-col safe-area-top safe-area-bottom animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#231f1b] border-b border-white/10 min-h-[44px]">
        <span className="font-mono text-[11px] text-white/60 truncate">
          Terminal · {terminalId.slice(0, 12)}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white/40 hover:text-white transition-colors"
            aria-label="Close fullscreen terminal"
          >
            <Minimize2 size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-white/40 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  )
}
