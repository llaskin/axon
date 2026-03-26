import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getSessionDb, isSessionDbReady } from './sessionDb'
import { parseJsonlFile, parseJsonlFileLightweight, extractFtsContent } from './jsonlParser'
import { resolveProjectFromFolderId } from './projectScanner'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

export interface IndexStatus {
  totalSessions: number
  analyticsIndexed: number
  ftsIndexed: number
  ready: boolean
}

// --- Public API ---

export function runFullIndex(): void {
  getSessionDb() // ensure DB is initialized
  setImmediate(() => {
    try {
      fullIndex()
    } catch (err) {
      console.error('[Axon Indexer] Full index failed:', err)
    }
  })
}

export function getIndexStatus(): IndexStatus {
  if (!isSessionDbReady()) {
    return { totalSessions: 0, analyticsIndexed: 0, ftsIndexed: 0, ready: false }
  }

  const db = getSessionDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c
  const analytics = (db.prepare('SELECT COUNT(*) as c FROM sessions WHERE analytics_indexed = 1').get() as { c: number }).c
  const fts = (db.prepare('SELECT COUNT(*) as c FROM session_fts').get() as { c: number }).c

  return { totalSessions: total, analyticsIndexed: analytics, ftsIndexed: fts, ready: true }
}

// --- Full index (called at startup) ---

function fullIndex(): void {
  if (!existsSync(PROJECTS_DIR)) return

  console.log('[Axon Indexer] Starting full index...')
  const start = Date.now()

  // Phase 1: Basic scan from sessions-index.json (fast)
  phaseBasicScan()

  const phase1Time = Date.now() - start
  console.log(`[Axon Indexer] Phase 1 (basic scan) complete in ${phase1Time}ms`)

  // Phase 2 + 3: Background analytics + FTS
  scheduleBackgroundWork()
}

// --- Phase 1: Basic scan ---

/** Scan a single Claude project folder and upsert sessions into DB */
function scanSingleFolder(folderId: string, preResolved?: { displayName: string; projectPath: string | null }): void {
  const db = getSessionDb()
  const projectDir = join(PROJECTS_DIR, folderId)
  const indexPath = join(projectDir, 'sessions-index.json')

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, project_id, project_path, project_name,
      first_prompt, custom_title, summary, message_count,
      git_branch, created_at, modified_at, indexed_at,
      jsonl_size, jsonl_mtime, is_sidechain, analytics_indexed, agent
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, 'claude'
    )
    ON CONFLICT(id) DO UPDATE SET
      project_path = excluded.project_path,
      project_name = excluded.project_name,
      first_prompt = excluded.first_prompt,
      custom_title = excluded.custom_title,
      summary = excluded.summary,
      message_count = excluded.message_count,
      git_branch = excluded.git_branch,
      created_at = excluded.created_at,
      modified_at = excluded.modified_at,
      indexed_at = excluded.indexed_at,
      jsonl_size = excluded.jsonl_size,
      jsonl_mtime = excluded.jsonl_mtime,
      is_sidechain = excluded.is_sidechain,
      analytics_indexed = excluded.analytics_indexed
  `)

  const insertMany = db.transaction((rows: unknown[][]) => {
    for (const row of rows) {
      insertSession.run(...row)
    }
  })

  // Derive project display name + path from index (with filesystem fallback)
  const resolved = preResolved || resolveProjectFromFolderId(folderId)
  let projectName = resolved.displayName
  let projectPath: string | null = resolved.projectPath

  const indexedSessionIds = new Set<string>()
  const rows: unknown[][] = []

  if (existsSync(indexPath)) {
    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'))
      const entries = data.entries || []

      // Extract project path from first entry with one
      for (const e of entries) {
        if (e.projectPath) {
          projectPath = e.projectPath
          projectName = e.projectPath.split('/').filter(Boolean).pop() || projectName
          break
        }
      }

      for (const e of entries) {
        const sid = e.sessionId as string
        indexedSessionIds.add(sid)

        // Check if JSONL exists + get stat for change detection
        const jsonlPath = join(projectDir, `${sid}.jsonl`)
        let jsonlSize: number | null = null
        let jsonlMtime: string | null = null
        if (existsSync(jsonlPath)) {
          try {
            const st = statSync(jsonlPath)
            jsonlSize = st.size
            jsonlMtime = st.mtime.toISOString()
          } catch { /* ignore */ }
        }

        // Check if we already have this session with same file stats (skip re-index)
        const existing = db.prepare(
          'SELECT jsonl_size, jsonl_mtime, analytics_indexed FROM sessions WHERE id = ?'
        ).get(sid) as { jsonl_size: number | null; jsonl_mtime: string | null; analytics_indexed: number } | undefined

        if (existing && existing.jsonl_size === jsonlSize && existing.jsonl_mtime === jsonlMtime) {
          continue // Already indexed and file unchanged
        }

        rows.push([
          sid,
          folderId,
          e.projectPath || projectPath,
          projectName,
          (e.firstPrompt as string)?.slice(0, 200) || null,
          e.customTitle || null,
          e.summary || null,
          e.messageCount || 0,
          e.gitBranch || null,
          e.created || null,
          e.modified || null,
          new Date().toISOString(),
          jsonlSize,
          jsonlMtime,
          e.isSidechain ? 1 : 0,
          // Preserve analytics_indexed if we're updating
          existing?.analytics_indexed ?? 0
        ])
      }
    } catch (err) {
      console.error(`[Axon Indexer] Failed to parse index for ${folderId}:`, err)
    }
  }

  // Find orphan JSONL files not in the index
  try {
    const jsonlFiles = readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'))
    for (const file of jsonlFiles) {
      const sid = file.replace('.jsonl', '')
      if (indexedSessionIds.has(sid)) continue

      const jsonlPath = join(projectDir, file)
      let jsonlSize: number | null = null
      let jsonlMtime: string | null = null
      try {
        const st = statSync(jsonlPath)
        jsonlSize = st.size
        jsonlMtime = st.mtime.toISOString()
      } catch { continue }

      // Skip if already indexed and unchanged
      const existing = db.prepare(
        'SELECT jsonl_size, jsonl_mtime FROM sessions WHERE id = ?'
      ).get(sid) as { jsonl_size: number | null; jsonl_mtime: string | null } | undefined

      if (existing && existing.jsonl_size === jsonlSize && existing.jsonl_mtime === jsonlMtime) {
        continue
      }

      // Lightweight parse for orphans
      const parsed = parseJsonlFileLightweight(jsonlPath)
      if (!parsed) continue

      rows.push([
        sid,
        folderId,
        projectPath,
        projectName,
        parsed.firstPrompt,
        null, // customTitle
        null, // summary
        parsed.messageCount,
        null, // gitBranch
        parsed.created,
        parsed.modified,
        new Date().toISOString(),
        jsonlSize,
        jsonlMtime,
        0, // is_sidechain
        0  // analytics_indexed
      ])
    }
  } catch { /* ignore */ }

  // Batch insert per project
  if (rows.length > 0) {
    insertMany(rows)
  }
}

function phaseBasicScan(): void {
  if (!existsSync(PROJECTS_DIR)) return

  const folders = readdirSync(PROJECTS_DIR).filter((f) => {
    try { return statSync(join(PROJECTS_DIR, f)).isDirectory() }
    catch { return false }
  })

  for (const folderId of folders) {
    scanSingleFolder(folderId)
  }
}

/**
 * Synchronously scan a single project's sessions into DB.
 * Used by forceIndex to ensure fresh data before returning query results.
 */
export function scanProjectSync(targetPath: string): void {
  if (!existsSync(PROJECTS_DIR)) return
  getSessionDb()

  // Normalize: expand ~ and strip trailing slashes for reliable comparison
  const normalized = targetPath.replace(/^~/, homedir()).replace(/\/+$/, '')

  const folders = readdirSync(PROJECTS_DIR).filter((f) => {
    try { return statSync(join(PROJECTS_DIR, f)).isDirectory() }
    catch { return false }
  })

  for (const folderId of folders) {
    const resolved = resolveProjectFromFolderId(folderId)
    if (resolved.projectPath && resolved.projectPath.replace(/\/+$/, '') === normalized) {
      scanSingleFolder(folderId, resolved)
      return
    }
  }
}

// --- Phase 2 + 3: Background analytics + FTS ---

function scheduleBackgroundWork(): void {
  const db = getSessionDb()

  // Get sessions needing analytics
  const needsAnalytics = db.prepare(
    'SELECT id, project_id FROM sessions WHERE analytics_indexed = 0'
  ).all() as Array<{ id: string; project_id: string }>

  // Get sessions needing FTS
  const allSessionIds = db.prepare('SELECT id FROM sessions').all() as Array<{ id: string }>
  const ftsSessionIds = new Set(
    (db.prepare('SELECT session_id FROM session_fts').all() as Array<{ session_id: string }>)
      .map((r) => r.session_id)
  )
  const needsFts = allSessionIds.filter((r) => !ftsSessionIds.has(r.id))

  console.log(`[Axon Indexer] Background: ${needsAnalytics.length} need analytics, ${needsFts.length} need FTS`)

  let analyticsIdx = 0
  let ftsIdx = 0

  const processBatch = (): void => {
    const batchStart = Date.now()
    let processed = 0
    const BATCH_SIZE = 5
    const BATCH_TIME_LIMIT = 200 // ms

    // Process analytics
    while (analyticsIdx < needsAnalytics.length && processed < BATCH_SIZE && (Date.now() - batchStart) < BATCH_TIME_LIMIT) {
      const { id, project_id } = needsAnalytics[analyticsIdx++]
      try {
        indexSessionAnalytics(id, project_id)
        processed++
      } catch (err) {
        console.error(`[Axon Indexer] Analytics failed for ${id}:`, err)
        // Mark as indexed so the counter advances past failures
        try { getSessionDb().prepare('UPDATE sessions SET analytics_indexed = 1 WHERE id = ?').run(id) } catch {}
      }
    }

    // Process FTS
    while (ftsIdx < needsFts.length && processed < BATCH_SIZE && (Date.now() - batchStart) < BATCH_TIME_LIMIT) {
      const { id } = needsFts[ftsIdx++]
      try {
        indexSessionFts(id)
        processed++
      } catch (err) {
        console.error(`[Axon Indexer] FTS failed for ${id}:`, err)
      }
    }

    // Continue if more work
    if (analyticsIdx < needsAnalytics.length || ftsIdx < needsFts.length) {
      setImmediate(processBatch)
    } else {
      console.log(`[Axon Indexer] Background indexing complete`)
    }
  }

  if (needsAnalytics.length > 0 || needsFts.length > 0) {
    setImmediate(processBatch)
  }
}

interface ParsedFileTouchRow {
  sessionId: string
  filePath: string
  operations: string
  count: number
}

function indexSessionAnalytics(sessionId: string, projectId: string): void {
  const db = getSessionDb()
  const jsonlPath = join(PROJECTS_DIR, projectId, `${sessionId}.jsonl`)
  const parsed = parseJsonlFile(jsonlPath)
  if (!parsed) {
    // Mark as indexed anyway so the counter advances (file missing/corrupt/empty)
    db.prepare('UPDATE sessions SET analytics_indexed = 1 WHERE id = ?').run(sessionId)
    return
  }

  // Update session with analytics
  db.prepare(`
    UPDATE sessions SET
      message_count = ?,
      tool_call_count = ?,
      files_touched_count = ?,
      bash_commands = ?,
      errors = ?,
      estimated_input_tokens = ?,
      estimated_output_tokens = ?,
      estimated_cost_usd = ?,
      estimated_total_tokens = ? + ?,
      heuristic_summary = ?,
      heatstrip_json = ?,
      tool_calls_json = ?,
      git_commands_json = ?,
      model = COALESCE(?, model),
      analytics_indexed = 1
    WHERE id = ?
  `).run(
    parsed.messageCount,
    parsed.totalToolCalls,
    parsed.filesTouched.length,
    parsed.bashCommands,
    parsed.errors,
    parsed.estimatedInputTokens,
    parsed.estimatedOutputTokens,
    parsed.estimatedCostUsd,
    parsed.estimatedInputTokens,
    parsed.estimatedOutputTokens,
    parsed.heuristicSummary,
    JSON.stringify(parsed.heatStrip),
    JSON.stringify(parsed.toolCalls),
    JSON.stringify(parsed.gitCommands),
    parsed.dominantModel,
    sessionId
  )

  // Upsert files_touched
  const upsertFile = db.prepare(`
    INSERT INTO files_touched (session_id, file_path, operations, count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, file_path) DO UPDATE SET
      operations = excluded.operations,
      count = excluded.count
  `)

  const upsertMany = db.transaction((files: ParsedFileTouchRow[]) => {
    for (const f of files) {
      upsertFile.run(f.sessionId, f.filePath, f.operations, f.count)
    }
  })

  if (parsed.filesTouched.length > 0) {
    upsertMany(parsed.filesTouched.map((f) => ({
      sessionId,
      filePath: f.path,
      operations: JSON.stringify(f.operations),
      count: f.count
    })))
  }
}

function indexSessionFts(sessionId: string): void {
  const db = getSessionDb()

  // Get project info for the session
  const session = db.prepare(
    'SELECT project_id, project_name FROM sessions WHERE id = ?'
  ).get(sessionId) as { project_id: string; project_name: string } | undefined

  if (!session) return

  const jsonlPath = join(PROJECTS_DIR, session.project_id, `${sessionId}.jsonl`)
  const content = extractFtsContent(jsonlPath)
  if (!content) return

  // Delete existing FTS entry then insert fresh
  db.prepare('DELETE FROM session_fts WHERE session_id = ?').run(sessionId)
  db.prepare(
    'INSERT INTO session_fts (session_id, project_name, content) VALUES (?, ?, ?)'
  ).run(sessionId, session.project_name, content)
}

// --- Incremental indexing (called from watcher) ---

export function indexSession(projectId: string, sessionId: string): void {
  if (!isSessionDbReady()) return
  const db = getSessionDb()

  const projectDir = join(PROJECTS_DIR, projectId)
  const jsonlPath = join(projectDir, `${sessionId}.jsonl`)

  if (!existsSync(jsonlPath)) {
    // Session file deleted — remove from DB
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    db.prepare('DELETE FROM session_fts WHERE session_id = ?').run(sessionId)
    return
  }

  let jsonlSize: number | null = null
  let jsonlMtime: string | null = null
  try {
    const st = statSync(jsonlPath)
    jsonlSize = st.size
    jsonlMtime = st.mtime.toISOString()
  } catch { return }

  // Check if unchanged
  const existing = db.prepare(
    'SELECT jsonl_size, jsonl_mtime FROM sessions WHERE id = ?'
  ).get(sessionId) as { jsonl_size: number | null; jsonl_mtime: string | null } | undefined

  if (existing && existing.jsonl_size === jsonlSize && existing.jsonl_mtime === jsonlMtime) {
    return // No change
  }

  // Re-read project info from sessions-index.json (with filesystem fallback)
  const resolved = resolveProjectFromFolderId(projectId)
  let projectName = resolved.displayName
  let projectPath: string | null = resolved.projectPath
  let firstPrompt: string | null = null
  let customTitle: string | null = null
  let summary: string | null = null
  let messageCount = 0
  let gitBranch: string | null = null
  let created: string | null = null
  let modified: string | null = null
  let isSidechain = false

  const indexPath = join(projectDir, 'sessions-index.json')
  let foundInIndex = false

  if (existsSync(indexPath)) {
    try {
      const data = JSON.parse(readFileSync(indexPath, 'utf-8'))
      const entries = data.entries || []

      for (const e of entries) {
        if (e.projectPath && !projectPath) {
          projectPath = e.projectPath
          projectName = e.projectPath.split('/').filter(Boolean).pop() || projectName
        }
        if (e.sessionId === sessionId) {
          foundInIndex = true
          firstPrompt = (e.firstPrompt as string)?.slice(0, 200) || null
          customTitle = e.customTitle || null
          summary = e.summary || null
          messageCount = e.messageCount || 0
          gitBranch = e.gitBranch || null
          created = e.created || null
          modified = e.modified || null
          isSidechain = e.isSidechain || false
          if (e.projectPath) projectPath = e.projectPath
        }
      }
    } catch { /* ignore */ }
  }

  // If not in index, do a lightweight parse
  if (!foundInIndex) {
    const parsed = parseJsonlFileLightweight(jsonlPath)
    if (parsed) {
      firstPrompt = parsed.firstPrompt
      created = parsed.created
      modified = parsed.modified
      messageCount = parsed.messageCount
    }
  }

  // Upsert session (reset analytics_indexed so it gets re-processed)
  db.prepare(`
    INSERT INTO sessions (
      id, project_id, project_path, project_name,
      first_prompt, custom_title, summary, message_count,
      git_branch, created_at, modified_at, indexed_at,
      jsonl_size, jsonl_mtime, is_sidechain, analytics_indexed, agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'claude')
    ON CONFLICT(id) DO UPDATE SET
      project_path = excluded.project_path,
      project_name = excluded.project_name,
      first_prompt = excluded.first_prompt,
      custom_title = excluded.custom_title,
      summary = excluded.summary,
      message_count = excluded.message_count,
      git_branch = excluded.git_branch,
      created_at = excluded.created_at,
      modified_at = excluded.modified_at,
      indexed_at = excluded.indexed_at,
      jsonl_size = excluded.jsonl_size,
      jsonl_mtime = excluded.jsonl_mtime,
      is_sidechain = excluded.is_sidechain,
      analytics_indexed = 0
  `).run(
    sessionId, projectId, projectPath, projectName,
    firstPrompt, customTitle, summary, messageCount,
    gitBranch, created, modified, new Date().toISOString(),
    jsonlSize, jsonlMtime, isSidechain ? 1 : 0
  )

  // Re-index analytics + FTS in background
  setImmediate(() => {
    try {
      indexSessionAnalytics(sessionId, projectId)
      indexSessionFts(sessionId)
    } catch (err) {
      console.error(`[Axon Indexer] Incremental re-index failed for ${sessionId}:`, err)
    }
  })
}
