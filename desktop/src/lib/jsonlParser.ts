import { readFileSync, existsSync, statSync } from 'fs'

// Pricing per million tokens (Sonnet 4 as default)
const INPUT_COST_PER_MTOK = 3
const OUTPUT_COST_PER_MTOK = 15

export interface ParsedFileTouch {
  path: string
  operations: string[]
  count: number
}

export interface HeatSegment {
  type: 'read' | 'write' | 'edit' | 'bash' | 'error' | 'chat'
}

export interface ToolCallCount {
  tool: string
  count: number
}

export interface ParsedSession {
  messageCount: number
  toolCalls: ToolCallCount[]
  totalToolCalls: number
  filesTouched: ParsedFileTouch[]
  bashCommands: number
  errors: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCostUsd: number | null
  heuristicSummary: string | null
  heatStrip: HeatSegment[]
  gitCommands: string[]
  dominantModel: string | null
}

// --- Shared extraction helpers ---

export function extractTextFromContent(rawContent: unknown): string {
  if (typeof rawContent === 'string') return rawContent
  if (Array.isArray(rawContent)) {
    return rawContent
      .filter((b: Record<string, unknown>) => b.type === 'text')
      .map((b: Record<string, unknown>) => b.text || '')
      .join(' ')
  }
  return ''
}

export function extractFilePath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null
  return (
    (input.file_path as string) ||
    (input.path as string) ||
    (input.filePath as string) ||
    null
  )
}

export function toolToOperation(toolName: string): string {
  if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') return 'read'
  if (toolName === 'Write') return 'write'
  if (toolName === 'Edit') return 'edit'
  return 'other'
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// --- Full JSONL parse (for analytics) ---

export function parseJsonlFile(filePath: string): ParsedSession | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())

    const toolCounts: Record<string, number> = {}
    const fileOps: Record<string, Set<string>> = {}
    const fileCounts: Record<string, number> = {}
    let bashCount = 0
    let errorCount = 0
    let inputTokens = 0
    let outputTokens = 0
    let messageCount = 0
    const heatStrip: HeatSegment[] = []
    const gitCommands: string[] = []
    const modelCounts = new Map<string, number>()

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)

        if (msg.type === 'user' || msg.type === 'assistant') messageCount++

        // Track model usage from assistant messages
        const model = msg.message?.model
        if (model && typeof model === 'string') {
          modelCounts.set(model, (modelCounts.get(model) || 0) + 1)
        }

        // Usage metadata
        const usage = msg.message?.usage || msg.usage
        if (usage) {
          if (usage.input_tokens) inputTokens += usage.input_tokens
          if (usage.output_tokens) outputTokens += usage.output_tokens
        }

        // Estimate tokens from content if no usage data
        if (!usage && (msg.type === 'user' || msg.type === 'assistant')) {
          const text = extractTextFromContent(msg.message?.content)
          if (text) {
            const tokens = estimateTokens(text)
            if (msg.type === 'user') inputTokens += tokens
            else outputTokens += tokens
          }
        }

        // Tool use blocks
        if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_use') {
              const toolName = block.name as string
              toolCounts[toolName] = (toolCounts[toolName] || 0) + 1

              const input = block.input as Record<string, unknown> | undefined
              if (input) {
                const fp = extractFilePath(input)
                if (fp) {
                  const op = toolToOperation(toolName)
                  if (!fileOps[fp]) fileOps[fp] = new Set()
                  fileOps[fp].add(op)
                  fileCounts[fp] = (fileCounts[fp] || 0) + 1
                }

                if (toolName === 'Bash' && input.command) {
                  bashCount++
                  const cmd = input.command as string
                  if (/git\s+commit/.test(cmd)) {
                    gitCommands.push(cmd.slice(0, 200))
                  }
                  heatStrip.push({ type: 'bash' })
                } else if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep') {
                  heatStrip.push({ type: 'read' })
                } else if (toolName === 'Write') {
                  heatStrip.push({ type: 'write' })
                } else if (toolName === 'Edit') {
                  heatStrip.push({ type: 'edit' })
                }
              }
            }
          }
        }

        // Error blocks
        if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === 'tool_result' && block.is_error) {
              errorCount++
              heatStrip.push({ type: 'error' })
            }
          }
        }

        // Chat segments
        if ((msg.type === 'user' || msg.type === 'assistant') && Array.isArray(msg.message?.content)) {
          const hasToolUse = msg.message.content.some(
            (b: Record<string, unknown>) => b.type === 'tool_use' || b.type === 'tool_result'
          )
          if (!hasToolUse) heatStrip.push({ type: 'chat' })
        } else if ((msg.type === 'user' || msg.type === 'assistant') && typeof msg.message?.content === 'string') {
          heatStrip.push({ type: 'chat' })
        }
      } catch {
        continue
      }
    }

    const toolCallList = Object.entries(toolCounts)
      .map(([tool, count]) => ({ tool, count }))
      .sort((a, b) => b.count - a.count)

    const totalToolCalls = Object.values(toolCounts).reduce((s, c) => s + c, 0)

    const filesTouched = Object.entries(fileOps)
      .map(([path, ops]) => ({
        path,
        operations: [...ops],
        count: fileCounts[path] || 1
      }))
      .sort((a, b) => b.count - a.count)

    let estimatedCostUsd: number | null = null
    if (inputTokens > 0 || outputTokens > 0) {
      estimatedCostUsd =
        (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
        (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK
    }

    return {
      messageCount,
      toolCalls: toolCallList,
      totalToolCalls,
      filesTouched,
      bashCommands: bashCount,
      errors: errorCount,
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: outputTokens,
      estimatedCostUsd,
      heuristicSummary: buildHeuristicSummary(filesTouched, bashCount, gitCommands.length, errorCount, totalToolCalls),
      heatStrip,
      gitCommands,
      dominantModel: modelCounts.size > 0
        ? [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
        : null,
    }
  } catch {
    return null
  }
}

// --- Lightweight parse (first 20 + last 20 lines, for orphan sessions) ---

export interface LightweightSession {
  firstPrompt: string | null
  created: string | null
  modified: string | null
  messageCount: number
}

export function parseJsonlFileLightweight(filePath: string): LightweightSession | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())

    let firstPrompt: string | null = null
    let created: string | null = null
    let modified: string | null = null
    let messageCount = 0

    // Scan first 20 lines
    for (const line of lines.slice(0, 20)) {
      try {
        const msg = JSON.parse(line)
        if (!created && (msg.snapshot?.timestamp || msg.timestamp)) {
          created = msg.snapshot?.timestamp || msg.timestamp
        }
        if (msg.type === 'user' && !firstPrompt) {
          const text = extractTextFromContent(msg.message?.content)
          if (text) firstPrompt = text.slice(0, 200)
        }
        if (msg.type === 'user' || msg.type === 'assistant') messageCount++
      } catch {
        continue
      }
    }

    // Scan last 20 lines for most recent timestamp
    for (const line of lines.slice(-20).reverse()) {
      try {
        const msg = JSON.parse(line)
        const ts = msg.timestamp || msg.snapshot?.timestamp
        if (ts) { modified = ts; break }
      } catch {
        continue
      }
    }

    // For longer files, count all messages
    if (lines.length > 20) {
      messageCount = 0
      for (const line of lines) {
        try {
          const msg = JSON.parse(line)
          if (msg.type === 'user' || msg.type === 'assistant') messageCount++
        } catch { continue }
      }
    }

    return { firstPrompt, created, modified: modified || created, messageCount }
  } catch {
    return null
  }
}

// --- FTS content extraction ---

export function extractFtsContent(filePath: string, maxBytes = 100_000): string | null {
  if (!existsSync(filePath)) return null

  try {
    const stat = statSync(filePath)
    if (stat.size > 10 * 1024 * 1024) return null // skip >10MB

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim())
    const parts: string[] = []
    let totalLen = 0

    for (const line of lines) {
      if (totalLen >= maxBytes) break
      try {
        const msg = JSON.parse(line)
        if (msg.type !== 'user' && msg.type !== 'assistant') continue
        const text = extractTextFromContent(msg.message?.content)
        if (text) {
          const chunk = text.slice(0, maxBytes - totalLen)
          parts.push(chunk)
          totalLen += chunk.length
        }
      } catch {
        continue
      }
    }

    return parts.length > 0 ? parts.join(' ') : null
  } catch {
    return null
  }
}

// --- Heuristic summary builder ---

function buildHeuristicSummary(
  filesTouched: ParsedFileTouch[],
  bashCommands: number,
  gitCommandCount: number,
  errors: number,
  totalToolCalls: number
): string | null {
  if (totalToolCalls === 0) return null

  const parts: string[] = []
  const writes = filesTouched.filter((f) => f.operations.includes('write'))
  const edits = filesTouched.filter((f) => f.operations.includes('edit'))
  const reads = filesTouched.filter((f) => f.operations.length === 1 && f.operations[0] === 'read')

  if (writes.length > 3) {
    parts.push(`Created ${writes.length} files`)
  } else if (writes.length > 0) {
    const names = writes.slice(0, 2).map((f) => f.path.split('/').pop())
    parts.push(`Created ${names.join(', ')}`)
  }

  if (edits.length > 3) {
    parts.push(`edited ${edits.length} files`)
  } else if (edits.length > 0) {
    const names = edits.slice(0, 2).map((f) => f.path.split('/').pop())
    parts.push(`edited ${names.join(', ')}`)
  }

  if (parts.length === 0 && reads.length > 0) {
    parts.push(`Read ${reads.length} file${reads.length > 1 ? 's' : ''}`)
  }

  if (bashCommands > 2) parts.push(`${bashCommands} commands`)
  if (gitCommandCount > 0) parts.push(`${gitCommandCount} commit${gitCommandCount > 1 ? 's' : ''}`)
  if (errors > 0) parts.push(`${errors} error${errors > 1 ? 's' : ''}`)

  if (parts.length === 0) return null
  const summary = parts.join(' · ')
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}
