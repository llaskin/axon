import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

/**
 * Codex adapter — reads threads from ~/.codex/state_5.sqlite.
 * Timestamps are Unix epoch integers → converted to ISO 8601.
 * tokens_used is a single total (no input/output split).
 * Model name read from config.toml (threads table only has model_provider).
 */

function readCodexModel(): string | null {
  try {
    const configPath = join(homedir(), '.codex', 'config.toml')
    if (!existsSync(configPath)) return null
    const content = readFileSync(configPath, 'utf-8')
    const match = content.match(/^model\s*=\s*"([^"]+)"/m)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export const codexAdapter: AgentAdapter = {
  info: AGENTS.codex,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.codex'))
  },

  discoverSessions(): AgentSession[] {
    const dbPath = join(homedir(), '.codex', 'state_5.sqlite')
    if (!existsSync(dbPath)) return []

    const configModel = readCodexModel()

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
        model: configModel || t.model_provider || null,
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
