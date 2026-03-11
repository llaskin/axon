import { useState, useRef, useEffect, useCallback } from 'react'
import { Terminal, Send, Square, Clock, RotateCcw, Shield, ChevronDown } from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { useAgentSession } from './agent/useAgentSession'
import { AgentTimeline } from './agent/AgentTimeline'
import { FileTree } from './agent/FileTree'
import { FileAutocomplete } from './agent/FileAutocomplete'
import { useFileSearch } from './agent/useFileSearch'
import type { AgentStatus } from './agent/types'

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-ax-text-tertiary', running: 'bg-ax-brand animate-pulse-dot',
  complete: 'bg-ax-success', error: 'bg-ax-error',
}

/* ── Available tools for permission control ────────────────────── */

const ALL_TOOLS = [
  { name: 'Read', label: 'Read', safe: true },
  { name: 'Glob', label: 'Glob', safe: true },
  { name: 'Grep', label: 'Grep', safe: true },
  { name: 'Edit', label: 'Edit', safe: false },
  { name: 'Write', label: 'Write', safe: false },
  { name: 'Bash', label: 'Bash', safe: false },
  { name: 'WebSearch', label: 'Search', safe: true },
  { name: 'WebFetch', label: 'Fetch', safe: true },
] as const

const DEFAULT_TOOLS = ALL_TOOLS.map(t => t.name)

/* ── Extract @query from cursor position ────────────────────────── */

function extractAtQuery(text: string, cursorPos: number): string | null {
  // Walk backwards from cursor to find @
  const before = text.slice(0, cursorPos)
  const atIdx = before.lastIndexOf('@')
  if (atIdx === -1) return null
  // Must be at start or preceded by whitespace
  if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null
  const query = before.slice(atIdx + 1)
  // No spaces allowed in the query
  if (/\s/.test(query)) return null
  return query
}

export function AgentView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const [prompt, setPrompt] = useState('')
  const [allowedTools, setAllowedTools] = useState<string[]>([...DEFAULT_TOOLS])
  const [showPerms, setShowPerms] = useState(false)
  const [acQuery, setAcQuery] = useState<string | null>(null)
  const [acSelected, setAcSelected] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { events, status, elapsed, error, sessionId, send, stop, reset } = useAgentSession()

  // File search for autocomplete
  const { results: acResults, loading: acLoading } = useFileSearch(acQuery || '', activeProject)

  // Focus input when status returns to idle/complete
  useEffect(() => {
    if (status === 'complete' || status === 'idle') {
      inputRef.current?.focus()
    }
  }, [status])

  // Reset autocomplete selection when results change
  useEffect(() => { setAcSelected(0) }, [acResults])

  // Update @-query detection on prompt change
  const handlePromptChange = useCallback((value: string) => {
    setPrompt(value)
    const textarea = inputRef.current
    if (!textarea) return
    const query = extractAtQuery(value, textarea.selectionStart)
    setAcQuery(query)
  }, [])

  // Insert a file reference at the cursor
  const insertFileRef = useCallback((path: string) => {
    const textarea = inputRef.current
    if (!textarea) return
    const cursorPos = textarea.selectionStart
    const before = prompt.slice(0, cursorPos)
    const after = prompt.slice(cursorPos)
    // Find the @ that triggered this
    const atIdx = before.lastIndexOf('@')
    if (atIdx === -1) return
    const newPrompt = before.slice(0, atIdx) + `@${path} ` + after
    setPrompt(newPrompt)
    setAcQuery(null)
    // Set cursor after the inserted reference
    const newPos = atIdx + path.length + 2 // @path + space
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(newPos, newPos)
    })
  }, [prompt])

  // Handle file reference from file tree @ button
  const handleFileReference = useCallback((path: string) => {
    const ref = `@${path} `
    setPrompt(prev => prev + ref)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      const len = (prompt + ref).length
      inputRef.current?.setSelectionRange(len, len)
    })
  }, [prompt])

  const handleSubmit = () => {
    if (!prompt.trim() || !activeProject || status === 'running') return
    send(prompt.trim(), activeProject, allowedTools)
    setPrompt('')
    setAcQuery(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete keyboard handling
    if (acQuery !== null && acResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcSelected(p => (p + 1) % acResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcSelected(p => (p - 1 + acResults.length) % acResults.length)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (acResults[acSelected]) insertFileRef(acResults[acSelected])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAcQuery(null)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        if (acResults[acSelected]) insertFileRef(acResults[acSelected])
        return
      }
    }

    // Normal Enter to send
    if (e.key === 'Enter') {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      handleSubmit()
    }
  }

  const toggleTool = (name: string) => {
    setAllowedTools(prev =>
      prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name]
    )
  }

  const showAutocomplete = acQuery !== null && acQuery.length >= 0 && acResults.length > 0

  return (
    <div className="flex h-full">
      {/* File tree sidebar — opaque, flush, VS Code style */}
      {activeProject && (
        <div className="w-56 shrink-0 border-r border-ax-border bg-ax-elevated overflow-hidden">
          <FileTree project={activeProject} onFileReference={handleFileReference} />
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact header bar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-ax-border-subtle bg-ax-base">
          <Terminal size={12} className="text-ax-text-tertiary" />
          {activeProject && (
            <span className="font-mono text-[10px] text-ax-text-secondary truncate max-w-[120px]">
              {activeProject}
            </span>
          )}
          <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {status === 'running' && (
            <span className="font-mono text-[10px] text-ax-text-tertiary flex items-center gap-1">
              <Clock size={9} /> {elapsed}s
            </span>
          )}
          {sessionId && (
            <span className="font-mono text-[10px] text-ax-text-ghost">
              session
            </span>
          )}
          <div className="flex-1" />
          {/* Tool permissions toggle */}
          <button
            onClick={() => setShowPerms(p => !p)}
            className={`flex items-center gap-1 font-mono text-[10px] transition-colors
              ${showPerms ? 'text-ax-brand' : 'text-ax-text-ghost hover:text-ax-text-tertiary'}`}
          >
            <Shield size={10} />
            <span>{allowedTools.length}/{ALL_TOOLS.length}</span>
            <ChevronDown size={8} className={`transition-transform ${showPerms ? 'rotate-180' : ''}`} />
          </button>
          {events.length > 0 && status !== 'running' && (
            <button
              onClick={reset}
              className="flex items-center gap-1 font-mono text-[10px] text-ax-text-tertiary
                hover:text-ax-text-secondary transition-colors ml-1"
            >
              <RotateCcw size={9} /> New
            </button>
          )}
        </div>

        {/* Tool permissions bar */}
        {showPerms && (
          <div className="shrink-0 flex items-center gap-1 px-4 py-1 border-b border-ax-border-subtle bg-ax-sunken/30">
            <span className="text-[9px] text-ax-text-ghost font-mono mr-1">Tools:</span>
            {ALL_TOOLS.map(tool => (
              <button
                key={tool.name}
                onClick={() => toggleTool(tool.name)}
                disabled={status === 'running'}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors
                  disabled:opacity-50
                  ${allowedTools.includes(tool.name)
                    ? tool.safe
                      ? 'bg-ax-success/10 text-ax-success border border-ax-success/20'
                      : 'bg-ax-warning/10 text-ax-warning border border-ax-warning/20'
                    : 'bg-ax-sunken text-ax-text-ghost border border-ax-border-subtle'
                  }`}
              >
                {tool.label}
              </button>
            ))}
          </div>
        )}

        {/* Timeline — takes all available space */}
        {events.length > 0 ? (
          <AgentTimeline events={events} status={status} />
        ) : (
          <div className="flex-1 flex items-center justify-center min-h-0">
            <div className="text-center">
              <Terminal size={20} className="text-ax-text-ghost mx-auto mb-2" />
              <p className="text-micro text-ax-text-tertiary max-w-xs">
                {activeProject
                  ? 'Type a prompt below to start. Use @filename to reference files.'
                  : 'Select a project in the sidebar first.'}
              </p>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="shrink-0 mx-3 mb-2 bg-ax-error-subtle border border-ax-error/20 rounded px-3 py-1">
            <p className="text-[10px] text-ax-error font-mono">{error}</p>
          </div>
        )}

        {/* Chat input at bottom */}
        <div className="shrink-0 relative border-t border-ax-border-subtle px-3 pt-2 pb-1.5">
          {/* File autocomplete dropdown */}
          {showAutocomplete && activeProject && (
            <FileAutocomplete
              results={acResults}
              loading={acLoading}
              query={acQuery!}
              selected={acSelected}
              onSelect={insertFileRef}
              onHover={setAcSelected}
              onClose={() => setAcQuery(null)}
            />
          )}

          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={() => {
                // Re-check @-query on click (cursor may have moved)
                const textarea = inputRef.current
                if (textarea) {
                  setAcQuery(extractAtQuery(prompt, textarea.selectionStart))
                }
              }}
              placeholder={
                !activeProject ? 'Select a project first...'
                : status === 'running' ? 'Waiting for agent...'
                : sessionId ? 'Follow-up message...'
                : 'What should the agent do? Use @ to reference files'
              }
              disabled={!activeProject || status === 'running'}
              rows={1}
              className="flex-1 bg-ax-elevated border border-ax-border rounded-lg px-3 py-2
                text-small text-ax-text-primary placeholder:text-ax-text-tertiary resize-none
                focus:outline-none focus:border-ax-brand
                disabled:opacity-40 transition-colors"
              style={{ minHeight: 36, maxHeight: 120 }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 120) + 'px'
              }}
            />
            {status === 'running' ? (
              <button
                onClick={stop}
                className="shrink-0 p-2 bg-ax-error/10 text-ax-error rounded-lg
                  hover:bg-ax-error/20 transition-colors
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-error"
                aria-label="Stop agent"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || !activeProject}
                className="shrink-0 p-2 bg-ax-brand text-white rounded-lg
                  hover:bg-ax-brand-hover transition-colors
                  disabled:opacity-30 disabled:cursor-not-allowed
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand"
                aria-label="Send prompt"
              >
                <Send size={16} />
              </button>
            )}
          </div>
          <span className="text-[9px] text-ax-text-tertiary px-1 mt-0.5 block">Enter to send · Shift+Enter for newline · @ to reference files</span>
        </div>
      </div>
    </div>
  )
}
