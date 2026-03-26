import { readdir, readFile } from 'fs/promises'
import { existsSync, writeFileSync, renameSync, mkdirSync, readFileSync, rmSync, watchFile, unwatchFile, realpathSync, statSync, lstatSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { spawn, execSync, execFileSync } from 'child_process'
import { hashSync, compareSync } from 'bcryptjs'

/* ── Discovery cache ── */
let discoveryCache: { repos: { name: string; path: string; remote: string; commitCount: number; lastActivity: string }[]; timestamp: number } | null = null
const DISCOVERY_CACHE_TTL = 60_000
import type { IncomingMessage, ServerResponse } from 'http'
// Terminal manager removed for security — no shell spawning
// import { spawnTerminal, hasTerminal, killTerminal, killAllTerminals } from '../lib/terminalManager'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/* ── Classify Claude stream-json messages into typed SSE events ── */

export interface AgentSSEEvent {
  kind: string
  id: string
  text?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolUseId?: string
  content?: string
  isError?: boolean
  sessionId?: string
  cost?: number
  usage?: { input_tokens: number; output_tokens: number }
  turns?: number
  duration?: number
}

export function classifyAgentMessage(msg: Record<string, unknown>): AgentSSEEvent[] {
  const events: AgentSSEEvent[] = []
  const type = msg.type as string
  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  if (type === 'assistant') {
    const message = msg.message as Record<string, unknown> | undefined
    const content = (message?.content || msg.content) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(content)) return events
    for (const block of content) {
      if (block.type === 'text') {
        events.push({ kind: 'text', id: `text-${uid()}`, text: block.text as string })
      } else if (block.type === 'thinking') {
        events.push({ kind: 'thinking', id: `think-${uid()}`, text: block.thinking as string })
      } else if (block.type === 'tool_use') {
        events.push({
          kind: 'tool_use', id: block.id as string,
          toolName: block.name as string,
          toolInput: block.input as Record<string, unknown>,
        })
      }
    }
  }

  if (type === 'user') {
    const message = msg.message as Record<string, unknown> | undefined
    const content = (message?.content || msg.content) as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(content)) return events
    for (const block of content) {
      if (block.type === 'tool_result') {
        let resultText = ''
        if (typeof block.content === 'string') {
          resultText = block.content
        } else if (Array.isArray(block.content)) {
          resultText = (block.content as Array<Record<string, unknown>>)
            .filter(c => c.type === 'text')
            .map(c => c.text)
            .join('\n')
        }
        events.push({
          kind: 'tool_result', id: `tr-${uid()}`,
          toolUseId: block.tool_use_id as string,
          content: resultText,
          isError: (block.is_error as boolean) || false,
        })
      }
    }
  }

  if (type === 'result') {
    events.push({
      kind: 'result', id: `final-${uid()}`,
      sessionId: msg.session_id as string,
      cost: (msg.total_cost_usd || msg.cost_usd || msg.cost) as number,
      usage: msg.usage as { input_tokens: number; output_tokens: number },
      turns: msg.num_turns as number,
    })
  }

  return events
}

/* ── Middleware config ── */

export interface AxonMiddlewareConfig {
  axonHome: string
  cliDir?: string // path to cli/ directory for cron/init scripts
}

/* ── Resolve user's login shell PATH (handles fish, bash+nvm, zsh) ── */

function resolveShellPath(): string {
  const fallbackPath = process.env.PATH || ''
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const shellName = (shell.split('/').pop() || 'zsh').toLowerCase()

    let resolved = ''
    if (shellName === 'fish') {
      // fish uses separate -l -c flags (not combined -lc)
      resolved = execSync(`${shell} -l -c 'printenv PATH'`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim()
    } else {
      // bash/zsh: login shell
      try {
        resolved = execSync(`${shell} -lc 'printenv PATH'`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim()
      } catch {
        // bash with nvm: .bashrc not sourced by login shell, try interactive login
        resolved = execSync(`${shell} -ilc 'printenv PATH' 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }).trim()
      }
    }

    // Augment with common tool manager paths that might be missing
    const home = homedir()
    const extraPaths = [
      join(home, '.volta', 'bin'),
      join(home, '.fnm'),
      join(home, '.local', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ].filter(p => existsSync(p) && !resolved.includes(p))

    if (extraPaths.length > 0) {
      resolved = resolved + ':' + extraPaths.join(':')
    }

    return resolved || fallbackPath
  } catch {
    return fallbackPath
  }
}

/* ── Server config (remote access) ── */

interface ServerConfig {
  enabled: boolean
  port: number
  passwordHash: string
  createdAt: string
}

function readServerConfig(axonHome: string): ServerConfig | null {
  try {
    return JSON.parse(readFileSync(join(axonHome, 'server.json'), 'utf-8'))
  } catch { return null }
}

function writeServerConfig(axonHome: string, cfg: ServerConfig) {
  writeFileSync(join(axonHome, 'server.json'), JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

/* ── Session token store (in-memory, survives hot reloads via module scope) ── */
const sessionTokens = new Map<string, number>() // token → created timestamp
let activeDeepSearches = 0 // concurrency cap for /api/axon/search/deep
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24 hours
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

function generateSessionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function isValidSession(token: string): boolean {
  const created = sessionTokens.get(token)
  if (!created) return false
  if (Date.now() - created > SESSION_TTL) {
    sessionTokens.delete(token)
    return false
  }
  return true
}

function checkRateLimit(ip: string): boolean {
  const entry = failedAttempts.get(ip)
  if (!entry) return true
  const elapsed = Date.now() - entry.lastAttempt
  // After 5 failures: 30s cooldown. After 10: 5min.
  const cooldown = entry.count >= 10 ? 300_000 : entry.count >= 5 ? 30_000 : 0
  return elapsed >= cooldown
}

function recordFailedAttempt(ip: string) {
  const entry = failedAttempts.get(ip) || { count: 0, lastAttempt: 0 }
  entry.count++
  entry.lastAttempt = Date.now()
  failedAttempts.set(ip, entry)
}

function clearFailedAttempts(ip: string) {
  failedAttempts.delete(ip)
}

/* ── Create the middleware ── */

export function createAxonMiddleware(config: AxonMiddlewareConfig) {
  const { axonHome: AXON_HOME } = config
  let lastSessionIndex = 0
  // Resolve shell PATH once at startup — reused by all endpoints
  const resolvedShellPath = resolveShellPath()
  // Load server config for auth
  let serverConfig = readServerConfig(AXON_HOME)

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || ''
    if (!url.startsWith('/api/axon')) return next()

    res.setHeader('Content-Type', 'application/json')

    // Auth check — use req.socket.remoteAddress (NOT req.ip) to prevent X-Forwarded-For spoofing
    const remoteIp = req.socket.remoteAddress || ''
    const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1'

    // Default-deny remote connections unless auth passes
    if (!isLocal) {
      // Allow server-config GET (needed for UI to check state) and login endpoint
      const isPublicEndpoint = url === '/api/axon/server-config' || url === '/api/axon/server-config/login'
      if (!isPublicEndpoint) {
        const authHeader = req.headers.authorization || ''
        const token = authHeader.replace(/^Bearer\s+/i, '').trim()
        if (!token || !isValidSession(token)) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
      }
    }

    // Path traversal guard — reject any URL with encoded traversal sequences
    if (decodeURIComponent(url).includes('..')) {
      res.statusCode = 400
      res.end(JSON.stringify({ error: 'Invalid path' }))
      return
    }

    try {
      // GET /api/axon/server-config — remote access configuration (public, no secrets)
      if (url === '/api/axon/server-config' && req.method === 'GET') {
        serverConfig = readServerConfig(AXON_HOME)
        res.end(JSON.stringify({
          enabled: serverConfig?.enabled || false,
          port: serverConfig?.port || 3847,
          hasPassword: !!serverConfig?.passwordHash,
        }))
        return
      }

      // POST /api/axon/server-config — update remote access settings (local only)
      if (url === '/api/axon/server-config' && req.method === 'POST') {
        if (!isLocal) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: 'Server config can only be changed locally' }))
          return
        }
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { enabled, port, password } = JSON.parse(body) as {
          enabled?: boolean
          port?: number
          password?: string
        }

        const current = readServerConfig(AXON_HOME) || { enabled: false, port: 3847, passwordHash: '', createdAt: new Date().toISOString() }

        if (password) {
          current.passwordHash = hashSync(password, 10)
          // Invalidate all existing sessions when password changes
          sessionTokens.clear()
        }
        if (enabled !== undefined) {
          if (enabled && !current.passwordHash) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Set a password before enabling remote access' }))
            return
          }
          current.enabled = enabled
        }
        if (port !== undefined) {
          current.port = port
        }

        writeServerConfig(AXON_HOME, current)
        serverConfig = current
        res.end(JSON.stringify({ ok: true, enabled: current.enabled, port: current.port, hasPassword: !!current.passwordHash }))
        return
      }

      // POST /api/axon/server-config/login — verify password, return session token
      if (url === '/api/axon/server-config/login' && req.method === 'POST') {
        const clientIp = req.socket.remoteAddress || 'unknown'

        // Rate limiting
        if (!checkRateLimit(clientIp)) {
          res.statusCode = 429
          res.end(JSON.stringify({ error: 'Too many attempts. Try again later.' }))
          return
        }

        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { password } = JSON.parse(body) as { password: string }
        const valid = serverConfig?.passwordHash ? compareSync(password, serverConfig.passwordHash) : false

        if (valid) {
          clearFailedAttempts(clientIp)
          const token = generateSessionToken()
          sessionTokens.set(token, Date.now())
          res.end(JSON.stringify({ valid: true, token }))
        } else {
          recordFailedAttempt(clientIp)
          res.statusCode = 401
          res.end(JSON.stringify({ valid: false }))
        }
        return
      }

      // GET /api/axon/preflight — system health check for first-run setup
      if (url === '/api/axon/preflight') {
        const checks: { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; action?: string; actionType?: string }[] = []

        const shellPath = resolvedShellPath
        const execOpts = { stdio: 'pipe' as const, env: { ...process.env, PATH: shellPath }, timeout: 5000 }

        // 1. Axon home exists
        const homeExists = existsSync(AXON_HOME)
        checks.push({
          id: 'axon-home',
          label: 'Axon data directory',
          status: homeExists ? 'pass' : 'fail',
          detail: homeExists ? AXON_HOME : `${AXON_HOME} not found`,
          action: homeExists ? undefined : 'Will be created during onboarding',
        })

        // 2. CLI — check bundled (cliDir) first, then PATH
        const cliDir = config.cliDir
        const hasBundledCli = cliDir && existsSync(join(cliDir, 'axon-init'))

        let cliVersion = ''
        try {
          cliVersion = execSync('axon --version 2>/dev/null', { ...execOpts, encoding: 'utf-8' }).trim()
        } catch { /* not in PATH */ }

        if (hasBundledCli || cliVersion) {
          // CLI available (bundled or in PATH)
          let detail = ''
          let status: 'pass' | 'warn' = 'pass'
          let action: string | undefined
          let actionType: string | undefined

          if (cliVersion) {
            // Check for updates if we have a PATH version
            let latestCliVersion = ''
            try {
              const npmInfo = execSync('npm view axon-dev version 2>/dev/null', { ...execOpts, encoding: 'utf-8', timeout: 8000 }).trim()
              if (npmInfo) latestCliVersion = npmInfo
            } catch { /* registry unavailable */ }

            let isLinkedDev = false
            try {
              const axonPath = execSync('which axon', { ...execOpts, encoding: 'utf-8', timeout: 5000 }).trim()
              const stat = lstatSync(axonPath)
              if (stat.isSymbolicLink()) {
                const realPath = realpathSync(axonPath)
                if (existsSync(join(realPath, '..', '..', '.git'))) isLinkedDev = true
              }
            } catch {}

            const vMatch = cliVersion.match(/v?([\d.]+)/)
            const installed = vMatch ? vMatch[1] : ''
            const outdated = !isLinkedDev && latestCliVersion && installed && installed !== latestCliVersion
            detail = isLinkedDev ? `${cliVersion} (dev)` : outdated ? `${cliVersion} → v${latestCliVersion} available` : cliVersion
            if (outdated) { status = 'warn'; action = 'Update available'; actionType = 'update-cli' }
          } else {
            detail = 'Bundled with app'
          }

          checks.push({ id: 'cli', label: 'Axon CLI', status, detail, action, actionType })
        } else {
          checks.push({
            id: 'cli',
            label: 'Axon CLI',
            status: 'warn',
            detail: 'Not in PATH (optional — app works without it)',
            action: 'Install via npm for terminal use',
            actionType: 'install-cli',
          })
        }

        // 3. Claude CLI
        let claudeVersion = ''
        try {
          claudeVersion = execSync('claude --version 2>/dev/null', { ...execOpts, encoding: 'utf-8' }).trim().split('\n')[0]
        } catch { /* not found */ }
        checks.push({
          id: 'claude',
          label: 'Claude CLI',
          status: claudeVersion ? 'pass' : 'warn',
          detail: claudeVersion || 'Not found',
          action: claudeVersion ? undefined : 'Install Claude Code',
          actionType: claudeVersion ? undefined : 'open-url:https://claude.ai/code',
        })

        // 4. Git
        let gitVersion = ''
        try {
          gitVersion = execSync('git --version 2>/dev/null', { ...execOpts, encoding: 'utf-8' }).trim()
        } catch { /* not found */ }
        checks.push({
          id: 'git',
          label: 'Git',
          status: gitVersion ? 'pass' : 'fail',
          detail: gitVersion || 'Not found',
          action: gitVersion ? undefined : 'Install Git',
          actionType: gitVersion ? undefined : 'open-url:https://git-scm.com/downloads',
        })

        // 5. Node version — check SYSTEM node, not Electron's bundled Node
        let systemNodeVersion = ''
        try {
          systemNodeVersion = execSync('node --version 2>/dev/null', { ...execOpts, encoding: 'utf-8' }).trim()
        } catch { /* not found */ }
        const nodeMajor = systemNodeVersion ? parseInt(systemNodeVersion.slice(1)) : 0
        checks.push({
          id: 'node',
          label: 'Node.js',
          status: !systemNodeVersion ? 'fail' : nodeMajor >= 22 ? 'pass' : nodeMajor >= 20 ? 'warn' : 'fail',
          detail: systemNodeVersion || 'Not found in PATH',
          action: !systemNodeVersion || nodeMajor < 20 ? 'Install Node.js 22+' : nodeMajor < 22 ? 'Recommended: Node 22+' : undefined,
          actionType: !systemNodeVersion || nodeMajor < 20 ? 'open-url:https://nodejs.org' : undefined,
        })

        // 6. Projects exist
        let projectCount = 0
        try {
          const wsDir = join(AXON_HOME, 'workspaces')
          if (existsSync(wsDir)) {
            const entries = await readdir(wsDir, { withFileTypes: true })
            projectCount = entries.filter(e => e.isDirectory()).length
          }
        } catch { /* no workspaces */ }
        checks.push({
          id: 'projects',
          label: 'Projects',
          status: projectCount > 0 ? 'pass' : 'warn',
          detail: projectCount > 0 ? `${projectCount} project${projectCount !== 1 ? 's' : ''}` : 'None yet',
          action: projectCount === 0 ? 'Add a project in onboarding' : undefined,
        })

        const allPass = checks.every(c => c.status === 'pass')
        res.end(JSON.stringify({ ok: allPass, checks }))
        return
      }

      // POST /api/axon/preflight/action — execute a preflight fix action
      if (url === '/api/axon/preflight/action' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { actionType } = JSON.parse(body) as { actionType: string }

        const shellPath = resolvedShellPath
        const execOpts = { encoding: 'utf-8' as const, env: { ...process.env, PATH: shellPath }, timeout: 60_000, stdio: 'pipe' as const }

        try {
          // Detect if CLI is a dev symlink (npm link) — update won't help
          if (actionType === 'update-cli' || actionType === 'install-cli') {
            let isLinkedDev = false
            try {
              const axonPath = execSync('which axon', { ...execOpts, timeout: 5000 }).trim()
              const { lstatSync, realpathSync } = await import('fs')
              const stat = lstatSync(axonPath)
              if (stat.isSymbolicLink()) {
                const realPath = realpathSync(axonPath)
                // If the real path points into a git repo (dev install), it's linked
                if (existsSync(join(realPath, '..', '..', '.git'))) {
                  isLinkedDev = true
                }
              }
            } catch { /* can't detect, proceed normally */ }

            if (isLinkedDev && actionType === 'update-cli') {
              res.end(JSON.stringify({ ok: true, message: 'Dev install detected — pull latest from git instead of npm update' }))
              return
            }
          }

          if (actionType === 'install-cli') {
            execSync('npm install -g axon-dev', execOpts)
            res.end(JSON.stringify({ ok: true, message: 'Axon CLI installed' }))
          } else if (actionType === 'update-cli') {
            execSync('npm install -g axon-dev@latest', execOpts)
            res.end(JSON.stringify({ ok: true, message: 'Axon CLI updated' }))
          } else {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'Unknown action' }))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Action failed'
          const isPermission = msg.includes('EACCES') || msg.includes('permission denied') || msg.includes('Please try running')
          res.statusCode = 500
          res.end(JSON.stringify({
            ok: false,
            error: isPermission
              ? 'Permission denied. Try: sudo npm install -g axon-dev, or fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors'
              : msg,
          }))
        }
        return
      }

      // GET /api/axon/projects
      if (url === '/api/axon/projects') {
        const wsDir = join(AXON_HOME, 'workspaces')
        if (!existsSync(wsDir)) {
          res.end(JSON.stringify([]))
          return
        }
        const entries = await readdir(wsDir, { withFileTypes: true })
        const projects = []

        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const name = entry.name
          const wsPath = join(wsDir, name)

          let status = 'active'
          let projectPath = ''
          let createdAt = ''
          try {
            const cfg = await readFile(join(wsPath, 'config.yaml'), 'utf-8')
            status = cfg.match(/^status:\s*(.+)$/m)?.[1]?.trim() || 'active'
            projectPath = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim() || ''
            createdAt = cfg.match(/^created_at:\s*(.+)$/m)?.[1]?.trim() || ''
          } catch {}

          let lastRollup: string | null = null
          let openLoopCount = 0
          try {
            const state = await readFile(join(wsPath, 'state.md'), 'utf-8')
            lastRollup = state.match(/^last_rollup:\s*(.+)$/m)?.[1]?.trim() || null
            const loops = state.match(/^\s*- \[[ >]\]/gm)
            openLoopCount = loops ? loops.length : 0
          } catch {}

          let episodeCount = 0
          try {
            const eps = await readdir(join(wsPath, 'episodes'))
            episodeCount = eps.filter(f => f.endsWith('.md')).length
          } catch {}

          // Check genesis status for uninitialized projects
          let genesisStatus: string | undefined
          if (episodeCount === 0) {
            try {
              const lockPath = join(wsPath, '.genesis-lock')
              const lock = JSON.parse(readFileSync(lockPath, 'utf-8'))
              genesisStatus = lock.status // 'running' | 'complete' | 'failed'
              // Detect stale genesis-lock: if running for >10 minutes, mark as failed
              if (lock.status === 'running' && lock.startedAt) {
                const elapsed = Date.now() - new Date(lock.startedAt).getTime()
                if (elapsed > 10 * 60 * 1000) {
                  genesisStatus = 'failed'
                  writeFileSync(lockPath, JSON.stringify({ status: 'failed', error: 'Timed out after 10 minutes' }))
                }
              }
            } catch {
              // No lock file — genesis hasn't been attempted
            }
          }

          projects.push({ name, path: projectPath, status, createdAt, lastRollup, episodeCount, openLoopCount, ...(genesisStatus ? { genesisStatus } : {}) })
        }

        res.end(JSON.stringify(projects))
        return
      }

      // GET /api/axon/projects/:name/rollups
      const rollupsMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/rollups$/)
      if (rollupsMatch) {
        const project = decodeURIComponent(rollupsMatch[1])
        const epDir = join(AXON_HOME, 'workspaces', project, 'episodes')

        try {
          const files = await readdir(epDir)
          const mdFiles = files.filter(f => f.endsWith('.md')).sort().reverse()

          const rollups = []
          for (const file of mdFiles) {
            const content = await readFile(join(epDir, file), 'utf-8')
            rollups.push({ filename: file, content })
          }
          res.end(JSON.stringify(rollups))
        } catch {
          res.end(JSON.stringify([]))
        }
        return
      }

      // GET /api/axon/projects/:name/state
      const stateMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/state$/)
      if (stateMatch) {
        const project = decodeURIComponent(stateMatch[1])
        try {
          const content = await readFile(join(AXON_HOME, 'workspaces', project, 'state.md'), 'utf-8')
          res.end(JSON.stringify({ content }))
        } catch {
          res.end(JSON.stringify({ content: '' }))
        }
        return
      }

      // GET /api/axon/projects/:name/config
      const configMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/config$/)
      if (configMatch && req.method === 'GET') {
        const project = decodeURIComponent(configMatch[1])
        try {
          const content = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          res.end(JSON.stringify({ content }))
        } catch {
          res.end(JSON.stringify({ content: '' }))
        }
        return
      }

      // PATCH /api/axon/projects/:name/config
      if (configMatch && req.method === 'PATCH') {
        const project = decodeURIComponent(configMatch[1])
        const configPath = join(AXON_HOME, 'workspaces', project, 'config.yaml')
        let body = ''
        req.on('data', (c: Buffer) => { body += c.toString() })
        req.on('end', () => {
          try {
            const patch = JSON.parse(body)
            const raw = readFileSync(configPath, 'utf-8')
            const cfg = parseYaml(raw, { uniqueKeys: false }) as Record<string, unknown>

            // Merge top-level scalars
            if (patch.status !== undefined) cfg.status = patch.status
            if (patch.timezone !== undefined) cfg.timezone = patch.timezone

            // user_context: null removes it, string sets it
            if (patch.user_context === null) {
              delete cfg.user_context
            } else if (typeof patch.user_context === 'string') {
              cfg.user_context = patch.user_context
            }

            // Deep merge dendrites
            if (patch.dendrites && typeof patch.dendrites === 'object') {
              const dend = (cfg.dendrites || {}) as Record<string, Record<string, unknown>>
              for (const [key, val] of Object.entries(patch.dendrites as Record<string, Record<string, unknown>>)) {
                if (!dend[key]) dend[key] = {}
                Object.assign(dend[key], val)
              }
              cfg.dendrites = dend
            }

            // Deep merge rollup
            if (patch.rollup && typeof patch.rollup === 'object') {
              const roll = (cfg.rollup || {}) as Record<string, unknown>
              Object.assign(roll, patch.rollup)
              cfg.rollup = roll
            }

            // Atomic write
            const tmpPath = configPath + '.tmp.' + Date.now()
            writeFileSync(tmpPath, stringifyYaml(cfg, { lineWidth: 0 }))
            renameSync(tmpPath, configPath)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
        return
      }

      // DELETE /api/axon/projects/:name?mode=archive|delete
      const deleteMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)(?:\?|$)/)
      if (deleteMatch && req.method === 'DELETE') {
        const project = decodeURIComponent(deleteMatch[1])
        const mode = new URL(url, 'http://localhost').searchParams.get('mode') || 'archive'
        const wsPath = join(AXON_HOME, 'workspaces', project)
        try {
          if (!existsSync(wsPath)) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Project not found' }))
            return
          }
          if (mode === 'delete') {
            rmSync(wsPath, { recursive: true, force: true })
          } else {
            // Archive: update status in config.yaml
            const configPath = join(wsPath, 'config.yaml')
            const raw = readFileSync(configPath, 'utf-8')
            try {
              const cfg = parseYaml(raw) as Record<string, unknown>
              cfg.status = 'archived'
              const tmpPath = configPath + '.tmp.' + Date.now()
              writeFileSync(tmpPath, stringifyYaml(cfg, { lineWidth: 0 }))
              renameSync(tmpPath, configPath)
            } catch {
              // YAML parse failed (e.g. duplicate keys) — regex fallback
              const patched = raw.replace(/^status:\s*.+$/m, 'status: archived')
              writeFileSync(configPath, patched)
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: String(e) }))
        }
        return
      }

      // GET /api/axon/projects/:name/stream
      const streamMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/stream$/)
      if (streamMatch) {
        const project = decodeURIComponent(streamMatch[1])
        try {
          const content = await readFile(join(AXON_HOME, 'workspaces', project, 'stream.md'), 'utf-8')
          res.end(JSON.stringify({ content }))
        } catch {
          res.end(JSON.stringify({ content: '' }))
        }
        return
      }

      // GET /api/axon/projects/:name/mornings
      const morningsMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/mornings$/)
      if (morningsMatch) {
        const project = decodeURIComponent(morningsMatch[1])
        const mDir = join(AXON_HOME, 'workspaces', project, 'mornings')
        try {
          const files = await readdir(mDir)
          const logFiles = files.filter(f => f.endsWith('.log') || f.endsWith('.md')).sort().reverse()
          const mornings = []
          for (const file of logFiles) {
            const content = await readFile(join(mDir, file), 'utf-8')
            mornings.push({ filename: file, content })
          }
          res.end(JSON.stringify(mornings))
        } catch {
          res.end(JSON.stringify([]))
        }
        return
      }

      // GET /api/axon/projects/:name/gource — serve gource.png if it exists
      const gourceMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/gource$/)
      if (gourceMatch) {
        const project = decodeURIComponent(gourceMatch[1])
        const gourcePath = join(AXON_HOME, 'workspaces', project, 'gource.png')
        if (existsSync(gourcePath)) {
          res.setHeader('Content-Type', 'image/png')
          res.setHeader('Cache-Control', 'public, max-age=86400')
          const img = await readFile(gourcePath)
          res.end(img)
        } else {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'No gource image' }))
        }
        return
      }

      // ── TODO ENDPOINTS (SQLite-backed via todoDb.ts) ────────

      // GET /api/axon/projects/:name/todos
      const todosGetMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/todos$/)
      if (todosGetMatch && req.method === 'GET') {
        const project = decodeURIComponent(todosGetMatch[1])
        try {
          const { listTodos } = await import('../lib/todoDb')
          const items = listTodos(project)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ items }))
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ items: [] }))
        }
        return
      }

      // POST /api/axon/projects/:name/todos — add item
      const todosPostMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/todos$/)
      if (todosPostMatch && req.method === 'POST') {
        const project = decodeURIComponent(todosPostMatch[1])
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { description, priority, notes, tags } = JSON.parse(body)
        const { addTodo } = await import('../lib/todoDb')
        const item = addTodo(project, { description, priority, notes, tags })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(item))
        return
      }

      // PATCH /api/axon/projects/:name/todos/:id — update item
      const todosPatchMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/todos\/(\d+)$/)
      if (todosPatchMatch && req.method === 'PATCH') {
        const project = decodeURIComponent(todosPatchMatch[1])
        const id = parseInt(todosPatchMatch[2], 10)
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { action, reason, priority, notes, description, tags } = JSON.parse(body)
        const db = await import('../lib/todoDb')
        try {
          let result
          switch (action) {
            case 'complete': case 'defer': case 'drop': case 'reactivate':
              result = db.transitionTodo(project, id, action, { reason, priority })
              break
            case 'reprioritise':
              result = db.reprioritiseTodo(project, id, priority)
              break
            case 'edit':
              result = db.editTodo(project, id, { description, priority, tags, notes })
              break
            case 'add-notes':
              result = db.addNote(project, id, notes)
              break
            default:
              res.statusCode = 400
              res.end(JSON.stringify({ error: `Unknown action: ${action}` }))
              return
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, action, todoId: id, ...result }))
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // ── JOBS ENDPOINTS (SQLite-backed via jobsDb.ts) ─────

      // GET /api/axon/projects/:name/jobs
      const jobsGetMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/jobs(\?.*)?$/)
      if (jobsGetMatch && req.method === 'GET') {
        const project = decodeURIComponent(jobsGetMatch[1])
        const params = new URLSearchParams(jobsGetMatch[2]?.slice(1) || '')
        try {
          const { listJobs, cleanStaleJobs } = await import('../lib/jobsDb')
          cleanStaleJobs(project, 30)
          const opts: Record<string, unknown> = {}
          if (params.get('type')) opts.type = params.get('type')
          if (params.get('status')) opts.status = params.get('status')
          if (params.get('limit')) opts.limit = parseInt(params.get('limit')!, 10)
          if (params.get('offset')) opts.offset = parseInt(params.get('offset')!, 10)
          const items = listJobs(project, opts as Parameters<typeof listJobs>[1])
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ items }))
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ items: [] }))
        }
        return
      }

      // GET /api/axon/projects/:name/jobs/summary
      const jobsSummaryMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/jobs\/summary(\?.*)?$/)
      if (jobsSummaryMatch && req.method === 'GET') {
        const project = decodeURIComponent(jobsSummaryMatch[1])
        const params = new URLSearchParams(jobsSummaryMatch[2]?.slice(1) || '')
        try {
          const { jobSummary, cleanStaleJobs } = await import('../lib/jobsDb')
          cleanStaleJobs(project, 30)
          const type = params.get('type') as 'rollup' | 'collect' | 'bridge' | undefined
          const summary = jobSummary(project, type || undefined)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(summary))
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ total: 0, success: 0, failed: 0, running: 0, total_cost: 0, avg_duration_s: 0 }))
        }
        return
      }

      // GET /api/axon/projects/:name/cron — cron/launchd status
      const cronMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/cron$/)
      if (cronMatch && req.method === 'GET') {
        const project = decodeURIComponent(cronMatch[1])
        try {
          const plistPath = join(homedir(), 'Library', 'LaunchAgents', `com.axon.rollup.${project}.plist`)
          if (existsSync(plistPath)) {
            const content = readFileSync(plistPath, 'utf-8')
            const hourMatch = content.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)
            const minMatch = content.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)
            const hour = hourMatch ? parseInt(hourMatch[1]) : null
            const minute = minMatch ? parseInt(minMatch[1]) : null
            let loaded = false
            try {
              const allServices = execSync('launchctl list 2>/dev/null', { encoding: 'utf-8' })
              loaded = allServices.includes(`com.axon.rollup.${project.replace(/[^a-zA-Z0-9._-]/g, '')}`)

            } catch { /* not loaded */ }
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ installed: true, loaded, hour, minute, schedule: `${String(hour ?? 0).padStart(2, '0')}:${String(minute ?? 0).padStart(2, '0')}` }))
          } else {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ installed: false, loaded: false }))
          }
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ installed: false, loaded: false }))
        }
        return
      }

      // POST /api/axon/projects/:name/cron — install/remove cron
      const cronPostMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/cron$/)
      if (cronPostMatch && req.method === 'POST') {
        const project = decodeURIComponent(cronPostMatch[1])
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { action, time } = JSON.parse(body) as { action: 'install' | 'remove'; time?: string }
        if (action !== 'install' && action !== 'remove') {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'Invalid action' }))
          return
        }
        try {
          const configPath = join(homedir(), '.axon', 'workspaces', project, 'config.yaml')
          let projectPath = ''
          if (existsSync(configPath)) {
            const cfg = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>
            projectPath = String(cfg.project_path || '')
          }

          const cliDir = config.cliDir || resolve(process.cwd(), '..', 'cli')
          const cronScript = join(cliDir, 'axon-cron')
          const env: Record<string, string | undefined> = { ...process.env, PROJECT: project, PROJECT_PATH: projectPath, CRON_TIME: time || '02:00' }
          delete env.CLAUDECODE

          const result = execFileSync('bash', [cronScript, action], { encoding: 'utf-8', env, timeout: 10000 })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, output: result.trim() }))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(err) }))
        }
        return
      }

      // GET /api/axon/projects/:name/jobs/:id/watch — SSE live feed of a running job's Claude session
      const jobWatchMatch = url.match(/^\/api\/axon\/projects\/([^/]+)\/jobs\/(\d+)\/watch$/)
      if (jobWatchMatch && req.method === 'GET') {
        const project = decodeURIComponent(jobWatchMatch[1])
        const jobId = parseInt(jobWatchMatch[2], 10)

        try {
          const { getJob } = await import('../lib/jobsDb')
          const job = getJob(project, jobId)
          if (!job) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Job not found' }))
            return
          }

          const sessionId = job.meta?.session_id as string | undefined
          if (!sessionId) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'No session_id in job meta' }))
            return
          }

          const cfgPath = join(AXON_HOME, 'workspaces', project, 'config.yaml')
          let projectPath = ''
          if (existsSync(cfgPath)) {
            const cfg = parseYaml(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>
            projectPath = String(cfg.project_path || '')
          }

          if (!projectPath) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'No project_path in config' }))
            return
          }

          const folderId = projectPath.replace(/\//g, '-')
          const jsonlPath = join(homedir(), '.claude', 'projects', folderId, `${sessionId}.jsonl`)

          if (!existsSync(jsonlPath)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Session JSONL not found', path: jsonlPath }))
            return
          }

          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')

          let linesSent = 0
          const isRunning = job.status === 'running'

          const sendNewLines = () => {
            try {
              const content = readFileSync(jsonlPath, 'utf-8')
              const lines = content.split('\n').filter(l => l.trim())
              if (lines.length <= linesSent) return

              for (let i = linesSent; i < lines.length; i++) {
                try {
                  const msg = JSON.parse(lines[i]) as Record<string, unknown>
                  const events = classifyAgentMessage(msg)
                  for (const evt of events) {
                    res.write(`data: ${JSON.stringify(evt)}\n\n`)
                  }
                } catch { /* skip malformed lines */ }
              }
              linesSent = lines.length
            } catch { /* file may be gone */ }
          }

          sendNewLines()

          if (isRunning) {
            const pollInterval = 1000
            watchFile(jsonlPath, { interval: pollInterval }, () => {
              sendNewLines()

              try {
                const currentJob = getJob(project, jobId)
                if (currentJob && currentJob.status !== 'running') {
                  res.write(`data: ${JSON.stringify({ kind: 'done', id: `done-${Date.now()}`, status: currentJob.status })}\n\n`)
                  unwatchFile(jsonlPath)
                  res.end()
                }
              } catch { /* continue watching */ }
            })

            req.on('close', () => {
              unwatchFile(jsonlPath)
            })
          } else {
            res.write(`data: ${JSON.stringify({ kind: 'done', id: `done-${Date.now()}`, status: job.status })}\n\n`)
            res.end()
          }
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // POST /api/axon/chat — streaming Claude proxy
      if (url === '/api/axon/chat' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        const { prompt, continueSession } = JSON.parse(body) as {
          prompt: string
          continueSession?: boolean
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const args = continueSession
          ? ['--continue', '-p', prompt, '--allowedTools', 'Read,Glob,Grep']
          : ['-p', prompt, '--allowedTools', 'Read,Glob,Grep']

        const cleanEnv = { ...process.env }
        delete cleanEnv.CLAUDECODE
        delete cleanEnv.CLAUDE_CODE_SESSION

        const child = spawn('claude', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cleanEnv,
        })

        child.stdout.on('data', (data: Buffer) => {
          const text = data.toString()
          res.write(`data: ${JSON.stringify({ type: 'content', text })}\n\n`)
        })

        child.stderr.on('data', () => {
          // Claude CLI progress — ignore
        })

        await new Promise<void>((resolve) => {
          child.on('close', (code) => {
            res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`)
            res.end()
            resolve()
          })

          child.on('error', (err) => {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
            res.end()
            resolve()
          })

          req.on('close', () => {
            if (!child.killed) child.kill()
            resolve()
          })
        })
        return
      }

      // POST /api/axon/search/deep — AI-powered semantic search across sessions
      if (url === '/api/axon/search/deep' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        const { prompt, continueSession } = JSON.parse(body) as {
          prompt: string
          continueSession?: boolean
        }

        // Validate prompt
        if (!prompt || typeof prompt !== 'string' || prompt.length > 10000) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid or too-long prompt' }))
          return
        }

        // Concurrency limit — max 2 deep search processes
        if (activeDeepSearches >= 2) {
          res.statusCode = 429
          res.end(JSON.stringify({ error: 'Too many concurrent searches. Try again shortly.' }))
          return
        }
        activeDeepSearches++

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const claudeHome = join(process.env.HOME || homedir(), '.claude')
        const projectsDir = join(claudeHome, 'projects')
        const axonHome = AXON_HOME

        // Build the search system prompt
        const systemPrompt = [
          'You are Axon Deep Search — a read-only search agent for Claude Code session history.',
          '',
          'IMPORTANT DISCLAIMER: You must begin your first response with:',
          '"🔍 **Deep Search** — I\'m searching your Claude Code session history. I have read-only access to session files. Results are best-effort."',
          '',
          '## Your Capabilities',
          '- Search through Claude Code session JSONL files for conversations matching the user\'s query',
          '- Use semantic understanding to expand vague queries into concrete search terms',
          '- Read session files to find relevant conversations',
          '',
          '## Session Data Structure',
          `- Sessions are stored as JSONL files in: ${projectsDir}/`,
          '- Each project has a folder named by its path (e.g., -Users-rob-Github-axon-jarvis/)',
          '- Each session is a .jsonl file named by session ID',
          '- Each line is a JSON object with fields: type ("user"|"assistant"|"system"), message.content, timestamp',
          '',
          '## SQLite FTS5 Index',
          `- Database at: ${join(axonHome, 'sessions.db')}`,
          '- Table: session_fts (session_id, project_name, content) — full-text search with porter stemming',
          '- Table: sessions (id, project_name, first_prompt, message_count, created_at, modified_at, etc.)',
          '- Query FTS: SELECT s.id, s.project_name, s.first_prompt, snippet(session_fts, 2, \'<mark>\', \'</mark>\', \'…\', 40) as snippet FROM session_fts JOIN sessions s ON s.id = session_fts.session_id WHERE session_fts MATCH \'query\' ORDER BY rank LIMIT 20',
          '',
          '## Output Format',
          'When you find relevant sessions, reference them using this EXACT format:',
          '[[session:SESSION_ID|PROJECT_NAME|DATE|"Brief description of what was discussed"]]',
          '',
          'Example: [[session:abc123def|axon|2026-03-18|"Discussed remote access architecture and thin client model"]]',
          '',
          'The UI will render these as clickable links. Always include them when you find matches.',
          '',
          '## Rules',
          '1. You are READ-ONLY. Never create, modify, or delete any files.',
          '2. Use Bash with sqlite3 to query the FTS index first (fast). Fall back to Grep/Read for deeper search.',
          '3. If the user\'s query is vague, expand it into multiple search terms and try each.',
          '4. Show the most relevant results first. Include the actual matching text when possible.',
          '5. If you find nothing, say so clearly and suggest alternative search terms.',
        ].join('\n')

        const args = continueSession
          ? ['--continue', '-p', prompt, '--verbose', '--output-format', 'stream-json', '--allowedTools', 'Read,Glob,Grep,Bash', '--max-budget-usd', '0.50']
          : ['-p', prompt, '--system-prompt', systemPrompt, '--verbose', '--output-format', 'stream-json', '--allowedTools', 'Read,Glob,Grep,Bash', '--max-budget-usd', '0.50']

        // Use a dedicated cwd to isolate search sessions from other projects
        const searchDir = join(AXON_HOME, 'search')
        mkdirSync(searchDir, { recursive: true })

        const cleanEnv = { ...process.env }
        delete cleanEnv.CLAUDECODE
        delete cleanEnv.CLAUDE_CODE_SESSION

        const child = spawn('claude', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: cleanEnv,
          cwd: searchDir,
        })

        let stdoutBuf = ''
        child.stdout.on('data', (data: Buffer) => {
          stdoutBuf += data.toString()
          // Parse stream-json: each line is a JSON object
          const lines = stdoutBuf.split('\n')
          stdoutBuf = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              // Extract text from assistant messages
              if (msg.type === 'assistant' && msg.message?.content) {
                const content = msg.message.content
                if (typeof content === 'string') {
                  res.write(`data: ${JSON.stringify({ type: 'content', text: content })}\n\n`)
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text' && block.text) {
                      res.write(`data: ${JSON.stringify({ type: 'content', text: block.text })}\n\n`)
                    }
                  }
                }
              }
            } catch { /* not valid JSON yet */ }
          }
        })

        let searchStderr = ''
        child.stderr.on('data', (data: Buffer) => {
          searchStderr += data.toString()
        })

        await new Promise<void>((resolve) => {
          child.on('close', (code) => {
            activeDeepSearches = Math.max(0, activeDeepSearches - 1)
            if (code !== 0 && searchStderr.trim()) {
              res.write(`data: ${JSON.stringify({ type: 'content', text: `\n\n**Search failed** (exit ${code}): ${searchStderr.trim().slice(0, 500)}` })}\n\n`)
            }
            res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`)
            res.end()
            resolve()
          })

          child.on('error', (err) => {
            res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
            res.end()
            resolve()
          })

          req.on('close', () => {
            if (!child.killed) child.kill()
            resolve()
          })
        })
        return
      }

      // POST /api/axon/agent — streaming Claude agent with tool visibility
      if (url === '/api/axon/agent' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        const { prompt, project, allowedTools, continueSession } = JSON.parse(body) as {
          prompt: string
          project: string
          allowedTools?: string[]
          continueSession?: boolean
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        let cwd = process.cwd()
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8'
          )
          const projectPath = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (projectPath && existsSync(projectPath)) cwd = projectPath
        } catch { /* use cwd */ }

        const tools = allowedTools?.join(',') || 'Read,Glob,Grep,Bash,Edit,Write'
        const args = [
          ...(continueSession ? ['--continue'] : []),
          '-p', prompt,
          '--output-format', 'stream-json',
          '--verbose',
          '--allowedTools', tools,
          '--max-turns', '200',
        ]

        const cleanEnv = { ...process.env }
        delete cleanEnv.CLAUDECODE
        delete cleanEnv.CLAUDE_CODE_SESSION

        const startTime = Date.now()
        const child = spawn('claude', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: cleanEnv,
          cwd,
        })
        child.stdin.end()

        let ndjsonBuffer = ''
        let sentResult = false

        child.stdout.on('data', (data: Buffer) => {
          ndjsonBuffer += data.toString()
          const lines = ndjsonBuffer.split('\n')
          ndjsonBuffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const msg = JSON.parse(line)
              const events = classifyAgentMessage(msg)
              for (const evt of events) {
                if (evt.kind === 'result') {
                  evt.duration = Math.floor((Date.now() - startTime) / 1000)
                  sentResult = true
                }
                res.write(`data: ${JSON.stringify(evt)}\n\n`)
              }
            } catch { /* malformed line */ }
          }
        })

        child.stderr.on('data', () => { /* ignore CLI progress */ })

        await new Promise<void>((resolve) => {
          child.on('close', (code) => {
            if (code !== 0) {
              res.write(`data: ${JSON.stringify({
                kind: 'error', id: `err-${Date.now()}`,
                text: `Claude exited with code ${code}`,
              })}\n\n`)
            }
            if (!sentResult) {
              const duration = Math.floor((Date.now() - startTime) / 1000)
              res.write(`data: ${JSON.stringify({
                kind: 'result', id: `result-${Date.now()}`, duration,
              })}\n\n`)
            }
            res.end()
            resolve()
          })
          child.on('error', (err) => {
            res.write(`data: ${JSON.stringify({
              kind: 'error', id: `err-${Date.now()}`, text: err.message,
            })}\n\n`)
            res.end()
            resolve()
          })
          req.on('close', () => {
            if (!child.killed) child.kill()
            resolve()
          })
        })
        return
      }

      // GET /api/axon/filesearch?project=name&q=query
      const filesearchMatch = url.match(/^\/api\/axon\/filesearch\?project=([^&]+)&q=(.*)$/)
      if (filesearchMatch) {
        const project = decodeURIComponent(filesearchMatch[1])
        const query = decodeURIComponent(filesearchMatch[2]).toLowerCase()

        let root = process.cwd()
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8'
          )
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) root = pp
        } catch { /* fallback */ }

        try {
          const raw = execSync(`git -C "${root}" ls-files -co --exclude-standard 2>/dev/null`, {
            encoding: 'utf-8', maxBuffer: 1024 * 1024 * 5,
          })
          const allFiles = raw.split('\n').filter(Boolean)
          const matches = query
            ? allFiles.filter(f => f.toLowerCase().includes(query)).slice(0, 50)
            : allFiles.slice(0, 50)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files: matches }))
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files: [] }))
        }
        return
      }

      // GET /api/axon/filetree?project=name
      const filetreeMatch = url.match(/^\/api\/axon\/filetree\?project=([^&]+)(?:&path=(.*))?$/)
      if (filetreeMatch) {
        const project = decodeURIComponent(filetreeMatch[1])
        const relPath = filetreeMatch[2] ? decodeURIComponent(filetreeMatch[2]) : ''

        let root = process.cwd()
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8'
          )
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) root = pp
        } catch { /* fallback */ }

        const target = relPath ? join(root, relPath) : root
        try {
          const entries = await readdir(target, { withFileTypes: true })
          const items = entries
            .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__')
            .sort((a, b) => {
              if (a.isDirectory() && !b.isDirectory()) return -1
              if (!a.isDirectory() && b.isDirectory()) return 1
              return a.name.localeCompare(b.name)
            })
            .slice(0, 200)
            .map(e => ({
              name: e.name,
              type: e.isDirectory() ? 'dir' : 'file',
              path: relPath ? `${relPath}/${e.name}` : e.name,
            }))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ root, items }))
        } catch (err) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
        return
      }

      // GET /api/axon/gitstatus?project=name
      const gitstatusMatch = url.match(/^\/api\/axon\/gitstatus\?project=([^&]+)$/)
      if (gitstatusMatch) {
        const project = decodeURIComponent(gitstatusMatch[1])

        let root = process.cwd()
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8'
          )
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) root = pp
        } catch { /* fallback */ }

        try {
          const prefix = execSync(`git -C "${root}" rev-parse --show-prefix 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 1024 * 64 }).trim()
          const raw = execSync(`git -C "${root}" status --porcelain -u 2>/dev/null`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 })
          const SKIP_DIRS = ['node_modules/', '.pnpm-store/', '.git/', 'dist/', '.next/', '.cache/', '__pycache__/', '.venv/', 'venv/']
          const files: Record<string, string> = {}
          let count = 0
          for (const line of raw.split('\n')) {
            if (!line || line.length < 4) continue
            const xy = line.slice(0, 2)
            let filePath = line.slice(3).split(' -> ').pop()!.trim()
            if (prefix && filePath.startsWith(prefix)) {
              filePath = filePath.slice(prefix.length)
            } else if (prefix && !filePath.startsWith(prefix)) {
              continue
            }
            if (SKIP_DIRS.some(d => filePath.includes(d))) continue
            if (xy === '??') files[filePath] = 'U'
            else if (xy.includes('A') || xy.includes('C')) files[filePath] = 'A'
            else if (xy.includes('D')) files[filePath] = 'D'
            else if (xy.includes('R')) files[filePath] = 'R'
            else if (xy.includes('M') || xy.includes('T')) files[filePath] = 'M'
            else files[filePath] = 'M'
            if (++count >= 500) break
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files }))
        } catch {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ files: {} }))
        }
        return
      }

      // POST /api/axon/scaffold — create a new git repo from scratch
      if (url === '/api/axon/scaffold' && req.method === 'POST') {
        let body = ''
        req.on('data', (c: Buffer) => { body += c.toString() })
        req.on('end', () => {
          try {
            const { name, parentDir: rawDir } = JSON.parse(body) as { name: string; parentDir: string }
            if (!name || !rawDir) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'name and parentDir required' }))
              return
            }

            const parentDir = rawDir.startsWith('~') ? rawDir.replace('~', homedir()) : rawDir
            const projectPath = join(parentDir, name)

            if (existsSync(projectPath)) {
              res.writeHead(409, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Directory already exists: ${projectPath}` }))
              return
            }

            const axonWs = join(AXON_HOME, 'workspaces', name)
            if (existsSync(join(axonWs, 'state.md'))) {
              res.writeHead(409, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: `Axon workspace "${name}" already exists` }))
              return
            }

            mkdirSync(projectPath, { recursive: true })
            execSync('git init', { cwd: projectPath, stdio: 'pipe' })
            writeFileSync(join(projectPath, 'README.md'), `# ${name}\n`)
            execSync('git add -A && git commit -m "Initial commit"', { cwd: projectPath, stdio: 'pipe' })

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, path: projectPath }))
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: String(e) }))
          }
        })
        return
      }

      // GET /api/axon/discover-repos
      if (url === '/api/axon/discover-repos') {
        // Return cached results if fresh
        if (discoveryCache && Date.now() - discoveryCache.timestamp < DISCOVERY_CACHE_TTL) {
          res.end(JSON.stringify(discoveryCache.repos))
          return
        }

        const home = homedir()
        const scanDirs = [
          'Github', 'Projects', 'Developer', 'Code', 'repos', 'src', 'work',
          'dev', 'code', 'workspace', 'workspaces', 'git',
          join('Documents', 'GitHub'), join('Documents', 'Projects'),
        ]
          .map(d => join(home, d))
          .filter(d => existsSync(d))
          // Deduplicate (case-insensitive filesystems may overlap)
          .filter((d, i, arr) => arr.indexOf(d) === i)

        const MAX_REPOS = 200
        const repos: { name: string; path: string; remote: string; commitCount: number; lastActivity: string }[] = []
        const seen = new Set<string>()

        const addRepo = (repoPath: string, name: string) => {
          if (repos.length >= MAX_REPOS) return
          // Resolve symlinks for dedup
          let realPath = repoPath
          try { realPath = realpathSync(repoPath) } catch {}
          if (seen.has(realPath)) return
          seen.add(realPath)

          let remote = ''
          try { remote = execSync(`git -C "${repoPath}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim() } catch {}

          let commitCount = 0
          try { commitCount = parseInt(execSync(`git -C "${repoPath}" rev-list --count HEAD 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim(), 10) || 0 } catch {}

          let lastActivity = ''
          try { lastActivity = execSync(`git -C "${repoPath}" log -1 --format=%ai 2>/dev/null`, { encoding: 'utf-8', timeout: 3000 }).trim() } catch {}

          repos.push({ name, path: repoPath, remote, commitCount, lastActivity })
        }

        const isDirEntry = (parentDir: string, entry: import('fs').Dirent): boolean => {
          if (entry.isDirectory()) return true
          // Follow symlinks to directories
          if (entry.isSymbolicLink()) {
            try { return statSync(join(parentDir, entry.name)).isDirectory() } catch { return false }
          }
          return false
        }

        for (const dir of scanDirs) {
          if (repos.length >= MAX_REPOS) break
          let entries: import('fs').Dirent[]
          try {
            entries = await readdir(dir, { withFileTypes: true })
          } catch {
            continue
          }
          for (const entry of entries) {
            if (repos.length >= MAX_REPOS) break
            if (!isDirEntry(dir, entry)) continue
            const childPath = join(dir, entry.name)

            if (existsSync(join(childPath, '.git'))) {
              // Direct git repo
              addRepo(childPath, entry.name)
            } else {
              // Not a git repo — check one level deeper (org folders like eat-ai-org/)
              try {
                const subEntries = await readdir(childPath, { withFileTypes: true })
                for (const sub of subEntries) {
                  if (repos.length >= MAX_REPOS) break
                  if (!isDirEntry(childPath, sub)) continue
                  const subPath = join(childPath, sub.name)
                  if (existsSync(join(subPath, '.git'))) {
                    addRepo(subPath, sub.name)
                  }
                }
              } catch {}
            }
          }
        }

        discoveryCache = { repos, timestamp: Date.now() }
        res.end(JSON.stringify(repos))
        return
      }

      // GET /api/axon/context-status
      if (url === '/api/axon/context-status') {
        const axonGit = join(AXON_HOME, '.git')
        const initialized = existsSync(axonGit)

        let remote = ''
        let commitCount = 0
        let lastCommit = ''

        if (initialized) {
          try { remote = execSync(`git -C "${AXON_HOME}" remote get-url origin 2>/dev/null`, { encoding: 'utf-8' }).trim() } catch {}
          try { commitCount = parseInt(execSync(`git -C "${AXON_HOME}" rev-list --count HEAD 2>/dev/null`, { encoding: 'utf-8' }).trim(), 10) || 0 } catch {}
          try { lastCommit = execSync(`git -C "${AXON_HOME}" log -1 --format=%ai 2>/dev/null`, { encoding: 'utf-8' }).trim() } catch {}
        }

        res.end(JSON.stringify({ initialized, remote, commitCount, lastCommit }))
        return
      }

      // --- Canvas Layout Endpoints ---

      const canvasMatch = url.match(/^\/api\/axon\/canvas-layout\?project=([^&]+)$/)
      if (canvasMatch) {
        const project = decodeURIComponent(canvasMatch[1])

        let projectPath = ''
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8'
          )
          projectPath = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim() || ''
        } catch { /* no config */ }

        const canvasId = projectPath ? projectPath.replace(/\//g, '-') : ''
        const layoutDir = join(homedir(), '.claude', 'canvas-layouts')
        const layoutPath = canvasId ? join(layoutDir, `${canvasId}.json`) : ''

        if (req.method === 'GET') {
          if (!layoutPath) {
            res.end(JSON.stringify({ tiles: [], zones: [], viewport: { x: 0, y: 0, scale: 1 } }))
            return
          }
          try {
            const content = await readFile(layoutPath, 'utf-8')
            res.end(content)
          } catch {
            res.end(JSON.stringify({ tiles: [], zones: [], viewport: { x: 0, y: 0, scale: 1 } }))
          }
          return
        }

        if (req.method === 'PUT') {
          const body = await new Promise<string>((resolve) => {
            let data = ''
            req.on('data', (chunk: Buffer) => { data += chunk.toString() })
            req.on('end', () => resolve(data))
          })

          if (!layoutPath) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'No project_path in config' }))
            return
          }

          const incoming = JSON.parse(body)

          if ((!incoming.tiles || incoming.tiles.length === 0) && existsSync(layoutPath)) {
            try {
              const existing = JSON.parse(await readFile(layoutPath, 'utf-8'))
              if (existing.tiles && existing.tiles.length > 0) {
                res.statusCode = 409
                res.end(JSON.stringify({ error: 'Refusing to overwrite populated layout with empty' }))
                return
              }
            } catch { /* file unreadable, allow overwrite */ }
          }

          mkdirSync(layoutDir, { recursive: true })
          const tmpPath = layoutPath + '.tmp'
          writeFileSync(tmpPath, JSON.stringify(incoming))
          renameSync(tmpPath, layoutPath)
          res.end(JSON.stringify({ ok: true }))
          return
        }
      }

      // --- Git Endpoints ---

      // GET /api/axon/projects/:name/git/info
      const gitInfoMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/info$/)
      if (gitInfoMatch) {
        const project = decodeURIComponent(gitInfoMatch[1])
        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' })
        } catch {
          res.end(JSON.stringify({ error: 'not-a-git-repo' }))
          return
        }

        try {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
          const shortSha = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf-8' }).trim()
          const isDetached = branch === 'HEAD'

          let remote = ''
          try { remote = execSync('git remote get-url origin', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim() } catch { /* no remote */ }

          let hasUpstream = false
          let ahead = 0
          let behind = 0
          try {
            execSync('git rev-parse --verify @{u}', { cwd, stdio: 'pipe' })
            hasUpstream = true
            const counts = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
            const [a, b] = counts.split(/\s+/)
            ahead = parseInt(a) || 0
            behind = parseInt(b) || 0
          } catch { /* no upstream */ }

          res.end(JSON.stringify({ branch, shortSha, isDetached, remote, hasUpstream, ahead, behind }))
        } catch (err) {
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // GET /api/axon/projects/:name/git/log?limit=50
      const gitLogMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/log(\?.*)?$/)
      if (gitLogMatch && req.method === 'GET') {
        const project = decodeURIComponent(gitLogMatch[1])
        const params = new URLSearchParams(gitLogMatch[2]?.slice(1) || '')
        const limit = Math.min(parseInt(params.get('limit') || '50') || 50, 200)

        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          const raw = execSync(
            `git log --format="%H|%h|%s|%an|%aI" -${limit}`,
            { cwd, encoding: 'utf-8', stdio: 'pipe' }
          ).trim()
          const commits = raw ? raw.split('\n').map(line => {
            const [hash, short, ...rest] = line.split('|')
            const date = rest.pop() || ''
            const author = rest.pop() || ''
            const message = rest.join('|')
            return { hash, short, message, author, date }
          }) : []
          res.end(JSON.stringify({ commits }))
        } catch {
          res.end(JSON.stringify({ commits: [] }))
        }
        return
      }

      // GET /api/axon/projects/:name/git/branches
      const gitBranchesMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/branches$/)
      if (gitBranchesMatch) {
        const project = decodeURIComponent(gitBranchesMatch[1])
        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          const raw = execSync(
            'git branch --format="%(refname:short)|%(HEAD)|%(upstream:short)|%(objectname:short)"',
            { cwd, encoding: 'utf-8', stdio: 'pipe' }
          ).trim()
          const branches = raw ? raw.split('\n').map(line => {
            const [name, head, upstream, shortSha] = line.split('|')
            return { name, isCurrent: head === '*', upstream: upstream || '', shortSha }
          }) : []
          res.end(JSON.stringify({ branches }))
        } catch {
          res.end(JSON.stringify({ branches: [] }))
        }
        return
      }

      // GET /api/axon/projects/:name/git/tags
      const gitTagsMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/tags$/)
      if (gitTagsMatch) {
        const project = decodeURIComponent(gitTagsMatch[1])
        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          // Get tags with date and commit, sorted newest first
          const raw = execSync(
            'git tag --sort=-creatordate --format="%(refname:short)|%(objectname:short)|%(creatordate:iso-strict)|%(subject)"',
            { cwd, encoding: 'utf-8', stdio: 'pipe' }
          ).trim()
          const tags = raw ? raw.split('\n').map(line => {
            const [name, shortSha, date, ...msgParts] = line.split('|')
            return { name, shortSha, date, message: msgParts.join('|') }
          }) : []
          res.end(JSON.stringify({ tags }))
        } catch {
          res.end(JSON.stringify({ tags: [] }))
        }
        return
      }

      // POST /api/axon/projects/:name/git/tag — create and push a tag
      const gitTagCreateMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/tag$/)
      if (gitTagCreateMatch && req.method === 'POST') {
        const project = decodeURIComponent(gitTagCreateMatch[1])
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { name, message } = JSON.parse(body) as { name: string; message?: string }

        if (!name || !/^[a-zA-Z0-9._\-/]+$/.test(name)) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, message: 'Invalid tag name' }))
          return
        }

        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          // Create tag (use execFileSync to prevent shell injection)
          const tagArgs = message
            ? ['tag', '-a', name, '-m', message]
            : ['tag', name]
          execFileSync('git', tagArgs, { cwd, encoding: 'utf-8', stdio: 'pipe' })

          // Push tag
          execFileSync('git', ['push', 'origin', name], { cwd, encoding: 'utf-8', timeout: 30000 })
          res.end(JSON.stringify({ ok: true, message: `Tag ${name} created and pushed` }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err)
          res.end(JSON.stringify({ ok: false, message: msg }))
        }
        return
      }

      // POST /api/axon/projects/:name/git/push
      const gitPushMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/push$/)
      if (gitPushMatch && req.method === 'POST') {
        const project = decodeURIComponent(gitPushMatch[1])
        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          let hasUpstream = false
          try { execSync('git rev-parse --verify @{u}', { cwd, stdio: 'pipe' }); hasUpstream = true } catch { /* no upstream */ }

          let pushArgs = ['push']
          if (!hasUpstream) {
            const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
            pushArgs = ['push', '-u', 'origin', branch]
          }
          const output = execFileSync('git', pushArgs, { cwd, encoding: 'utf-8', timeout: 30000 })
          res.end(JSON.stringify({ ok: true, message: output.trim() || 'Pushed successfully' }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err)
          res.end(JSON.stringify({ ok: false, message: msg }))
        }
        return
      }

      // POST /api/axon/projects/:name/git/pull
      const gitPullMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/pull$/)
      if (gitPullMatch && req.method === 'POST') {
        const project = decodeURIComponent(gitPullMatch[1])
        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          const output = execSync('git pull 2>&1', { cwd, encoding: 'utf-8', timeout: 30000 })
          res.end(JSON.stringify({ ok: true, message: output.trim() || 'Pulled successfully' }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err)
          res.end(JSON.stringify({ ok: false, message: msg }))
        }
        return
      }

      // POST /api/axon/projects/:name/git/checkout
      const gitCheckoutMatch = url.match(/^\/api\/axon\/projects\/([^/?]+)\/git\/checkout$/)
      if (gitCheckoutMatch && req.method === 'POST') {
        const project = decodeURIComponent(gitCheckoutMatch[1])
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        const { branch } = JSON.parse(body) as { branch: string }

        let cwd = process.cwd()
        try {
          const cfg = await readFile(join(AXON_HOME, 'workspaces', project, 'config.yaml'), 'utf-8')
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp && existsSync(pp)) cwd = pp
        } catch { /* fallback */ }

        try {
          const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
          if (status) {
            res.end(JSON.stringify({ ok: false, message: 'Uncommitted changes. Commit or stash first.' }))
            return
          }
        } catch { /* proceed */ }

        try {
          const output = execFileSync('git', ['checkout', branch], { cwd, encoding: 'utf-8', timeout: 10000 })
          res.end(JSON.stringify({ ok: true, message: output.trim() || `Switched to ${branch}` }))
        } catch (err: unknown) {
          const msg = err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err)
          res.end(JSON.stringify({ ok: false, message: msg }))
        }
        return
      }

      // Terminal endpoints removed for security — no shell spawning

      // PATCH /api/axon/sessions/:id/meta
      const metaPatchMatch = url.match(/^\/api\/axon\/sessions\/([^/?]+)\/meta$/)
      if (metaPatchMatch && req.method === 'PATCH') {
        const sessionId = decodeURIComponent(metaPatchMatch[1])
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })
        try {
          const updates = JSON.parse(body)
          const { updateSessionMeta } = await import('../lib/sessionMeta')
          const entry = updateSessionMeta(sessionId, updates)
          res.end(JSON.stringify({ ok: true, meta: entry }))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // --- Session Browser Endpoints ---

      // Pre-resolve project path from URL (used by forceIndex + sessions query)
      const forceIndex = url.includes('forceIndex=true')
      let resolvedProjectPath: string | null = null
      let resolvedProjectName: string | null = null
      const urlProjectParam = url.match(/[?&]project=([^&]+)/)
      if (urlProjectParam && url.startsWith('/api/axon/sessions')) {
        const rawName = decodeURIComponent(urlProjectParam[1])
        resolvedProjectName = rawName
        try {
          const cfg = await readFile(
            join(AXON_HOME, 'workspaces', rawName, 'config.yaml'), 'utf-8'
          )
          const pp = cfg.match(/^project_path:\s*(.+)$/m)?.[1]?.trim()
          if (pp) {
            resolvedProjectPath = pp
            resolvedProjectName = pp.split('/').filter(Boolean).pop() || rawName
          }
        } catch { /* fall back to raw name */ }
      }

      if (url.startsWith('/api/axon/sessions') && (forceIndex || Date.now() - lastSessionIndex > 30_000)) {
        lastSessionIndex = Date.now()
        try {
          if (forceIndex && resolvedProjectPath) {
            // Targeted sync scan — blocks until DB is fresh for this project
            const { scanProjectSync } = await import('../lib/sessionIndexer')
            scanProjectSync(resolvedProjectPath)
          } else {
            const { runFullIndex } = await import('../lib/sessionIndexer')
            runFullIndex()
          }
        } catch (err) {
          console.error('[Axon] Session indexer failed:', err)
        }

        // Discover non-Claude agent sessions
        try {
          const { registerAdapter, getAllAdapters } = await import('../lib/agents/registry')
          const { claudeAdapter } = await import('../lib/agents/claude')
          const { codexAdapter } = await import('../lib/agents/codex')
          const { cursorAdapter } = await import('../lib/agents/cursor')
          const { copilotAdapter } = await import('../lib/agents/copilot')
          const { upsertAgentSessions } = await import('../lib/sessionDb')

          registerAdapter(claudeAdapter)
          registerAdapter(codexAdapter)
          registerAdapter(cursorAdapter)
          registerAdapter(copilotAdapter)

          for (const adapter of getAllAdapters()) {
            if (adapter.info.id === 'claude') continue // already indexed above
            if (!adapter.isInstalled()) continue
            const sessions = adapter.discoverSessions()
            if (sessions.length > 0) upsertAgentSessions(sessions)
          }
        } catch (err) {
          console.error('[Axon] Agent discovery failed:', err)
        }
      }

      // GET /api/axon/sessions/installed-agents
      if (url === '/api/axon/sessions/installed-agents') {
        try {
          const { registerAdapter, getInstalledAgents } = await import('../lib/agents/registry')
          const { claudeAdapter } = await import('../lib/agents/claude')
          const { codexAdapter } = await import('../lib/agents/codex')
          const { cursorAdapter } = await import('../lib/agents/cursor')
          const { copilotAdapter } = await import('../lib/agents/copilot')
          registerAdapter(claudeAdapter)
          registerAdapter(codexAdapter)
          registerAdapter(cursorAdapter)
          registerAdapter(copilotAdapter)
          res.end(JSON.stringify({ agents: getInstalledAgents() }))
        } catch {
          res.end(JSON.stringify({ agents: [] }))
        }
        return
      }

      // GET /api/axon/sessions/analytics?since=ISO8601
      if (url.startsWith('/api/axon/sessions/analytics')) {
        try {
          const sinceParam = new URL(url, 'http://localhost').searchParams.get('since')
          const { getAnalytics } = await import('../lib/sessionDb')
          const data = getAnalytics(sinceParam || undefined)
          res.end(JSON.stringify(data))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // GET /api/axon/sessions/status
      if (url === '/api/axon/sessions/status') {
        try {
          const { getIndexStatus } = await import('../lib/sessionDb')
          res.end(JSON.stringify(getIndexStatus()))
        } catch {
          res.end(JSON.stringify({ totalSessions: 0, analyticsIndexed: 0, ftsIndexed: 0, ready: false }))
        }
        return
      }

      // GET /api/axon/sessions/search?q={query}
      const sessionSearchMatch = url.match(/^\/api\/axon\/sessions\/search\?q=(.+)$/)
      if (sessionSearchMatch) {
        const query = decodeURIComponent(sessionSearchMatch[1])
        try {
          const { searchSessions } = await import('../lib/sessionDb')
          const { getAllSessionMeta } = await import('../lib/sessionMeta')
          const results = searchSessions(query)
          const meta = getAllSessionMeta()
          const enriched = results.map(r => ({
            ...r,
            tags: meta[r.id]?.tags || [],
            pinned: meta[r.id]?.pinned || false,
            nickname: meta[r.id]?.nickname || null,
          }))
          res.end(JSON.stringify({ results: enriched }))
        } catch (err) {
          res.end(JSON.stringify({ results: [], error: 'Search failed' }))
        }
        return
      }

      // GET /api/axon/sessions/{id}/prompts — prompt timeline from history.jsonl
      const promptsMatch = url.match(/^\/api\/axon\/sessions\/([0-9a-f-]{36})\/prompts$/)
      if (promptsMatch) {
        const sessionId = promptsMatch[1]
        try {
          const { PromptTimelineCache } = await import('../lib/promptTimeline')
          const historyPath = join(homedir(), '.claude', 'history.jsonl')
          // Lazily create / reuse a module-level cache
          if (!(globalThis as any).__promptTimelineCache) {
            (globalThis as any).__promptTimelineCache = new PromptTimelineCache(historyPath)
          }
          const cache = (globalThis as any).__promptTimelineCache as InstanceType<typeof PromptTimelineCache>
          const prompts = cache.getPrompts(sessionId)
          res.end(JSON.stringify({ prompts }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err), prompts: [] }))
        }
        return
      }

      // GET /api/axon/sessions/by-project — sessions grouped by project
      if (url === '/api/axon/sessions/by-project') {
        try {
          const { getSessions } = await import('../lib/sessionDb')
          const { getAllSessionMeta } = await import('../lib/sessionMeta')
          const allSessions = getSessions()
          const meta = getAllSessionMeta()

          const projectMap = new Map<string, {
            projectName: string
            projectPath: string
            sessions: any[]
            totalCost: number
            lastActive: string | null
          }>()

          for (const s of allSessions) {
            const name = s.project_name || 'Unknown'
            const entry = projectMap.get(name) || {
              projectName: name,
              projectPath: s.project_path || '',
              sessions: [],
              totalCost: 0,
              lastActive: null,
            }
            const m = meta[s.id]
            entry.sessions.push({
              ...s,
              tags: m?.tags || [],
              pinned: m?.pinned || false,
              nickname: m?.nickname || null,
            })
            entry.totalCost += s.estimated_cost_usd || 0
            if (!entry.lastActive || (s.modified_at && s.modified_at > entry.lastActive)) {
              entry.lastActive = s.modified_at
            }
            projectMap.set(name, entry)
          }

          const projects = Array.from(projectMap.values())
            .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))

          res.end(JSON.stringify({ projects }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ projects: [], error: String(err) }))
        }
        return
      }

      // GET /api/axon/sessions/{id}
      const sessionDetailMatch = url.match(/^\/api\/axon\/sessions\/([0-9a-f-]{36})$/)
      if (sessionDetailMatch) {
        const id = sessionDetailMatch[1]
        try {
          const { getSessionById, getFilesTouched } = await import('../lib/sessionDb')
          const { getSessionMeta } = await import('../lib/sessionMeta')
          const session = getSessionById(id)
          if (!session) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Session not found' }))
            return
          }
          const filesTouched = getFilesTouched(id)
          const meta = getSessionMeta(id)
          res.end(JSON.stringify({ session: { ...session, ...meta }, filesTouched }))
        } catch (err) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
        return
      }

      // GET /api/axon/sessions?project={name}
      const sessionsMatch = url.match(/^\/api\/axon\/sessions(\?|&|$)/)
      if (sessionsMatch) {
        // Parse query params
        const urlObj = new URL(url, 'http://localhost')
        const projectName = resolvedProjectName || urlObj.searchParams.get('project') || undefined
        const agentParam = urlObj.searchParams.get('agent') || undefined
        try {
          const { getSessions, getIndexStatus } = await import('../lib/sessionDb')
          const { getAllSessionMeta } = await import('../lib/sessionMeta')
          const sessions = getSessions(projectName, agentParam)
          const meta = getAllSessionMeta()
          const enriched = sessions.map(s => ({
            ...s,
            tags: meta[s.id]?.tags || [],
            pinned: meta[s.id]?.pinned || false,
            nickname: meta[s.id]?.nickname || null,
          }))
          res.end(JSON.stringify({ sessions: enriched, indexStatus: getIndexStatus() }))
        } catch (err) {
          res.end(JSON.stringify({ sessions: [], indexStatus: { totalSessions: 0, analyticsIndexed: 0, ftsIndexed: 0, ready: false }, error: String(err) }))
        }
        return
      }

      // POST /api/axon/init-quick — create workspace + run genesis in background
      if (url === '/api/axon/init-quick' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        let { projectName, projectPath } = JSON.parse(body) as {
          projectName: string
          projectPath: string
        }

        // Sanitize project name — strip YAML-unsafe characters
        projectName = projectName.replace(/[^a-zA-Z0-9._-]/g, '-')

        // Handle name collisions — if workspace exists for a DIFFERENT path, disambiguate
        const wsDir = join(AXON_HOME, 'workspaces')
        let wsPath = join(wsDir, projectName)
        if (existsSync(join(wsPath, 'config.yaml'))) {
          // Check if it's the same project path
          try {
            const existingCfg = readFileSync(join(wsPath, 'config.yaml'), 'utf-8')
            const existingPath = existingCfg.match(/^project_path:\s*['"]?(.+?)['"]?\s*$/m)?.[1]?.trim()
            if (existingPath === projectPath) {
              res.end(JSON.stringify({ name: projectName, status: 'exists' }))
              return
            }
          } catch {}
          // Different path — disambiguate with parent folder name
          const parentDir = projectPath.split('/').slice(-2, -1)[0] || 'project'
          const disambiguated = `${parentDir}-${projectName}`.replace(/[^a-zA-Z0-9._-]/g, '-')
          projectName = disambiguated
          wsPath = join(wsDir, projectName)
          // If even the disambiguated name exists, bail
          if (existsSync(join(wsPath, 'config.yaml'))) {
            res.end(JSON.stringify({ name: projectName, status: 'exists' }))
            return
          }
        }

        // Pre-check: Claude CLI must be available for genesis
        const shellPath = resolvedShellPath
        let claudeAvailable = false
        try {
          execSync('which claude', { stdio: 'pipe', env: { ...process.env, PATH: shellPath }, timeout: 5000 })
          claudeAvailable = true
        } catch { /* not found */ }

        // Create workspace dirs + config.yaml synchronously
        mkdirSync(join(wsPath, 'episodes'), { recursive: true })
        mkdirSync(join(wsPath, 'dendrites'), { recursive: true })
        mkdirSync(join(wsPath, 'mornings'), { recursive: true })
        writeFileSync(join(wsPath, 'stream.md'), '')

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
        const configYaml = [
          `project: "${projectName.replace(/"/g, '\\"')}"`,
          `project_path: "${projectPath.replace(/"/g, '\\"')}"`,
          `created_at: ${new Date().toISOString()}`,
          `status: active`,
          ``,
          `dendrites:`,
          `  git-log:`,
          `    enabled: true`,
          `    max_commits: 200`,
          `  file-tree:`,
          `    enabled: true`,
          `  session-summary:`,
          `    enabled: false`,
          `  todo-state:`,
          `    enabled: true`,
          `  manual-note:`,
          `    enabled: true`,
          ``,
          `rollup:`,
          `  auto_collect: true`,
          `  context_window: 3`,
          `  model: claude-opus-4-6`,
          ``,
          `timezone: ${tz}`,
        ].join('\n')

        writeFileSync(join(wsPath, 'config.yaml'), configYaml + '\n')

        // Invalidate discovery cache
        discoveryCache = null

        // If Claude CLI is not available, create workspace but skip genesis
        if (!claudeAvailable) {
          res.end(JSON.stringify({ name: projectName, status: 'created', warning: 'Claude CLI not found — genesis skipped. Install Claude Code and run genesis later.' }))
          return
        }

        // Write genesis lock
        writeFileSync(join(wsPath, '.genesis-lock'), JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }))

        // Spawn axon-init in background (detached)
        const cleanEnv = { ...process.env }
        delete cleanEnv.CLAUDECODE
        delete cleanEnv.CLAUDE_CODE_SESSION
        cleanEnv.PATH = shellPath

        const cliDir = config.cliDir || resolve(process.cwd(), '..', 'cli')
        const initScript = join(cliDir, 'axon-init')

        const child = spawn(initScript, [], {
          stdio: 'ignore',
          detached: true,
          env: { ...cleanEnv, PROJECT: projectName, PROJECT_PATH: projectPath, AXON_HOME },
          cwd: projectPath,
        })

        child.on('close', (code) => {
          try {
            writeFileSync(
              join(wsPath, '.genesis-lock'),
              JSON.stringify(code === 0
                ? { status: 'complete' }
                : { status: 'failed', error: `Process exited with code ${code}` })
            )
          } catch {}
        })

        child.on('error', (err) => {
          try {
            writeFileSync(
              join(wsPath, '.genesis-lock'),
              JSON.stringify({ status: 'failed', error: err.message })
            )
          } catch {}
        })

        child.unref()

        res.end(JSON.stringify({ name: projectName, status: 'running' }))
        return
      }

      // GET /api/axon/init-status?project=name
      if (url.startsWith('/api/axon/init-status')) {
        const params = new URL(url, 'http://localhost').searchParams
        const project = params.get('project')
        if (!project) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Missing project parameter' }))
          return
        }

        const wsPath = join(AXON_HOME, 'workspaces', project)
        const lockPath = join(wsPath, '.genesis-lock')
        const genesisPath = join(wsPath, 'episodes', '0000_genesis.md')

        let status = 'none'
        let error: string | undefined

        if (existsSync(lockPath)) {
          try {
            const lock = JSON.parse(readFileSync(lockPath, 'utf-8'))
            status = lock.status
            error = lock.error
            // Detect stale genesis-lock: if running for >10 minutes, mark as failed
            if (lock.status === 'running' && lock.startedAt) {
              const elapsed = Date.now() - new Date(lock.startedAt).getTime()
              if (elapsed > 10 * 60 * 1000) {
                status = 'failed'
                error = 'Genesis timed out after 10 minutes'
                // Clean up the stale lock
                writeFileSync(lockPath, JSON.stringify({ status: 'failed', error: 'Timed out after 10 minutes' }))
              }
            }
          } catch {
            status = 'unknown'
          }
        } else if (existsSync(genesisPath)) {
          status = 'complete'
        }

        res.end(JSON.stringify({ status, ...(error ? { error } : {}) }))
        return
      }

      // POST /api/axon/init — SSE streaming project init
      if (url === '/api/axon/init' && req.method === 'POST') {
        const body = await new Promise<string>((resolve) => {
          let data = ''
          req.on('data', (chunk: Buffer) => { data += chunk.toString() })
          req.on('end', () => resolve(data))
        })

        const { projectName, projectPath, userContext } = JSON.parse(body) as {
          projectName: string
          projectPath: string
          userContext?: string
        }

        // Pre-check: Claude CLI must be available for genesis
        const shellPath = resolvedShellPath
        try {
          execSync('which claude', { stdio: 'pipe', env: { ...process.env, PATH: shellPath }, timeout: 5000 })
        } catch {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Claude CLI not found. Install it from claude.ai/code before running genesis.' }))
          return
        }

        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        const cleanEnv = { ...process.env }
        delete cleanEnv.CLAUDECODE
        delete cleanEnv.CLAUDE_CODE_SESSION
        cleanEnv.PATH = shellPath

        const cliDir = config.cliDir || resolve(process.cwd(), '..', 'cli')
        const initScript = join(cliDir, 'axon-init')
        const wsPath = join(AXON_HOME, 'workspaces', projectName)

        // Write genesis-lock so init-status can track progress even if SSE disconnects
        mkdirSync(join(wsPath, 'episodes'), { recursive: true })
        mkdirSync(join(wsPath, 'dendrites'), { recursive: true })
        mkdirSync(join(wsPath, 'mornings'), { recursive: true })
        writeFileSync(join(wsPath, '.genesis-lock'), JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }))

        const child = spawn(initScript, [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...cleanEnv, PROJECT: projectName, PROJECT_PATH: projectPath, AXON_HOME, ...(userContext ? { USER_CONTEXT: userContext } : {}) },
          cwd: projectPath,
        })

        let clientConnected = true

        child.stdout.on('data', (data: Buffer) => {
          if (!clientConnected) return
          const text = data.toString()
          try { res.write(`data: ${JSON.stringify({ type: 'progress', text })}\n\n`) } catch {}
        })

        child.stderr.on('data', (data: Buffer) => {
          if (!clientConnected) return
          const text = data.toString()
          try { res.write(`data: ${JSON.stringify({ type: 'log', text })}\n\n`) } catch {}
        })

        await new Promise<void>((resolveInit) => {
          child.on('close', async (code) => {
            // Update genesis-lock
            try {
              writeFileSync(join(wsPath, '.genesis-lock'), JSON.stringify(
                code === 0 ? { status: 'complete' } : { status: 'failed', error: `Process exited with code ${code}` }
              ))
            } catch {}

            if (clientConnected) {
              if (code === 0) {
                try {
                  const genesisPath = join(AXON_HOME, 'workspaces', projectName, 'episodes', '0000_genesis.md')
                  const genesisContent = await readFile(genesisPath, 'utf-8')
                  res.write(`data: ${JSON.stringify({ type: 'content', text: genesisContent })}\n\n`)
                } catch {}
              }
              try {
                res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`)
                res.end()
              } catch {}
            }
            resolveInit()
          })

          child.on('error', (err) => {
            try {
              writeFileSync(join(wsPath, '.genesis-lock'), JSON.stringify({ status: 'failed', error: err.message }))
            } catch {}
            if (clientConnected) {
              try {
                res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
                res.end()
              } catch {}
            }
            resolveInit()
          })

          req.on('close', () => {
            // Don't kill the child — let genesis complete in background
            // Client can poll /api/axon/init-status to check completion
            clientConnected = false
            child.unref()
            resolveInit()
          })
        })
        return
      }

      res.statusCode = 404
      res.end(JSON.stringify({ error: 'Not found' }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
  }
}

/* ── WebSocket upgrade handler ── */

export function handleAxonUpgrade(
  wss: import('ws').WebSocketServer,
  req: IncomingMessage,
  socket: import('stream').Duplex,
  head: Buffer,
  _axonHome?: string,
) {
  // Terminal WebSocket handler removed for security — no shell spawning
  return false
}

/* ── Process cleanup ── */

export function setupCleanupHandlers(httpServer?: { on: (event: string, fn: () => void) => void }) {
  const cleanup = () => killAllTerminals()
  process.on('exit', cleanup)
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  httpServer?.on('close', cleanup)
}
