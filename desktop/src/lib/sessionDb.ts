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

export function getSessions(projectName?: string): SessionRow[] {
  const db = getSessionDb()
  if (projectName) {
    return db.prepare(
      'SELECT * FROM sessions WHERE project_name = ? ORDER BY modified_at DESC'
    ).all(projectName) as SessionRow[]
  }
  return db.prepare(
    'SELECT * FROM sessions ORDER BY modified_at DESC'
  ).all() as SessionRow[]
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
