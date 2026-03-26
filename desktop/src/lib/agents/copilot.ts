import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentAdapter, AgentSession } from './types'
import { AGENTS } from './types'

/**
 * Copilot adapter — reads ~/.copilot/command-history-state.json.
 * Extremely limited: flat array of prompt strings, no timestamps,
 * no session IDs, no model info, no token counts.
 * Creates a single synthetic session from the file's mtime.
 */
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
