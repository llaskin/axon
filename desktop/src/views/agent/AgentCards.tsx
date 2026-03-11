import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Terminal, Eye, PenLine, FilePlus, Search,
  AlertTriangle, ChevronDown, ChevronRight,
  Check, Brain, Loader,
} from 'lucide-react'
import type { AgentEvent, KnownTool } from './types'
import { isKnownTool } from './types'

/* ── Icon + color maps ─────────────────────────────────────────── */

const TOOL_ICON: Record<KnownTool, typeof Terminal> = {
  Edit: PenLine, Write: FilePlus, Read: Eye, Bash: Terminal,
  Glob: Search, Grep: Search, WebSearch: Search, WebFetch: Search,
}
const TOOL_COLOR: Record<KnownTool, string> = {
  Edit: 'text-ax-warning', Write: 'text-ax-accent', Read: 'text-ax-info',
  Bash: 'text-ax-brand', Glob: 'text-ax-text-secondary', Grep: 'text-ax-text-secondary',
  WebSearch: 'text-ax-info', WebFetch: 'text-ax-info',
}

/* ── User message ──────────────────────────────────────────────── */

export function UserMessageCard({ event }: { event: AgentEvent }) {
  return (
    <div className="flex justify-end px-5 py-1">
      <div className="bg-ax-brand/10 border border-ax-brand/20 rounded-lg px-3 py-2 max-w-[80%]">
        <div className="text-small text-ax-text-primary whitespace-pre-wrap">{event.text}</div>
      </div>
    </div>
  )
}

/* ── Text ──────────────────────────────────────────────────────── */

export function TextCard({ event }: { event: AgentEvent }) {
  const content = useMemo(() => event.text || '', [event.text])
  return (
    <div className="px-5 py-1.5">
      <div className="agent-markdown text-small text-ax-text-primary leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  )
}

/* ── Thinking ──────────────────────────────────────────────────── */

export function ThinkingCard({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left px-5 py-1 hover:bg-ax-sunken/30 transition-colors group"
    >
      <div className="flex items-center gap-1.5">
        <Brain size={9} className="text-ax-text-tertiary shrink-0" />
        <span className="font-mono text-[10px] text-ax-text-tertiary">
          thinking
        </span>
        {open ? <ChevronDown size={9} className="text-ax-text-tertiary" /> : <ChevronRight size={9} className="text-ax-text-tertiary" />}
      </div>
      {/* Collapsed: single-line preview with gradient fade */}
      {!open && event.text && (
        <div className="relative mt-0.5 h-[16px] overflow-hidden">
          <span className="font-mono text-[10px] text-ax-text-ghost whitespace-nowrap">
            {event.text.replace(/\n/g, ' ')}
          </span>
          <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-ax-base to-transparent
            group-hover:from-ax-sunken/30" />
        </div>
      )}
      {/* Expanded: full text */}
      {open && (
        <div className="mt-1 text-[11px] text-ax-text-tertiary leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
          {event.text}
        </div>
      )}
    </button>
  )
}

/* ── Typing indicator (AI is processing) ──────────────────────── */

export function TypingIndicator() {
  return (
    <div className="flex justify-center py-4">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full
        bg-ax-brand-subtle/50 border border-ax-brand/10">
        <div className="flex items-center gap-[3px]">
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-ax-brand" />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-ax-brand" />
          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-ax-brand" />
        </div>
        <span className="font-mono text-[10px] text-ax-brand">thinking</span>
      </div>
    </div>
  )
}

/* ── Tool Use ──────────────────────────────────────────────────── */

export function ToolUseCard({ event, result }: { event: AgentEvent; result?: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const name = event.toolName || 'Unknown'
  const known = isKnownTool(name)
  const Icon = known ? TOOL_ICON[name as KnownTool] : Terminal
  const color = known ? TOOL_COLOR[name as KnownTool] : 'text-ax-text-secondary'

  return (
    <div className={`mx-4 rounded-md overflow-hidden ${
      result?.isError ? 'border border-ax-error/20' : 'border border-ax-border-subtle/60'
    }`}>
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 hover:bg-ax-sunken/20 transition-colors"
      >
        {/* Status indicator */}
        {!result ? (
          <Loader size={10} className="text-ax-brand/50 animate-spin shrink-0" />
        ) : result.isError ? (
          <AlertTriangle size={10} className="text-ax-error shrink-0" />
        ) : (
          <Check size={10} className="text-ax-success/60 shrink-0" />
        )}
        <Icon size={10} className={color} />
        <span className="font-mono text-[11px] text-ax-text-secondary">{name}</span>
        <ToolSummary event={event} />
        {result && (
          <span className="ml-auto">
            {open ? <ChevronDown size={9} className="text-ax-text-ghost" />
                  : <ChevronRight size={9} className="text-ax-text-ghost" />}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-ax-border-subtle/60">
          <ToolInput name={name} input={event.toolInput} />
          {result && (
            <div className={`border-t px-2.5 py-1.5 ${
              result.isError
                ? 'border-ax-error/20 bg-ax-error-subtle'
                : 'border-ax-border-subtle/60 bg-ax-sunken/10'
            }`}>
              <ToolResult name={name} result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Tool summary (header line) ────────────────────────────────── */

function ToolSummary({ event }: { event: AgentEvent }) {
  const i = event.toolInput
  if (!i) return null
  let label = ''
  switch (event.toolName) {
    case 'Edit': case 'Write': case 'Read':
      label = shortPath(i.file_path as string); break
    case 'Bash':
      label = (i.command as string)?.slice(0, 40) || ''; break
    case 'Glob':
      label = i.pattern as string || ''; break
    case 'Grep':
      label = `/${i.pattern as string}/`; break
    default: return null
  }
  return <code className="text-[10px] font-mono text-ax-text-ghost truncate max-w-[200px]">{label}</code>
}

function shortPath(p?: string) {
  if (!p) return ''
  return p.split('/').slice(-2).join('/')
}

/* ── Tool input rendering ──────────────────────────────────────── */

function ToolInput({ name, input }: { name: string; input?: Record<string, unknown> }) {
  if (!input) return null
  switch (name) {
    case 'Edit':   return <EditInput input={input} />
    case 'Write':  return <WriteInput input={input} />
    case 'Bash':   return <BashInput input={input} />
    case 'Read':   return <ReadInput input={input} />
    case 'Glob': case 'Grep': return <SearchInput name={name} input={input} />
    default:
      return (
        <pre className="px-2.5 py-1.5 font-mono text-[10px] text-ax-text-tertiary overflow-x-auto max-h-24 overflow-y-auto">
          {JSON.stringify(input, null, 2)}
        </pre>
      )
  }
}

/* ── Edit: inline diff ─────────────────────────────────────────── */

function EditInput({ input }: { input: Record<string, unknown> }) {
  const fp = input.file_path as string
  const old = input.old_string as string
  const neu = input.new_string as string
  return (
    <div className="px-2.5 py-1.5 space-y-1">
      <code className="font-mono text-[10px] text-ax-brand">{shortPath(fp)}</code>
      <div className="font-mono text-[10px] rounded overflow-hidden border border-ax-border-subtle/60">
        {old && (
          <div className="bg-ax-error-subtle px-2 py-0.5 border-b border-ax-border-subtle/60">
            <pre className="text-ax-error whitespace-pre-wrap break-all">{old}</pre>
          </div>
        )}
        {neu && (
          <div className="bg-ax-success-subtle px-2 py-0.5">
            <pre className="text-ax-success whitespace-pre-wrap break-all">{neu}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Write: file content preview ───────────────────────────────── */

function WriteInput({ input }: { input: Record<string, unknown> }) {
  const fp = input.file_path as string
  const content = input.content as string || ''
  const [full, setFull] = useState(false)
  const preview = content.slice(0, 200)
  const truncated = content.length > 200

  return (
    <div className="px-2.5 py-1.5 space-y-1">
      <code className="font-mono text-[10px] text-ax-accent">{shortPath(fp)}</code>
      <pre className="bg-ax-sunken rounded p-1.5 font-mono text-[10px] text-ax-text-primary
        overflow-x-auto max-h-32 overflow-y-auto border border-ax-border-subtle/60">
        {full ? content : preview}
      </pre>
      {truncated && (
        <button onClick={() => setFull(!full)} className="text-[10px] text-ax-brand hover:text-ax-brand-hover">
          {full ? 'Less' : `+${content.length - 200}`}
        </button>
      )}
    </div>
  )
}

/* ── Bash: terminal block ──────────────────────────────────────── */

function BashInput({ input }: { input: Record<string, unknown> }) {
  return (
    <div className="px-2.5 py-1.5">
      <div className="agent-terminal rounded p-1.5 font-mono text-[10px] overflow-x-auto border border-ax-border-subtle/60">
        <span className="text-ax-accent">$</span>{' '}
        <span className="text-ax-text-primary">{input.command as string}</span>
      </div>
    </div>
  )
}

/* ── Read: file path ───────────────────────────────────────────── */

function ReadInput({ input }: { input: Record<string, unknown> }) {
  return (
    <div className="px-2.5 py-1 flex items-center gap-1.5">
      <Eye size={9} className="text-ax-info" />
      <code className="font-mono text-[10px] text-ax-info">{shortPath(input.file_path as string)}</code>
      {input.offset != null && (
        <span className="text-[10px] text-ax-text-ghost">
          :{input.offset as number}–{(input.offset as number) + ((input.limit as number) || 2000)}
        </span>
      )}
    </div>
  )
}

/* ── Glob / Grep ───────────────────────────────────────────────── */

function SearchInput({ name, input }: { name: string; input: Record<string, unknown> }) {
  return (
    <div className="px-2.5 py-1 flex items-center gap-1.5 font-mono text-[10px] flex-wrap">
      <span className="text-ax-text-ghost">{name.toLowerCase()}</span>
      <code className="text-ax-brand">{input.pattern as string}</code>
      {input.path && <span className="text-ax-text-ghost">in {shortPath(input.path as string)}</span>}
    </div>
  )
}

/* ── Tool result rendering ─────────────────────────────────────── */

function ToolResult({ name, result }: { name: string; result: AgentEvent }) {
  const content = result.content || ''
  if (result.isError) {
    return (
      <pre className="font-mono text-[10px] text-ax-error whitespace-pre-wrap max-h-24 overflow-y-auto">
        {content.slice(0, 500)}{content.length > 500 && '\n…'}
      </pre>
    )
  }
  if (name === 'Bash') {
    return (
      <pre className="font-mono text-[10px] text-ax-text-secondary whitespace-pre-wrap max-h-24 overflow-y-auto">
        {content.slice(0, 500)}{content.length > 500 && '\n…'}
      </pre>
    )
  }
  return <CollapsibleText content={content} />
}

function CollapsibleText({ content }: { content: string }) {
  const [full, setFull] = useState(false)
  const preview = content.slice(0, 150)
  const truncated = content.length > 150
  return (
    <div>
      <pre className="font-mono text-[10px] text-ax-text-tertiary whitespace-pre-wrap max-h-24 overflow-y-auto">
        {full ? content : preview}{truncated && !full && '…'}
      </pre>
      {truncated && (
        <button onClick={() => setFull(!full)} className="text-[10px] text-ax-brand hover:text-ax-brand-hover mt-0.5">
          {full ? 'Less' : `+${content.length - 150}`}
        </button>
      )}
    </div>
  )
}

/* ── Result (session turn summary) — ultra-compact divider ─────── */

export function ResultCard({ event }: { event: AgentEvent }) {
  const parts: string[] = []
  if (event.cost != null) parts.push(`$${event.cost.toFixed(4)}`)
  if (event.usage) parts.push(`${((event.usage.input_tokens + event.usage.output_tokens) / 1000).toFixed(1)}k`)
  if (event.turns != null) parts.push(`${event.turns}t`)
  if (event.duration != null) parts.push(`${event.duration}s`)

  return (
    <div className="flex items-center gap-2 px-5 py-0.5">
      <div className="flex-1 h-px bg-ax-border-subtle/50" />
      <div className="flex items-center gap-1.5 font-mono text-[9px] text-ax-text-tertiary">
        <Check size={8} className="text-ax-success/60" />
        {parts.join(' · ')}
      </div>
      <div className="flex-1 h-px bg-ax-border-subtle/50" />
    </div>
  )
}

/* ── Error card ────────────────────────────────────────────────── */

export function ErrorCard({ event }: { event: AgentEvent }) {
  return (
    <div className="flex items-center gap-1.5 px-5 py-1 mx-4 bg-ax-error-subtle/50 rounded">
      <AlertTriangle size={10} className="text-ax-error shrink-0" />
      <span className="font-mono text-[10px] text-ax-error truncate">{event.text}</span>
    </div>
  )
}
