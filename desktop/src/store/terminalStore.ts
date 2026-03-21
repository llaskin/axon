import { create } from 'zustand'
import { getStoredToken } from '@/lib/apiClient'

export type TerminalStatus = 'spawning' | 'connecting' | 'connected' | 'exited' | 'error'

export interface TerminalEntry {
  terminalId: string
  sessionId: string | null
  project: string
  status: TerminalStatus
  exitCode: number | null
}

// Internal state kept outside Zustand for mutable refs (WS, listeners, data buffer)
interface TerminalInternal {
  ws: WebSocket | null
  dataListeners: Set<(data: string) => void>
  buffer: string[]       // ring buffer of terminal output for replay on reattach
  bufferBytes: number    // total bytes in buffer
}

const MAX_BUFFER_BYTES = 512 * 1024 // 512KB per terminal

const internals = new Map<string, TerminalInternal>()

function getInternal(terminalId: string): TerminalInternal {
  let int = internals.get(terminalId)
  if (!int) {
    int = { ws: null, dataListeners: new Set(), buffer: [], bufferBytes: 0 }
    internals.set(terminalId, int)
  }
  return int
}

function bufferData(int: TerminalInternal, data: string) {
  int.buffer.push(data)
  int.bufferBytes += data.length
  // Evict oldest chunks when over limit
  while (int.bufferBytes > MAX_BUFFER_BYTES && int.buffer.length > 1) {
    const evicted = int.buffer.shift()!
    int.bufferBytes -= evicted.length
  }
}

interface TerminalStore {
  terminals: Record<string, TerminalEntry>

  // Canvas terminal state — survives view switches
  canvasTerminals: Record<string, string>   // sessionId → terminalId (live terminals)
  canvasExpanded: Record<string, 'expanded' | 'minimized'>   // sessionId → visual state

  spawn: (project: string, sessionId?: string) => Promise<string>
  attach: (terminalId: string, listener: (data: string) => void) => void
  detach: (terminalId: string, listener: (data: string) => void) => void
  sendInput: (terminalId: string, data: string) => void
  sendResize: (terminalId: string, cols: number, rows: number) => void
  kill: (terminalId: string) => void

  // Canvas terminal lifecycle
  expandCanvasTile: (sessionId: string, terminalId: string) => void
  minimizeCanvasTile: (sessionId: string) => void
  killCanvasTerminal: (sessionId: string) => void
  setTileExpanded: (sessionId: string, expanded: boolean) => void
  replaceCanvasSessionId: (oldId: string, newId: string) => void
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},
  canvasTerminals: {} as Record<string, string>,
  canvasExpanded: {} as Record<string, 'expanded' | 'minimized'>,

  spawn: async (project, sessionId) => {
    const res = await fetch('/api/axon/terminal/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, sessionId: sessionId || null }),
    })
    if (!res.ok) throw new Error(`Spawn failed: ${res.status}`)

    const { terminalId } = await res.json()
    const int = getInternal(terminalId)

    // Add entry
    set(s => ({
      terminals: {
        ...s.terminals,
        [terminalId]: {
          terminalId,
          sessionId: sessionId || null,
          project,
          status: 'connecting',
          exitCode: null,
        },
      },
    }))

    // Open WebSocket (include auth token for remote connections)
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const token = getStoredToken()
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`${protocol}//${location.host}/api/axon/terminal/ws?id=${terminalId}${tokenParam}`)
    int.ws = ws

    ws.onopen = () => {
      set(s => {
        const entry = s.terminals[terminalId]
        if (!entry) return s
        return { terminals: { ...s.terminals, [terminalId]: { ...entry, status: 'connected' } } }
      })
    }

    ws.onmessage = (event) => {
      const data = event.data as string
      if (data.startsWith('{')) {
        try {
          const msg = JSON.parse(data)
          if (msg.type === 'exit') {
            set(s => {
              const entry = s.terminals[terminalId]
              if (!entry) return s
              return { terminals: { ...s.terminals, [terminalId]: { ...entry, status: 'exited', exitCode: msg.exitCode } } }
            })
            return
          }
        } catch { /* not JSON */ }
      }
      // Buffer data for replay on reattach, then broadcast
      const int2 = internals.get(terminalId)
      if (int2) {
        bufferData(int2, data)
        for (const fn of int2.dataListeners) fn(data)
      }
    }

    ws.onerror = () => {
      set(s => {
        const entry = s.terminals[terminalId]
        if (!entry) return s
        return { terminals: { ...s.terminals, [terminalId]: { ...entry, status: 'error' } } }
      })
    }

    ws.onclose = (event) => {
      set(s => {
        const entry = s.terminals[terminalId]
        if (!entry || entry.status === 'exited') return s
        return { terminals: { ...s.terminals, [terminalId]: { ...entry, status: 'error' } } }
      })
      const i = internals.get(terminalId)
      if (i) i.ws = null
      if (event.code !== 1000) {
        console.log(`[TerminalStore WS] Closed: code=${event.code}`)
      }
    }

    return terminalId
  },

  attach: (terminalId, listener) => {
    const int = getInternal(terminalId)
    // Replay buffered output so reattached XTerm gets full history
    if (int.buffer.length > 0) {
      for (const chunk of int.buffer) listener(chunk)
    }
    int.dataListeners.add(listener)
  },

  detach: (terminalId, listener) => {
    internals.get(terminalId)?.dataListeners.delete(listener)
  },

  sendInput: (terminalId, data) => {
    const ws = internals.get(terminalId)?.ws
    if (ws?.readyState === WebSocket.OPEN) ws.send(data)
  },

  sendResize: (terminalId, cols, rows) => {
    const ws = internals.get(terminalId)?.ws
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  },

  kill: (terminalId) => {
    const int = internals.get(terminalId)
    if (int) {
      int.ws?.close()
      int.ws = null
      int.dataListeners.clear()
      internals.delete(terminalId)
    }
    // Kill PTY on backend
    fetch(`/api/axon/terminal/${terminalId}`, { method: 'DELETE' }).catch(() => {})
    // Remove from state
    set(s => {
      const { [terminalId]: _, ...rest } = s.terminals
      return { terminals: rest }
    })
  },

  // Canvas terminal lifecycle
  expandCanvasTile: (sessionId, terminalId) => set(s => ({
    canvasTerminals: { ...s.canvasTerminals, [sessionId]: terminalId },
    canvasExpanded: { ...s.canvasExpanded, [sessionId]: 'expanded' as const },
  })),

  minimizeCanvasTile: (sessionId) => set(s => ({
    canvasExpanded: { ...s.canvasExpanded, [sessionId]: 'minimized' as const },
  })),

  killCanvasTerminal: (sessionId) => {
    const termId = get().canvasTerminals[sessionId]
    if (termId) {
      // Cleanup WebSocket + PTY (side effects only, no state update)
      const int = internals.get(termId)
      if (int) { int.ws?.close(); int.ws = null; int.dataListeners.clear(); internals.delete(termId) }
      fetch(`/api/axon/terminal/${termId}`, { method: 'DELETE' }).catch(() => {})
    }
    // Single atomic state update
    set(s => {
      const { [sessionId]: _t, ...restCanvas } = s.canvasTerminals
      const { [sessionId]: _e, ...restExpanded } = s.canvasExpanded
      const newTerminals = termId
        ? (({ [termId]: _, ...rest }: typeof s.terminals) => rest)(s.terminals)
        : s.terminals
      return { terminals: newTerminals, canvasTerminals: restCanvas, canvasExpanded: restExpanded }
    })
  },

  setTileExpanded: (sessionId, expanded) => set(s => {
    if (expanded) {
      return { canvasExpanded: { ...s.canvasExpanded, [sessionId]: 'expanded' as const } }
    }
    const { [sessionId]: _, ...rest } = s.canvasExpanded
    return { canvasExpanded: rest }
  }),

  replaceCanvasSessionId: (oldId, newId) => set(s => {
    const termId = s.canvasTerminals[oldId]
    const expandState = s.canvasExpanded[oldId]
    if (!termId) return s
    const { [oldId]: _t, ...restCanvas } = s.canvasTerminals
    const { [oldId]: _e, ...restExpanded } = s.canvasExpanded
    return {
      canvasTerminals: { ...restCanvas, [newId]: termId },
      canvasExpanded: expandState ? { ...restExpanded, [newId]: expandState } : restExpanded,
    }
  }),
}))

/* ── Auto-reconnect WebSockets on tab visibility change (mobile background tabs) ── */

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return

    const state = useTerminalStore.getState()
    for (const [terminalId, entry] of Object.entries(state.terminals)) {
      if (entry.status !== 'error') continue
      const int = internals.get(terminalId)
      if (!int || int.ws?.readyState === WebSocket.OPEN) continue

      // Attempt reconnect
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const token = getStoredToken()
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : ''
      const ws = new WebSocket(`${protocol}//${location.host}/api/axon/terminal/ws?id=${terminalId}${tokenParam}`)
      int.ws = ws

      ws.onopen = () => {
        useTerminalStore.setState(s => {
          const e = s.terminals[terminalId]
          if (!e) return s
          return { terminals: { ...s.terminals, [terminalId]: { ...e, status: 'connected' } } }
        })
      }

      ws.onmessage = (event) => {
        const data = event.data as string
        if (data.startsWith('{')) {
          try {
            const msg = JSON.parse(data)
            if (msg.type === 'exit') {
              useTerminalStore.setState(s => {
                const e = s.terminals[terminalId]
                if (!e) return s
                return { terminals: { ...s.terminals, [terminalId]: { ...e, status: 'exited', exitCode: msg.exitCode } } }
              })
              return
            }
          } catch { /* not JSON */ }
        }
        bufferData(int, data)
        for (const fn of int.dataListeners) fn(data)
      }

      ws.onerror = () => {
        useTerminalStore.setState(s => {
          const e = s.terminals[terminalId]
          if (!e) return s
          return { terminals: { ...s.terminals, [terminalId]: { ...e, status: 'error' } } }
        })
      }

      ws.onclose = () => {
        int.ws = null
      }
    }
  })
}
