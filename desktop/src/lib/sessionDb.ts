import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { execSync } from 'child_process'

let db: Database.Database | null = null
let rebuildAttempted = false
const DB_PATH = join(homedir(), '.axon', 'sessions.db')

export function getSessionDb(): Database.Database {
  if (db) return db
  mkdirSync(join(homedir(), '.axon'), { recursive: true })
  try {
    db = new Database(DB_PATH)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NODE_MODULE_VERSION') && !rebuildAttempted) {
      rebuildAttempted = true
      console.warn('[Axon] better-sqlite3 version mismatch — attempting auto-rebuild...')
      try {
        const desktopDir = join(__dirname, '..')
        execSync('npm rebuild better-sqlite3', { cwd: desktopDir, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' })
        console.log('[Axon] better-sqlite3 rebuilt successfully. Retrying...')
        // Clear Node's module cache for better-sqlite3
        const modKeys = Object.keys(require.cache).filter(k => k.includes('better-sqlite3'))
        modKeys.forEach(k => delete require.cache[k])
        // Re-require and retry
        db = new Database(DB_PATH)
      } catch (rebuildErr) {
        console.error('[Axon] Auto-rebuild failed. Run: cd desktop && npm rebuild better-sqlite3')
        throw err
      }
    } else {
      throw err
    }
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)
  return db
}

export function isSessionDbReady(): boolean {
  return db !== null
}

// --- Migrations (from AXON-release migrations.ts) ---

function runMigrations(db: Database.Database): void {
  const version = (db.pragma('user_version', { simple: true }) as number) || 0
  if (version < 1) migrateV1(db)
  if (version < 2) migrateV2(db)
}

function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_path TEXT,
      project_name TEXT NOT NULL,
      first_prompt TEXT,
      custom_title TEXT,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      files_touched_count INTEGER DEFAULT 0,
      bash_commands INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      estimated_input_tokens INTEGER DEFAULT 0,
      estimated_output_tokens INTEGER DEFAULT 0,
      estimated_cost_usd REAL,
      git_branch TEXT,
      heuristic_summary TEXT,
      heatstrip_json TEXT,
      tool_calls_json TEXT,
      git_commands_json TEXT,
      created_at TEXT,
      modified_at TEXT,
      indexed_at TEXT NOT NULL,
      jsonl_size INTEGER,
      jsonl_mtime TEXT,
      analytics_indexed INTEGER DEFAULT 0,
      is_sidechain INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_modified ON sessions(project_id, modified_at);

    CREATE TABLE IF NOT EXISTS files_touched (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      operations TEXT NOT NULL,
      count INTEGER DEFAULT 1,
      UNIQUE(session_id, file_path)
    );

    CREATE INDEX IF NOT EXISTS idx_files_path ON files_touched(file_path);
    CREATE INDEX IF NOT EXISTS idx_files_session ON files_touched(session_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
      session_id UNINDEXED,
      project_name,
      content,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    PRAGMA user_version = 1;
  `)
}

function migrateV2(db: Database.Database): void {
  db.exec(`
    ALTER TABLE sessions ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude';
    ALTER TABLE sessions ADD COLUMN model TEXT;
    ALTER TABLE sessions ADD COLUMN estimated_total_tokens INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent_modified ON sessions(agent, modified_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  `)
  // Backfill estimated_total_tokens from existing input+output
  db.exec(`
    UPDATE sessions SET estimated_total_tokens = estimated_input_tokens + estimated_output_tokens
    WHERE estimated_total_tokens = 0 AND (estimated_input_tokens > 0 OR estimated_output_tokens > 0);
  `)
  // Reset analytics_indexed so sessions get re-parsed for model extraction
  db.exec(`UPDATE sessions SET analytics_indexed = 0;`)
  db.pragma('user_version = 2')
}

// --- Query helpers ---

export interface SessionRow {
  id: string
  project_id: string
  project_path: string | null
  project_name: string
  first_prompt: string | null
  custom_title: string | null
  summary: string | null
  message_count: number
  tool_call_count: number
  files_touched_count: number
  bash_commands: number
  errors: number
  estimated_input_tokens: number
  estimated_output_tokens: number
  estimated_cost_usd: number | null
  git_branch: string | null
  heuristic_summary: string | null
  heatstrip_json: string | null
  tool_calls_json: string | null
  git_commands_json: string | null
  created_at: string | null
  modified_at: string | null
  indexed_at: string
  analytics_indexed: number
  is_sidechain: number
  agent: string
  model: string | null
  estimated_total_tokens: number
}

export interface FileTouchedRow {
  id: number
  session_id: string
  file_path: string
  operations: string
  count: number
}

export interface SearchResult {
  id: string
  project_name: string
  first_prompt: string | null
  heuristic_summary: string | null
  message_count: number
  tool_call_count: number
  estimated_cost_usd: number | null
  heatstrip_json: string | null
  created_at: string | null
  modified_at: string | null
  git_branch: string | null
  snippet: string
}

export interface IndexStatus {
  totalSessions: number
  analyticsIndexed: number
  ftsIndexed: number
  ready: boolean
}

export function getSessions(projectName?: string, agent?: string): SessionRow[] {
  const db = getSessionDb()
  let sql = 'SELECT * FROM sessions'
  const conditions: string[] = []
  const params: any[] = []
  if (projectName) { conditions.push('project_name = ?'); params.push(projectName) }
  if (agent) { conditions.push('agent = ?'); params.push(agent) }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
  sql += ' ORDER BY modified_at DESC'
  return db.prepare(sql).all(...params) as SessionRow[]
}

export function getSessionById(id: string): SessionRow | null {
  const db = getSessionDb()
  return (db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow) || null
}

export function getFilesTouched(sessionId: string): FileTouchedRow[] {
  const db = getSessionDb()
  return db.prepare(
    'SELECT * FROM files_touched WHERE session_id = ? ORDER BY count DESC'
  ).all(sessionId) as FileTouchedRow[]
}

export function searchSessions(query: string, limit = 50): SearchResult[] {
  const db = getSessionDb()
  return db.prepare(`
    SELECT
      s.id, s.project_name, s.first_prompt, s.heuristic_summary,
      s.message_count, s.tool_call_count, s.estimated_cost_usd,
      s.heatstrip_json, s.created_at, s.modified_at, s.git_branch,
      snippet(session_fts, 2, '<mark>', '</mark>', '…', 40) as snippet
    FROM session_fts
    JOIN sessions s ON s.id = session_fts.session_id
    WHERE session_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit) as SearchResult[]
}

export function getIndexStatus(): IndexStatus {
  const db = getSessionDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c
  const analytics = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE analytics_indexed = 1').get() as { c: number }).c
  const fts = (db.prepare('SELECT COUNT(*) as c FROM session_fts').get() as { c: number }).c
  return { totalSessions: total, analyticsIndexed: analytics, ftsIndexed: fts, ready: true }
}

// --- Analytics ---

export interface AnalyticsData {
  totalTokens: number
  avgTokensPerSession: number
  totalSessions: number
  tokensByAgent: { agent: string; tokens: number }[]
  tokensByModel: { model: string; agent: string; tokens: number }[]
  activeAgents: string[]
}

export function getAnalytics(since?: string): AnalyticsData {
  const db = getSessionDb()
  const whereClause = since ? 'WHERE created_at >= ?' : ''
  const params = since ? [since] : []

  const totals = db.prepare(`
    SELECT COUNT(*) as cnt, COALESCE(SUM(estimated_total_tokens), 0) as total
    FROM sessions ${whereClause}
  `).get(...params) as any

  const byAgent = db.prepare(`
    SELECT agent, COALESCE(SUM(estimated_total_tokens), 0) as tokens
    FROM sessions ${whereClause}
    GROUP BY agent ORDER BY tokens DESC
  `).all(...params) as any[]

  const byModel = db.prepare(`
    SELECT model, agent, COALESCE(SUM(estimated_total_tokens), 0) as tokens
    FROM sessions ${since ? 'WHERE model IS NOT NULL AND created_at >= ?' : 'WHERE model IS NOT NULL'}
    GROUP BY model, agent ORDER BY tokens DESC
  `).all(...params) as any[]

  const agents = db.prepare(`
    SELECT DISTINCT agent FROM sessions ${whereClause}
  `).all(...params) as any[]

  return {
    totalTokens: totals.total || 0,
    avgTokensPerSession: totals.cnt > 0 ? Math.round((totals.total || 0) / totals.cnt) : 0,
    totalSessions: totals.cnt || 0,
    tokensByAgent: byAgent.map((r: any) => ({ agent: r.agent, tokens: r.tokens || 0 })),
    tokensByModel: byModel.map((r: any) => ({ model: r.model || 'unknown', agent: r.agent, tokens: r.tokens || 0 })),
    activeAgents: agents.map((r: any) => r.agent),
  }
}

// --- Agent session upsert ---

export function upsertAgentSessions(sessions: import('./agents/types').AgentSession[]): void {
  const db = getSessionDb()
  const stmt = db.prepare(`
    INSERT INTO sessions (
      id, project_id, project_path, project_name,
      first_prompt, summary, heuristic_summary, message_count,
      tool_call_count, bash_commands, errors,
      estimated_input_tokens, estimated_output_tokens, estimated_total_tokens,
      estimated_cost_usd, git_branch, heatstrip_json, tool_calls_json, git_commands_json,
      created_at, modified_at, indexed_at, agent, model, analytics_indexed
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      NULL, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, 1
    )
    ON CONFLICT(id) DO UPDATE SET
      modified_at = excluded.modified_at,
      message_count = excluded.message_count,
      estimated_total_tokens = excluded.estimated_total_tokens,
      indexed_at = excluded.indexed_at
  `)

  const tx = db.transaction(() => {
    for (const s of sessions) {
      stmt.run(
        s.id, s.agent, s.projectPath, s.projectName || s.agent,
        s.firstPrompt, s.summary, s.heuristicSummary, s.messageCount,
        s.toolCallCount, s.bashCommands, s.errors,
        s.estimatedInputTokens, s.estimatedOutputTokens, s.estimatedTotalTokens,
        s.gitBranch, s.heatstripJson, s.toolCallsJson, s.gitCommandsJson,
        s.createdAt, s.modifiedAt, new Date().toISOString(), s.agent, s.model,
      )
    }
  })
  tx()
}
