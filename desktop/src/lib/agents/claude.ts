import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AgentAdapter } from './types'
import { AGENTS } from './types'

/**
 * Claude adapter — sessions are already indexed by sessionIndexer.ts.
 * This adapter just reports isInstalled(); discovery is a no-op
 * because the existing indexer handles all Claude session parsing.
 */
export const claudeAdapter: AgentAdapter = {
  info: AGENTS.claude,

  isInstalled(): boolean {
    return existsSync(join(homedir(), '.claude'))
  },

  discoverSessions() {
    // Claude sessions handled by sessionIndexer.ts — no extra discovery needed
    return []
  },
}
