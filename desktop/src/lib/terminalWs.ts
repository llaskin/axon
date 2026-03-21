import type { WebSocketServer, WebSocket } from 'ws'
import {
  getTerminal,
  setWsConnected,
  killTerminal,
  resizeTerminal,
  consumeEarlyState,
} from './terminalManager'

const PING_INTERVAL = 10_000 // 10s — well under any idle timeout

export function setupTerminalWs(wss: WebSocketServer): void {
  // Server-side ping interval — keeps connections alive and detects dead clients
  const aliveMap = new WeakMap<WebSocket, boolean>()

  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!aliveMap.get(ws)) {
        // Missed the last pong — connection is dead
        ws.terminate()
        continue
      }
      aliveMap.set(ws, false)
      ws.ping()
    }
  }, PING_INTERVAL)

  wss.on('close', () => clearInterval(pingTimer))

  wss.on('connection', (ws: WebSocket, _req: unknown, termId: string) => {
    const instance = getTerminal(termId)
    if (!instance) {
      ws.close(1008, 'Terminal not found')
      return
    }

    // Mark alive for ping/pong keepalive
    aliveMap.set(ws, true)
    ws.on('pong', () => aliveMap.set(ws, true))

    setWsConnected(termId, true)

    // Replay early buffer (output that arrived before WS connected)
    const { buffer, pendingCmd } = consumeEarlyState(termId)
    for (const chunk of buffer) {
      if (ws.readyState === ws.OPEN) ws.send(chunk)
    }

    // Now write the pending command (deferred from spawn)
    if (pendingCmd) {
      setTimeout(() => {
        instance.pty.write(pendingCmd + '\n')
      }, 300) // small delay for shell profile to finish loading
    }

    // PTY output → WebSocket (live from now on)
    const dataHandler = instance.pty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data)
      }
    })

    // PTY exit → WebSocket
    const exitHandler = instance.pty.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode }))
        ws.close(1000, 'Process exited')
      }
      killTerminal(termId)
    })

    // WebSocket messages → PTY
    ws.on('message', (data: Buffer | string) => {
      const msg = data.toString()
      // Check for JSON control messages (resize)
      if (msg.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg)
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            resizeTerminal(termId, parsed.cols, parsed.rows)
            return
          }
        } catch {
          // Not JSON — treat as raw input
        }
      }
      // Raw terminal input
      instance.pty.write(msg)
    })

    // WebSocket close → mark disconnected (heartbeat cleans up after 60s)
    ws.on('close', () => {
      dataHandler.dispose()
      exitHandler.dispose()
      setWsConnected(termId, false)
    })

    ws.on('error', () => {
      setWsConnected(termId, false)
    })
  })
}
