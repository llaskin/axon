export type ProjectStatus = 'active' | 'paused' | 'archived'
export type EnergyLevel = 'low' | 'medium' | 'high'
export type MomentumLevel = 'accelerating' | 'steady' | 'decelerating' | 'stalled' | 'blocked' | 'frozen'

export interface Project {
  name: string
  path: string
  status: ProjectStatus
  createdAt: string
  lastRollup: string | null
  episodeCount: number
  openLoopCount: number
  genesisStatus?: 'running' | 'complete' | 'failed'
}

export interface DiscoveredRepo {
  name: string
  path: string
  remote: string
  lastActivity: string
}

export interface RollupFrontmatter {
  type: 'rollup' | 'catchup' | 'genesis'
  date: string
  project: string
  headline?: string
  tags?: string[]
  energy?: EnergyLevel
  momentum?: MomentumLevel
  commits?: number
  decisions?: number
  openLoops?: number
  riskItems?: number
  previous?: string
}

export interface RollupEpisode {
  filename: string
  frontmatter: RollupFrontmatter
  summary?: string
  body: string
}

export interface DecisionTrace {
  id: string
  title: string
  input: string
  constraint: string
  tradeoff: string
  decision: string
  date: string
  rollupFile: string
}

export interface OpenLoop {
  text: string
  status: 'open' | 'carried' | 'done'
  carriedDays?: number
}

export interface StreamEntry {
  timestamp: string
  source: string
  message: string
}
