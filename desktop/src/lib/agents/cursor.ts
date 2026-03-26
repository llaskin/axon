import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

/**
 * Cursor adapter — reads from ~/.cursor/ai-tracking/ai-code-tracking.db.
 * Prefers conversation_summaries table; falls back to grouping
 * ai_code_hashes by conversationId when summaries are empty.
 */
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
