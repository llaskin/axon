// jobsDb.ts — SQLite-backed job history. Tracks rollup/collect/bridge runs per project.

import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, existsSync } from 'fs'

// ─── Types ───────────────────────────────────────────────────────

export type JobType = 'rollup' | 'collect' | 'bridge'
export type JobStatus = 'running' | 'success' | 'failed'

export interface JobItem {
  id: number
  type: JobType
  status: JobStatus
  error?: string
  started_at: string    // ISO8601
  finished_at?: string  // ISO8601
  duration_s?: number
  cost?: number         // USD
  episode?: string      // filename if rollup succeeded
  meta?: Record<string, unknown>  // step timings, dendrite counts, etc.
}

export interface JobSummary {
  total: number
  success: number
  failed: number
  running: number
  total_cost: number
  avg_duration_s: number
  last_run?: JobItem
  last_success?: JobItem
  last_failure?: JobItem
}

// ─── DB Lifecycle ────────────────────────────────────────────────

const cache = new Map<string, Database.Database>()

function axonHome(): string {
  return process.env.AXON_HOME || join(homedir(), '.axon')
}

function wsDir(project: string): string {
  return join(axonHome(), 'workspaces', project)
}

export function getJobsDb(project: string): Database.Database {
  if (cache.has(project)) return cache.get(project)!

  const dir = wsDir(project)
  const dbPath = join(dir, 'jobs.db')

  mkdirSync(dir, { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  runMigrations(db)

  cache.set(project, db)
  return db
}

export function closeJobsDb(project: string): void {
  const db = cache.get(project)
  if (db) {
    db.close()
    cache.delete(project)
  }
}

// ─── Migrations ──────────────────────────────────────────────────

function runMigrations(db: Database.Database): void {
  const version = (db.pragma('user_version', { simple: true }) as number) || 0
  if (version < 1) migrateV1(db)
}

function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          INTEGER PRIMARY KEY,
      type        TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'running',
      error       TEXT,
      started_at  TEXT    NOT NULL,
      finished_at TEXT,
      duration_s  REAL,
      cost        REAL,
      episode     TEXT,
      meta        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_started ON jobs(started_at);

    PRAGMA user_version = 1;
  `)
}

// ─── Row ↔ JobItem ───────────────────────────────────────────────

interface JobRow {
  id: number
  type: string
  status: string
  error: string | null
  started_at: string
  finished_at: string | null
  duration_s: number | null
  cost: number | null
  episode: string | null
  meta: string | null
}

function rowToItem(row: JobRow): JobItem {
  const item: JobItem = {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    started_at: row.started_at,
  }
  if (row.error) item.error = row.error
  if (row.finished_at) item.finished_at = row.finished_at
  if (row.duration_s != null) item.duration_s = row.duration_s
  if (row.cost != null) item.cost = row.cost
  if (row.episode) item.episode = row.episode
  if (row.meta) {
    try { item.meta = JSON.parse(row.meta) } catch { /* ignore malformed */ }
  }
  return item
}

// ─── CRUD ────────────────────────────────────────────────────────

export function startJob(project: string, type: JobType): JobItem {
  const db = getJobsDb(project)
  const started_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  const result = db.prepare(`
    INSERT INTO jobs (type, status, started_at)
    VALUES (?, 'running', ?)
  `).run(type, started_at)

  return getJob(project, result.lastInsertRowid as number)!
}

export function finishJob(project: string, id: number, outcome: {
  status: 'success' | 'failed'
  error?: string
  cost?: number
  episode?: string
  meta?: Record<string, unknown>
}): JobItem {
  const db = getJobsDb(project)
  const finished_at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Calculate duration from started_at
  const row = db.prepare('SELECT started_at FROM jobs WHERE id = ?').get(id) as { started_at: string } | undefined
  let duration_s: number | null = null
  if (row) {
    const start = new Date(row.started_at).getTime()
    const end = new Date(finished_at).getTime()
    duration_s = Math.round((end - start) / 1000 * 100) / 100
  }

  const metaJson = outcome.meta ? JSON.stringify(outcome.meta) : null

  db.prepare(`
    UPDATE jobs SET
      status = ?,
      error = ?,
      finished_at = ?,
      duration_s = ?,
      cost = ?,
      episode = ?,
      meta = ?
    WHERE id = ?
  `).run(
    outcome.status,
    outcome.error || null,
    finished_at,
    duration_s,
    outcome.cost || null,
    outcome.episode || null,
    metaJson,
    id,
  )

  return getJob(project, id)!
}

export function getJob(project: string, id: number): JobItem | null {
  const db = getJobsDb(project)
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined
  return row ? rowToItem(row) : null
}

export function listJobs(project: string, opts?: {
  type?: JobType
  status?: JobStatus
  limit?: number
  offset?: number
}): JobItem[] {
  const db = getJobsDb(project)
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.type) { conditions.push('type = ?'); params.push(opts.type) }
  if (opts?.status) { conditions.push('status = ?'); params.push(opts.status) }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = opts?.limit || 50
  const offset = opts?.offset || 0

  const rows = db.prepare(
    `SELECT * FROM jobs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as JobRow[]

  return rows.map(rowToItem)
}

export function jobSummary(project: string, type?: JobType): JobSummary {
  const db = getJobsDb(project)
  const typeFilter = type ? ' WHERE type = ?' : ''
  const params = type ? [type] : []

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) as success,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running,
      COALESCE(SUM(CASE WHEN status = 'success' THEN cost ELSE 0 END), 0) as total_cost,
      COALESCE(AVG(CASE WHEN status = 'success' THEN duration_s END), 0) as avg_duration_s
    FROM jobs${typeFilter}
  `).get(...params) as {
    total: number; success: number; failed: number; running: number
    total_cost: number; avg_duration_s: number
  }

  const lastRun = db.prepare(
    `SELECT * FROM jobs${typeFilter} ORDER BY id DESC LIMIT 1`
  ).get(...params) as JobRow | undefined

  const lastSuccess = db.prepare(
    `SELECT * FROM jobs${typeFilter ? typeFilter + " AND status = 'success'" : " WHERE status = 'success'"} ORDER BY id DESC LIMIT 1`
  ).get(...params) as JobRow | undefined

  const lastFailure = db.prepare(
    `SELECT * FROM jobs${typeFilter ? typeFilter + " AND status = 'failed'" : " WHERE status = 'failed'"} ORDER BY id DESC LIMIT 1`
  ).get(...params) as JobRow | undefined

  return {
    total: stats.total,
    success: stats.success,
    failed: stats.failed,
    running: stats.running,
    total_cost: Math.round(stats.total_cost * 100) / 100,
    avg_duration_s: Math.round(stats.avg_duration_s * 100) / 100,
    last_run: lastRun ? rowToItem(lastRun) : undefined,
    last_success: lastSuccess ? rowToItem(lastSuccess) : undefined,
    last_failure: lastFailure ? rowToItem(lastFailure) : undefined,
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────

export function cleanStaleJobs(project: string, maxAgeMinutes: number = 60): number {
  const db = getJobsDb(project)
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString()

  const result = db.prepare(`
    UPDATE jobs SET status = 'failed', error = 'stale_timeout', finished_at = datetime('now')
    WHERE status = 'running' AND started_at < ?
  `).run(cutoff)

  return result.changes
}
