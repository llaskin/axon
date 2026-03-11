export type AgentStatus = 'idle' | 'running' | 'complete' | 'error'

export type AgentEventKind =
  | 'user_message'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'result'
  | 'error'

export interface AgentEvent {
  kind: AgentEventKind
  id: string
  timestamp: number
  // Text / thinking / error
  text?: string
  // Tool call (tool_use)
  toolName?: string
  toolInput?: Record<string, unknown>
  // Tool result (tool_result)
  toolUseId?: string
  content?: string
  isError?: boolean
  // Session result
  sessionId?: string
  cost?: number
  usage?: { input_tokens: number; output_tokens: number }
  turns?: number
  duration?: number
}

export type KnownTool = 'Edit' | 'Write' | 'Read' | 'Bash' | 'Glob' | 'Grep' | 'WebSearch' | 'WebFetch'

export function isKnownTool(name: string): name is KnownTool {
  return ['Edit', 'Write', 'Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'].includes(name)
}
