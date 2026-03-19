import * as pty from 'node-pty'
import { execSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

const LOG_FILE = join(process.env.HOME || '/tmp', '.axon', 'terminal-debug.log')
function debugLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { appendFileSync(LOG_FILE, line) } catch { /* ignore */ }
  console.log(msg)
}

interface TerminalInstance {
  pty: pty.IPty
  id: string
  cwd: string
  createdAt: number
  wsConnected: boolean
}

const terminals = new Map<string, TerminalInstance>()
let counter = 0
let heartbeatInterval: ReturnType<typeof setInterval> | null = null

// Resolve the user's full login shell PATH once at import time
// Electron's sandboxed PATH doesn't include nvm/brew/etc paths
let resolvedPath = process.env.PATH || ''
try {
  const shell = process.env.SHELL || '/bin/zsh'
  // Use -lc (login, non-interactive) + printenv to get clean PATH
  // Avoids macOS "Restored session:" messages from -i flag
  resolvedPath = execSync(`${shell} -lc 'printenv PATH'`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000,
  }).trim()
} catch { /* fall back to process.env.PATH */ }

export function getResolvedPath(): string {
  return resolvedPath
}

export function startHeartbeat(): void {
  if (heartbeatInterval) return
  heartbeatInterval = setInterval(cleanStale, 30_000)
}

export function spawnTerminal(cwd: string, command?: string, sessionId?: string): string {
  const id = `term-${++counter}-${Date.now()}`
  const shell = process.env.SHELL || '/bin/zsh'

  // Determine the command to run inside the shell
  // Note: `command` parameter is ignored for security — only allow claude or claude --resume
  let cmd: string
  if (sessionId) {
    cmd = `claude --resume ${sessionId}`
  } else {
    cmd = 'claude'
  }

  // Clean env: remove CLAUDECODE to prevent nested session guard
  const cleanEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDECODE' && k !== 'CLAUDE_CODE_SESSION' && v != null) {
      cleanEnv[k] = v
    }
  }
  cleanEnv.PATH = resolvedPath
  cleanEnv.TERM = 'xterm-256color'
  cleanEnv.COLORTERM = 'truecolor'

  try {
    debugLog(`[Axon Terminal] Spawning: shell=${shell} cmd="${cmd}" cwd=${cwd}`)
    debugLog(`[Axon Terminal] PATH (first 200 chars): ${cleanEnv.PATH?.slice(0, 200)}`)

    const ptyProcess = pty.spawn(shell, ['-il'], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: cleanEnv,
    })

    // Log all output and exit for debugging
    let earlyOutput = ''
    const earlyListener = ptyProcess.onData((data: string) => {
      earlyOutput += data
      if (earlyOutput.length > 5000) earlyListener.dispose()
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      debugLog(`[Axon Terminal] PTY ${id} exited: code=${exitCode} signal=${signal}`)
      debugLog(`[Axon Terminal] Full output (${earlyOutput.length} chars): ${earlyOutput.slice(0, 2000)}`)
    })

    // Write the command after a short delay to let shell profile load
    setTimeout(() => {
      ptyProcess.write(cmd + '\n')
    }, 500)

    terminals.set(id, {
      pty: ptyProcess,
      id,
      cwd,
      createdAt: Date.now(),
      wsConnected: false,
    })

    startHeartbeat()
    return id
  } catch (err) {
    debugLog(`[Axon Terminal] Failed to spawn PTY: ${err}`)
    throw err
  }
}

export function hasTerminal(id: string): boolean {
  return terminals.has(id)
}

export function getTerminal(id: string): TerminalInstance | undefined {
  return terminals.get(id)
}

export function setWsConnected(id: string, connected: boolean): void {
  const t = terminals.get(id)
  if (t) t.wsConnected = connected
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  terminals.get(id)?.pty.resize(cols, rows)
}

export function killTerminal(id: string): void {
  const t = terminals.get(id)
  if (t) {
    t.pty.kill()
    terminals.delete(id)
  }
}

export function killAllTerminals(): void {
  for (const [, t] of terminals) {
    t.pty.kill()
  }
  terminals.clear()
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }
}

function cleanStale(): void {
  const now = Date.now()
  for (const [id, t] of terminals) {
    // Kill terminals disconnected for >60s (but give 10s for initial connection)
    if (!t.wsConnected && now - t.createdAt > 60_000) {
      console.log(`[Axon Terminal] Cleaning stale terminal ${id}`)
      t.pty.kill()
      terminals.delete(id)
    }
  }
}
