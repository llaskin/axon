# Multi-Agent Analytics & Unified Session Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Axon from Claude-only to a multi-agent session viewer with Analytics dashboard, agent adapters for Claude/Codex/Cursor/Copilot, and per-agent rollup workspaces.

**Architecture:** Agent Adapter pattern — each agent implements a common interface normalizing its native data into a shared sessions DB (with new `agent`, `model`, `estimated_total_tokens` columns). Analytics view replaces Canvas. Agent filter pills in Day/Sessions views. Per-agent + unified rollup workspaces.

**Tech Stack:** TypeScript, React 19, Zustand, better-sqlite3, Vitest, bash

**Spec:** `docs/superpowers/specs/2026-03-26-multi-agent-analytics-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `desktop/src/lib/agents/types.ts` | AgentAdapter interface, AgentSession type |
| `desktop/src/lib/agents/registry.ts` | AgentRegistry — discovery, installed agents |
| `desktop/src/lib/agents/claude.ts` | Claude adapter (wraps sessionIndexer) |
| `desktop/src/lib/agents/codex.ts` | Codex adapter (reads state_5.sqlite) |
| `desktop/src/lib/agents/cursor.ts` | Cursor adapter (reads ai-tracking DB) |
| `desktop/src/lib/agents/copilot.ts` | Copilot adapter (reads command-history) |
| `desktop/src/lib/agents/registry.test.ts` | Tests for registry + adapters |
| `desktop/src/views/AnalyticsView.tsx` | Analytics dashboard component |
| `desktop/src/hooks/useAnalytics.ts` | React hook for analytics data |

### Modified Files
| File | What Changes |
|------|-------------|
| `desktop/src/lib/sessionDb.ts` | Migration V2: add `agent`, `model`, `estimated_total_tokens` columns |
| `desktop/src/lib/sessionIndexer.ts` | Add `agent='claude'` to INSERT, change to ON CONFLICT |
| `desktop/src/views/SessionsView.tsx` | Remove Canvas, add Analytics tab, agent filter pills, agent badge |
| `desktop/src/hooks/useSessions.ts` | Add `agent` field to SessionSummary, add `useSessionsByAgent` hook |
| `desktop/src/server/axonMiddleware.ts` | Add `GET /sessions/analytics` endpoint, `?agent=` filter param |
| `desktop/src/lib/sessionDendrite.ts` | Add `--agent` flag with migration-aware fallback |
| `desktop/src/components/layout/Sidebar.tsx` | Rename label to "Agent Sessions" |

### Removed Files
| File | Reason |
|------|--------|
| `desktop/src/views/agent/CanvasView.tsx` | Canvas replaced by Analytics |
| `desktop/src/views/agent/useCanvasState.ts` | Canvas state no longer needed |
| `desktop/src/views/agent/ZoneTree.tsx` | Zone tree was Canvas-only |
| `desktop/src/views/agent/zoneReducers.ts` | Zone/tile reducers no longer needed |

---

### Task 1: Agent Types & Registry

**Files:**
- Create: `desktop/src/lib/agents/types.ts`
- Create: `desktop/src/lib/agents/registry.ts`

- [ ] **Step 1: Create agent types**

```typescript
// desktop/src/lib/agents/types.ts
export type AgentId = 'claude' | 'codex' | 'cursor' | 'copilot'

export interface AgentInfo {
  id: AgentId
  name: string
  color: string
}

export const AGENTS: Record<AgentId, AgentInfo> = {
  claude: { id: 'claude', name: 'Claude Code', color: '#D97706' },
  codex: { id: 'codex', name: 'Codex', color: '#10B981' },
  cursor: { id: 'cursor', name: 'Cursor', color: '#6366F1' },
  copilot: { id: 'copilot', name: 'GitHub Copilot', color: '#8B5CF6' },
}

export interface AgentAdapter {
  info: AgentInfo
  isInstalled(): boolean
  discoverSessions(): AgentSession[]
}

export interface AgentSession {
  id: string
  agent: AgentId
  model: string | null
  firstPrompt: string | null
  summary: string | null
  heuristicSummary: string | null
  messageCount: number
  toolCallCount: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  createdAt: string | null
  modifiedAt: string | null
  projectPath: string | null
  projectName: string | null
  gitBranch: string | null
  heatstripJson: string | null
  toolCallsJson: string | null
  gitCommandsJson: string | null
  bashCommands: number
  errors: number
}
```

- [ ] **Step 2: Create agent registry**

```typescript
// desktop/src/lib/agents/registry.ts
import type { AgentAdapter, AgentId, AgentInfo } from './types'
import { AGENTS } from './types'

const adapters = new Map<AgentId, AgentAdapter>()

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.info.id, adapter)
}

export function getAdapter(id: AgentId): AgentAdapter | undefined {
  return adapters.get(id)
}

export function getInstalledAgents(): AgentInfo[] {
  return Array.from(adapters.values())
    .filter(a => a.isInstalled())
    .map(a => a.info)
}

export function getAllAdapters(): AgentAdapter[] {
  return Array.from(adapters.values())
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/lib/agents/
git commit -m "feat: add agent adapter types and registry"
```

---

### Task 2: Database Migration V2

**Files:**
- Modify: `desktop/src/lib/sessionDb.ts`

- [ ] **Step 1: Add migrateV2 function after migrateV1**

After the existing `migrateV1` function (around line 117), add:

```typescript
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
  db.pragma('user_version = 2')
}
```

Update `runMigrations`:
```typescript
function runMigrations(db: Database.Database): void {
  const version = (db.pragma('user_version', { simple: true }) as number) || 0
  if (version < 1) migrateV1(db)
  if (version < 2) migrateV2(db)
}
```

- [ ] **Step 2: Update SessionRow interface to include new columns**

Add to the `SessionRow` interface:
```typescript
  agent: string
  model: string | null
  estimated_total_tokens: number
```

- [ ] **Step 3: Add getSessions agent filter and getAnalytics function**

```typescript
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
    SELECT COUNT(*) as cnt, SUM(estimated_total_tokens) as total
    FROM sessions ${whereClause}
  `).get(...params) as any

  const byAgent = db.prepare(`
    SELECT agent, SUM(estimated_total_tokens) as tokens
    FROM sessions ${whereClause}
    GROUP BY agent ORDER BY tokens DESC
  `).all(...params) as any[]

  const byModel = db.prepare(`
    SELECT model, agent, SUM(estimated_total_tokens) as tokens
    FROM sessions ${whereClause.replace('WHERE', 'WHERE model IS NOT NULL AND')}
    ${whereClause ? '' : 'WHERE model IS NOT NULL'}
    GROUP BY model, agent ORDER BY tokens DESC
  `).all(...params) as any[]

  const agents = db.prepare(`
    SELECT DISTINCT agent FROM sessions ${whereClause}
  `).all(...params) as any[]

  return {
    totalTokens: totals.total || 0,
    avgTokensPerSession: totals.cnt > 0 ? Math.round((totals.total || 0) / totals.cnt) : 0,
    totalSessions: totals.cnt || 0,
    tokensByAgent: byAgent.map(r => ({ agent: r.agent, tokens: r.tokens || 0 })),
    tokensByModel: byModel.map(r => ({ model: r.model || 'unknown', agent: r.agent, tokens: r.tokens || 0 })),
    activeAgents: agents.map(r => r.agent),
  }
}
```

- [ ] **Step 4: Verify migration runs**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/sessionDb.ts
git commit -m "feat: DB migration V2 — add agent, model, estimated_total_tokens columns and analytics query"
```

---

### Task 3: Update Session Indexer for Agent Column

**Files:**
- Modify: `desktop/src/lib/sessionIndexer.ts`

- [ ] **Step 1: Update INSERT statements to include agent column**

Change both INSERT OR REPLACE statements (lines 69-81 and 504-516) to include `agent` column with value `'claude'`:

```sql
INSERT INTO sessions (
  id, project_id, project_path, project_name,
  first_prompt, custom_title, summary, message_count,
  git_branch, created_at, modified_at, indexed_at,
  jsonl_size, jsonl_mtime, is_sidechain, analytics_indexed, agent
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude')
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
```

This preserves `agent` and `model` columns during re-indexing.

- [ ] **Step 2: Update analytics indexer to set estimated_total_tokens**

In `indexSessionAnalytics` (around line 339), add `estimated_total_tokens` to the UPDATE:

```sql
estimated_total_tokens = estimated_input_tokens + estimated_output_tokens,
```

- [ ] **Step 3: Type check**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add desktop/src/lib/sessionIndexer.ts
git commit -m "feat: update session indexer with agent column and ON CONFLICT upsert"
```

---

### Task 4: Claude Adapter

**Files:**
- Create: `desktop/src/lib/agents/claude.ts`

- [ ] **Step 1: Implement Claude adapter**

```typescript
// desktop/src/lib/agents/claude.ts
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

export const claudeAdapter: AgentAdapter = {
  info: AGENTS.claude,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.claude'))
  },

  discoverSessions(): AgentSession[] {
    // Claude sessions are already indexed by sessionIndexer.ts
    // This adapter is a passthrough — sessions are in the shared DB with agent='claude'
    // The indexer handles all discovery and parsing
    return []
  },
}
```

Claude is special: its data is already indexed by the existing `sessionIndexer.ts`. The adapter just reports `isInstalled()` — it doesn't need to discover sessions because the indexer already does that.

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/agents/claude.ts
git commit -m "feat: add Claude adapter (wraps existing session indexer)"
```

---

### Task 5: Codex Adapter

**Files:**
- Create: `desktop/src/lib/agents/codex.ts`

- [ ] **Step 1: Implement Codex adapter**

```typescript
// desktop/src/lib/agents/codex.ts
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

export const codexAdapter: AgentAdapter = {
  info: AGENTS.codex,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.codex'))
  },

  discoverSessions(): AgentSession[] {
    const dbPath = join(homedir(), '.codex', 'state_5.sqlite')
    if (!existsSync(dbPath)) return []

    try {
      const db = new Database(dbPath, { readonly: true })
      const threads = db.prepare(`
        SELECT id, title, first_user_message, cwd, git_branch, git_sha,
               git_origin_url, model_provider, tokens_used,
               created_at, updated_at, agent_nickname
        FROM threads
      `).all() as any[]
      db.close()

      return threads.map(t => ({
        id: `codex:${t.id}`,
        agent: 'codex' as const,
        model: t.model_provider || null,
        firstPrompt: t.first_user_message || null,
        summary: t.title || null,
        heuristicSummary: t.title || null,
        messageCount: 0,
        toolCallCount: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedTotalTokens: t.tokens_used || 0,
        createdAt: t.created_at ? new Date(t.created_at * 1000).toISOString() : null,
        modifiedAt: t.updated_at ? new Date(t.updated_at * 1000).toISOString() : null,
        projectPath: t.cwd || null,
        projectName: t.cwd ? t.cwd.split('/').pop() || t.cwd : null,
        gitBranch: t.git_branch || null,
        heatstripJson: null,
        toolCallsJson: null,
        gitCommandsJson: null,
        bashCommands: 0,
        errors: 0,
      }))
    } catch {
      return []
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/agents/codex.ts
git commit -m "feat: add Codex adapter — reads state_5.sqlite threads table"
```

---

### Task 6: Cursor Adapter

**Files:**
- Create: `desktop/src/lib/agents/cursor.ts`

- [ ] **Step 1: Implement Cursor adapter**

```typescript
// desktop/src/lib/agents/cursor.ts
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

export const cursorAdapter: AgentAdapter = {
  info: AGENTS.cursor,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.cursor'))
  },

  discoverSessions(): AgentSession[] {
    const dbPath = join(homedir(), '.cursor', 'ai-tracking', 'ai-code-tracking.db')
    if (!existsSync(dbPath)) return []

    try {
      const db = new Database(dbPath, { readonly: true })

      // Try conversation_summaries first (richer data)
      const convos = db.prepare(`
        SELECT conversationId, title, tldr, overview, model, mode, updatedAt
        FROM conversation_summaries
      `).all() as any[]

      if (convos.length > 0) {
        db.close()
        return convos.map(c => ({
          id: `cursor:${c.conversationId}`,
          agent: 'cursor' as const,
          model: c.model || null,
          firstPrompt: c.title || null,
          summary: c.tldr || c.overview || null,
          heuristicSummary: c.tldr || null,
          messageCount: 0,
          toolCallCount: 0,
          estimatedInputTokens: 0,
          estimatedOutputTokens: 0,
          estimatedTotalTokens: 0,
          createdAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
          modifiedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
          projectPath: null,
          projectName: null,
          gitBranch: null,
          heatstripJson: null,
          toolCallsJson: null,
          gitCommandsJson: null,
          bashCommands: 0,
          errors: 0,
        }))
      }

      // Fallback: group ai_code_hashes by conversationId
      const groups = db.prepare(`
        SELECT conversationId, model, COUNT(*) as cnt,
               MIN(createdAt) as earliest, MAX(createdAt) as latest
        FROM ai_code_hashes
        WHERE conversationId IS NOT NULL
        GROUP BY conversationId
      `).all() as any[]
      db.close()

      return groups.map(g => ({
        id: `cursor:${g.conversationId}`,
        agent: 'cursor' as const,
        model: g.model === 'default' ? null : (g.model || null),
        firstPrompt: null,
        summary: `${g.cnt} code completion${g.cnt !== 1 ? 's' : ''}`,
        heuristicSummary: `${g.cnt} code completion${g.cnt !== 1 ? 's' : ''}`,
        messageCount: g.cnt,
        toolCallCount: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedTotalTokens: 0,
        createdAt: g.earliest ? new Date(g.earliest).toISOString() : null,
        modifiedAt: g.latest ? new Date(g.latest).toISOString() : null,
        projectPath: null,
        projectName: null,
        gitBranch: null,
        heatstripJson: null,
        toolCallsJson: null,
        gitCommandsJson: null,
        bashCommands: 0,
        errors: 0,
      }))
    } catch {
      return []
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/agents/cursor.ts
git commit -m "feat: add Cursor adapter — reads ai-tracking DB, groups by conversationId"
```

---

### Task 7: Copilot Adapter

**Files:**
- Create: `desktop/src/lib/agents/copilot.ts`

- [ ] **Step 1: Implement Copilot adapter**

```typescript
// desktop/src/lib/agents/copilot.ts
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

export const copilotAdapter: AgentAdapter = {
  info: AGENTS.copilot,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.copilot'))
  },

  discoverSessions(): AgentSession[] {
    const historyPath = join(homedir(), '.copilot', 'command-history-state.json')
    if (!existsSync(historyPath)) return []

    try {
      const raw = JSON.parse(readFileSync(historyPath, 'utf-8'))
      const history: string[] = raw.commandHistory || []
      if (history.length === 0) return []

      const stat = statSync(historyPath)
      const mtime = stat.mtime.toISOString()

      return [{
        id: 'copilot:history',
        agent: 'copilot' as const,
        model: null,
        firstPrompt: history[0] || null,
        summary: `${history.length} CLI command${history.length !== 1 ? 's' : ''}`,
        heuristicSummary: `${history.length} CLI command${history.length !== 1 ? 's' : ''}`,
        messageCount: history.length,
        toolCallCount: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedTotalTokens: 0,
        createdAt: null,
        modifiedAt: mtime,
        projectPath: null,
        projectName: null,
        gitBranch: null,
        heatstripJson: null,
        toolCallsJson: null,
        gitCommandsJson: null,
        bashCommands: 0,
        errors: 0,
      }]
    } catch {
      return []
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/lib/agents/copilot.ts
git commit -m "feat: add Copilot adapter — synthetic session from command-history"
```

---

### Task 8: Register Adapters & Ingest Non-Claude Sessions

**Files:**
- Modify: `desktop/src/server/axonMiddleware.ts`
- Modify: `desktop/src/lib/sessionDb.ts`

- [ ] **Step 1: Add upsertAgentSessions function to sessionDb.ts**

```typescript
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
```

- [ ] **Step 2: Add agent discovery to the session index flow in axonMiddleware.ts**

In the pre-index section (around line 2056), after the existing `runFullIndex()` call, add non-Claude agent ingestion:

```typescript
// After Claude indexing, discover non-Claude agent sessions
try {
  const { registerAdapter, getAllAdapters } = await import('../lib/agents/registry')
  const { codexAdapter } = await import('../lib/agents/codex')
  const { cursorAdapter } = await import('../lib/agents/cursor')
  const { copilotAdapter } = await import('../lib/agents/copilot')
  const { claudeAdapter } = await import('../lib/agents/claude')
  const { upsertAgentSessions } = await import('../lib/sessionDb')

  registerAdapter(claudeAdapter)
  registerAdapter(codexAdapter)
  registerAdapter(cursorAdapter)
  registerAdapter(copilotAdapter)

  for (const adapter of getAllAdapters()) {
    if (adapter.info.id === 'claude') continue // already indexed
    if (!adapter.isInstalled()) continue
    const sessions = adapter.discoverSessions()
    if (sessions.length > 0) upsertAgentSessions(sessions)
  }
} catch (err) {
  console.error('[Axon] Agent discovery failed:', err)
}
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/lib/sessionDb.ts desktop/src/server/axonMiddleware.ts
git commit -m "feat: register adapters and ingest non-Claude sessions into shared DB"
```

---

### Task 9: Analytics API Endpoint & Hook

**Files:**
- Modify: `desktop/src/server/axonMiddleware.ts`
- Create: `desktop/src/hooks/useAnalytics.ts`

- [ ] **Step 1: Add analytics endpoint**

Before the session status endpoint, add:

```typescript
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
```

- [ ] **Step 2: Add agent filter to sessions list endpoint**

Update the `GET /api/axon/sessions` handler to support `?agent=`:

```typescript
const agentParam = new URL(url, 'http://localhost').searchParams.get('agent')
const sessions = getSessions(projectName, agentParam || undefined)
```

- [ ] **Step 3: Create useAnalytics hook**

```typescript
// desktop/src/hooks/useAnalytics.ts
import { useState, useEffect, useCallback } from 'react'

export interface AnalyticsData {
  totalTokens: number
  avgTokensPerSession: number
  totalSessions: number
  tokensByAgent: { agent: string; tokens: number }[]
  tokensByModel: { model: string; agent: string; tokens: number }[]
  activeAgents: string[]
}

export function useAnalytics(since: string | null) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch_ = useCallback(async () => {
    setLoading(true)
    try {
      const url = since
        ? `/api/axon/sessions/analytics?since=${encodeURIComponent(since)}`
        : '/api/axon/sessions/analytics'
      const res = await fetch(url)
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [since])

  useEffect(() => { fetch_() }, [fetch_])

  return { data, loading, refetch: fetch_ }
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/server/axonMiddleware.ts desktop/src/hooks/useAnalytics.ts
git commit -m "feat: add analytics API endpoint and useAnalytics React hook"
```

---

### Task 10: Remove Canvas, Add Analytics View

**Files:**
- Modify: `desktop/src/views/SessionsView.tsx`
- Create: `desktop/src/views/AnalyticsView.tsx`

- [ ] **Step 1: Create AnalyticsView component**

```typescript
// desktop/src/views/AnalyticsView.tsx
import { useState, useMemo } from 'react'
import { useAnalytics } from '@/hooks/useAnalytics'
import { AGENTS, type AgentId } from '@/lib/agents/types'

type Period = 'today' | 'week' | 'month' | 'all'

function getPeriodSince(period: Period): string | null {
  const now = new Date()
  switch (period) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay())
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    }
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    case 'all': return null
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function agentColor(agent: string): string {
  return AGENTS[agent as AgentId]?.color || '#888'
}

export function AnalyticsView() {
  const [period, setPeriod] = useState<Period>('all')
  const since = useMemo(() => getPeriodSince(period), [period])
  const { data, loading } = useAnalytics(since)

  if (loading || !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-ax-sunken rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-ax-sunken rounded-xl" />)}
        </div>
      </div>
    )
  }

  const maxAgentTokens = Math.max(...data.tokensByAgent.map(a => a.tokens), 1)
  const maxModelTokens = Math.max(...data.tokensByModel.map(m => m.tokens), 1)

  return (
    <div>
      {/* Period toggle */}
      <div className="flex gap-0.5 bg-ax-sunken rounded-lg p-0.5 mb-6 w-fit">
        {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded-md font-mono text-micro transition-colors capitalize
              ${period === p ? 'bg-ax-elevated text-ax-text-primary shadow-sm' : 'text-ax-text-tertiary hover:text-ax-text-secondary'}`}
          >
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Avg Tokens / Session</div>
          <div className="text-2xl font-bold text-ax-text-primary">{formatTokens(data.avgTokensPerSession)}</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Total Tokens</div>
          <div className="text-2xl font-bold text-ax-text-primary">{formatTokens(data.totalTokens)}</div>
          <div className="font-mono text-micro text-ax-text-tertiary mt-1">{data.totalSessions} sessions</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Active Sessions</div>
          <div className="text-2xl font-bold text-ax-text-primary">{data.totalSessions}</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Active Agents</div>
          <div className="text-2xl font-bold text-ax-text-primary">{data.activeAgents.length}</div>
          <div className="font-mono text-micro text-ax-text-tertiary mt-1">
            {data.activeAgents.map(a => AGENTS[a as AgentId]?.name || a).join(', ')}
          </div>
        </div>
      </div>

      {/* Tokens by Agent */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border p-5 mb-4">
        <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-3">Tokens by Agent</h4>
        <div className="space-y-2">
          {data.tokensByAgent.map(a => (
            <div key={a.agent} className="flex items-center gap-3">
              <span className="font-mono text-small text-ax-text-secondary w-28 shrink-0 text-right flex items-center justify-end gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: agentColor(a.agent) }} />
                {AGENTS[a.agent as AgentId]?.name || a.agent}
              </span>
              <div className="flex-1 h-4 bg-ax-sunken rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${Math.max(2, Math.round((a.tokens / maxAgentTokens) * 100))}%`,
                  background: agentColor(a.agent),
                }} />
              </div>
              <span className="font-mono text-micro text-ax-text-tertiary w-16">
                {a.tokens > 0 ? formatTokens(a.tokens) : 'N/A'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tokens by Model */}
      {data.tokensByModel.length > 0 && (
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-3">Tokens by Model</h4>
          <div className="space-y-2">
            {data.tokensByModel.map(m => (
              <div key={`${m.agent}-${m.model}`} className="flex items-center gap-3">
                <span className="font-mono text-small text-ax-text-secondary w-28 shrink-0 text-right truncate" title={m.model}>
                  {m.model}
                </span>
                <div className="flex-1 h-4 bg-ax-sunken rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${Math.max(2, Math.round((m.tokens / maxModelTokens) * 100))}%`,
                    background: agentColor(m.agent),
                  }} />
                </div>
                <span className="font-mono text-micro text-ax-text-tertiary w-16">{formatTokens(m.tokens)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Remove Canvas imports and mode from SessionsView.tsx**

Remove these imports:
```typescript
// REMOVE:
import { CanvasView } from './agent/CanvasView'
import { ZoneTree } from './agent/ZoneTree'
import { useCanvasState } from './agent/useCanvasState'
import { TILE_W, TILE_H, ZONE_COLORS, snap, type TileState, type ZoneState } from './agent/zoneReducers'
```

Remove `SessionsMode` type. Remove `mode` state, Canvas/List toggle, ZoneTree sidebar, CanvasView rendering, fullscreen logic, and demo data generation.

Add Analytics import and tab:
```typescript
import { AnalyticsView } from './AnalyticsView'
```

Update `ViewMode`:
```typescript
type ViewMode = 'day' | 'sessions' | 'analytics'
```

Replace Canvas/List toggle with just the Day/Sessions/Analytics tabs.

Render Analytics:
```typescript
{viewMode === 'analytics' && <AnalyticsView />}
```

- [ ] **Step 3: Type check and run tests**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npx tsc --noEmit && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add desktop/src/views/AnalyticsView.tsx desktop/src/views/SessionsView.tsx
git commit -m "feat: replace Canvas with Analytics view — token charts and period toggle"
```

---

### Task 11: Agent Filter Pills & Agent Badge

**Files:**
- Modify: `desktop/src/views/SessionsView.tsx`
- Modify: `desktop/src/hooks/useSessions.ts`

- [ ] **Step 1: Add `agent` to SessionSummary and filter support to useSessions**

In `useSessions.ts`, add to `SessionSummary`:
```typescript
agent: string
model: string | null
estimated_total_tokens: number
```

Add `useSessionsByAgent` hook:
```typescript
export function useSessionsByAgent(agent: string | null) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loading, setLoading] = useState(true)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    try {
      const url = agent
        ? `/api/axon/sessions?agent=${encodeURIComponent(agent)}`
        : '/api/axon/sessions'
      const res = await fetch(url)
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch { setSessions([]) }
    finally { setLoading(false) }
  }, [agent])

  useEffect(() => { fetchSessions() }, [fetchSessions])
  return { sessions, loading, refetch: fetchSessions }
}
```

- [ ] **Step 2: Add agent filter pills to SessionsView**

Below the Day/Sessions/Analytics tabs, add agent filter pills:

```typescript
const [agentFilter, setAgentFilter] = useState<string | null>(null)
```

Render pills (only in day/sessions modes):
```typescript
{viewMode !== 'analytics' && (
  <div className="flex gap-0.5 bg-ax-sunken rounded-md p-0.5">
    <button onClick={() => setAgentFilter(null)}
      className={`px-2 py-0.5 font-mono text-[10px] rounded ${!agentFilter ? 'bg-ax-elevated text-ax-text-primary shadow-sm' : 'text-ax-text-tertiary'}`}
    >All</button>
    {installedAgents.map(a => (
      <button key={a.id} onClick={() => setAgentFilter(a.id)}
        className={`px-2 py-0.5 font-mono text-[10px] rounded flex items-center gap-1 ${agentFilter === a.id ? 'bg-ax-elevated text-ax-text-primary shadow-sm' : 'text-ax-text-tertiary'}`}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.color }} />
        {a.name}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Add agent badge to SessionCard metadata row**

In the SessionCard metadata badges section, add:
```typescript
{s.agent && s.agent !== 'claude' && (
  <span className="font-mono text-micro flex items-center gap-1 px-1.5 py-0.5 bg-ax-sunken rounded"
    style={{ color: AGENTS[s.agent as AgentId]?.color }}>
    <span className="w-1.5 h-1.5 rounded-full" style={{ background: AGENTS[s.agent as AgentId]?.color }} />
    {AGENTS[s.agent as AgentId]?.name || s.agent}
  </span>
)}
```

- [ ] **Step 4: Filter sessions by agent**

Pass `agentFilter` to the data-fetching hook so only matching sessions are shown.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/views/SessionsView.tsx desktop/src/hooks/useSessions.ts
git commit -m "feat: add agent filter pills and agent badge on session cards"
```

---

### Task 12: Rename to "Agent Sessions" & Dendrite --agent Flag

**Files:**
- Modify: `desktop/src/components/layout/Sidebar.tsx`
- Modify: `desktop/src/views/SessionsView.tsx`
- Modify: `desktop/src/lib/sessionDendrite.ts`

- [ ] **Step 1: Rename sidebar label**

In Sidebar.tsx:
```typescript
{ id: 'agents', label: 'Agent Sessions', icon: Brain },
```

- [ ] **Step 2: Update header title in SessionsView**

```typescript
<h1 className="font-serif italic text-[16px] text-ax-text-primary">
  Agent Sessions
</h1>
```

- [ ] **Step 3: Add --agent flag to sessionDendrite.ts**

Add argument parsing:
```typescript
const agentFilter = getArg('agent') // 'claude', 'codex', 'all', etc.
```

Update the SQL query to filter by agent (with migration-aware fallback):
```typescript
let query = `SELECT ... FROM sessions WHERE modified_at > ?`
const params: any[] = [sinceDate]

// Check if agent column exists (migration-aware)
try {
  db.prepare('SELECT agent FROM sessions LIMIT 1').get()
  if (agentFilter && agentFilter !== 'all') {
    query += ' AND agent = ?'
    params.push(agentFilter)
  }
} catch {
  // agent column doesn't exist yet — skip filter
}
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/layout/Sidebar.tsx desktop/src/views/SessionsView.tsx desktop/src/lib/sessionDendrite.ts
git commit -m "feat: rename to Agent Sessions, add --agent flag to dendrite"
```

---

### Task 13: Per-Agent Workspace Configs

- [ ] **Step 1: Create workspace directories and configs**

```bash
mkdir -p ~/.axon/workspaces/{agent-sessions,codex-sessions,cursor-sessions,copilot-sessions}/{episodes,dendrites,mornings}
```

Write config.yaml for each. Example for codex-sessions:
```yaml
status: active
rollup:
  schedule: "0 21 * * *"
  max_prompts_per_session: 50
  allowed_tools: []
dendrite_enabled:
  claude-sessions: true
```

Write agent-sessions (unified) config:
```yaml
status: active
rollup:
  schedule: "0 22 * * *"
  max_prompts_per_session: 50
  allowed_tools: []
dendrite_enabled:
  claude-sessions: true
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: create per-agent and unified workspace configs"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npx vitest run`

- [ ] **Step 2: Type check**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npx tsc --noEmit`

- [ ] **Step 3: Verify dev server starts**

Run: `cd /Users/Tessl-Leo/Development/axon/desktop && npm run dev`
Check: http://localhost:1420 loads with Agent Sessions, Analytics tab works

- [ ] **Step 4: Update data flow diagram**

Add multi-agent data sources to `docs/data-flow-diagram.md`.

- [ ] **Step 5: Final commit**

```bash
git commit -m "docs: update data flow diagram for multi-agent"
```
