import { useState, useEffect, useRef, useCallback } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'
import { Search, Sparkles, ArrowLeft, Send, ExternalLink, MessageSquare } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'system' | 'assistant' | 'user'
  content: string
  timestamp: Date
  streaming?: boolean
}

interface SessionRef {
  id: string
  project: string
  date: string
  description: string
}

// ─── Token parsing ───────────────────────────────────────────────

const SESSION_TOKEN_RE = /\[\[session:([^|]+)\|([^|]+)\|([^|]+)\|"([^"]+)"\]\]/g

function parseSessionTokens(text: string): Array<{ type: 'text'; value: string } | { type: 'session'; ref: SessionRef }> {
  const parts: Array<{ type: 'text'; value: string } | { type: 'session'; ref: SessionRef }> = []
  let lastIdx = 0

  for (const match of text.matchAll(SESSION_TOKEN_RE)) {
    const idx = match.index!
    if (idx > lastIdx) {
      parts.push({ type: 'text', value: text.slice(lastIdx, idx) })
    }
    parts.push({
      type: 'session',
      ref: {
        id: match[1],
        project: match[2],
        date: match[3],
        description: match[4],
      },
    })
    lastIdx = idx + match[0].length
  }

  if (lastIdx < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIdx) })
  }

  return parts
}

// ─── Session Chip ────────────────────────────────────────────────

function SessionChip({ ref: sessionRef }: { ref: SessionRef }) {
  const openTerminal = useUIStore(s => s.openTerminal)
  const setActiveProject = useProjectStore(s => s.setActiveProject)

  return (
    <button
      onClick={() => {
        setActiveProject(sessionRef.project)
        openTerminal(sessionRef.id)
      }}
      className="inline-flex items-start gap-2 my-1.5 px-3 py-2 bg-ax-sunken/80 hover:bg-ax-sunken
        border border-ax-border-subtle hover:border-ax-brand/30 rounded-lg transition-all group
        text-left max-w-full"
    >
      <MessageSquare size={14} className="text-ax-brand shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-ax-text-primary font-medium leading-snug truncate">
          {sessionRef.description}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-mono text-[9px] text-ax-text-tertiary">{sessionRef.project}</span>
          <span className="text-ax-text-ghost">·</span>
          <span className="font-mono text-[9px] text-ax-text-tertiary">{sessionRef.date}</span>
          <span className="text-ax-text-ghost">·</span>
          <span className="font-mono text-[9px] text-ax-text-ghost truncate">{sessionRef.id.slice(0, 8)}</span>
        </div>
      </div>
      <ExternalLink size={10} className="text-ax-text-ghost group-hover:text-ax-brand shrink-0 mt-1 transition-colors" />
    </button>
  )
}

// ─── Markdown-lite renderer with session token support ────────────

function SearchContent({ content }: { content: string }) {
  const parts = parseSessionTokens(content)

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'session') {
          return <SessionChip key={i} ref={part.ref} />
        }
        // Render text with basic markdown
        return <TextBlock key={i} text={part.value} />
      })}
    </>
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // H2
    const h2Match = line.match(/^##\s+(.+)/)
    if (h2Match) {
      elements.push(
        <h3 key={i} className="font-serif italic text-[15px] text-ax-text-primary tracking-tight mt-4 mb-2 first:mt-0 pb-1.5 border-b border-ax-border-subtle">
          {formatInline(h2Match[1])}
        </h3>
      )
      continue
    }

    // H3
    const h3Match = line.match(/^###\s+(.+)/)
    if (h3Match) {
      elements.push(
        <h4 key={i} className="font-mono text-[10px] text-ax-text-tertiary uppercase tracking-widest mt-3 mb-1.5 first:mt-0">
          {formatInline(h3Match[1])}
        </h4>
      )
      continue
    }

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-ax-sunken/60 rounded-md px-3 py-2.5 my-2 overflow-x-auto">
          {lang && <div className="font-mono text-[9px] text-ax-text-ghost mb-1.5 uppercase tracking-wider">{lang}</div>}
          <code className="font-mono text-[11px] text-ax-text-primary leading-relaxed">{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Bullet list
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/)
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2)
      elements.push(
        <div key={i} className="flex gap-2.5 mb-0.5" style={{ paddingLeft: `${indent * 14}px` }}>
          <span className="text-ax-text-ghost shrink-0 text-[8px] pt-[4px]">{indent > 0 ? '◦' : '●'}</span>
          <span>{formatInline(bulletMatch[2])}</span>
        </div>
      )
      continue
    }

    // Numbered list
    const numMatch = line.match(/^(\s*)\d+\.\s+(.+)/)
    if (numMatch) {
      const num = line.match(/(\d+)\./)?.[1] || '1'
      const indent = Math.floor(numMatch[1].length / 2)
      elements.push(
        <div key={i} className="flex gap-2.5 mb-0.5" style={{ paddingLeft: `${indent * 14}px` }}>
          <span className="font-mono text-[10px] text-ax-brand/70 shrink-0 w-4 text-right pt-[2px]">{num}.</span>
          <span>{formatInline(numMatch[2])}</span>
        </div>
      )
      continue
    }

    // Regular text
    if (line.trim()) {
      elements.push(<p key={i} className="mb-0.5">{formatInline(line)}</p>)
    } else {
      elements.push(<div key={i} className="h-2" />)
    }
  }

  return <>{elements}</>
}

function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="text-ax-text-primary font-semibold">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i} className="text-ax-text-secondary">{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="font-mono text-[11px] bg-ax-sunken/60 px-1 py-px rounded text-ax-text-primary">{part.slice(1, -1)}</code>
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch)
      return <span key={i} className="text-ax-brand underline underline-offset-2 decoration-ax-brand/30">{linkMatch[1]}</span>
    return <span key={i}>{part}</span>
  })
}

// ─── Main View ───────────────────────────────────────────────────

export function DeepSearchView() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const goBack = useUIStore(s => s.goBack)

  // Check for initial query from CommandPalette
  useEffect(() => {
    const initialQuery = sessionStorage.getItem('axon-deep-search-query')
    if (initialQuery) {
      sessionStorage.removeItem('axon-deep-search-query')
      setInput(initialQuery)
      // Auto-submit after a brief delay
      setTimeout(() => {
        handleSend(initialQuery)
      }, 100)
    } else {
      inputRef.current?.focus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(async (overridePrompt?: string) => {
    const prompt = overridePrompt || input.trim()
    if (!prompt || streaming) return

    setInput('')
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    }

    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      streaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/axon/search/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, continueSession: hasSession }),
        signal: controller.signal,
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'content') {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + data.text }
                }
                return updated
              })
            } else if (data.type === 'done') {
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, streaming: false }
                }
                return updated
              })
            }
          } catch { /* ignore parse errors */ }
        }
      }

      setHasSession(true)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = {
              ...last,
              content: last.content || 'Search failed. Is Claude CLI available?',
              streaming: false,
            }
          }
          return updated
        })
      }
    }

    setStreaming(false)
    abortRef.current = null
    inputRef.current?.focus()
  }, [input, streaming, hasSession])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-ax-border-subtle">
        <button
          onClick={goBack}
          className="text-ax-text-tertiary hover:text-ax-text-primary transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft size={16} />
        </button>
        <Sparkles size={16} className="text-ax-brand" />
        <h1 className="font-serif italic text-[18px] text-ax-text-primary tracking-tight">Deep Search</h1>
        <span className="font-mono text-[9px] text-ax-text-ghost uppercase tracking-widest ml-2">AI-powered session search</span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-12 h-12 rounded-xl bg-ax-brand/10 flex items-center justify-center mb-4">
                <Search size={20} className="text-ax-brand" />
              </div>
              <h2 className="font-serif italic text-[20px] text-ax-text-primary mb-2">Search your history</h2>
              <p className="text-[13px] text-ax-text-tertiary max-w-sm leading-relaxed">
                Describe what you're looking for in natural language. The AI will search across all your Claude Code sessions.
              </p>
              <div className="flex flex-wrap gap-2 mt-6 justify-center">
                {['that chat about auth middleware', 'conversations mentioning Tailscale', 'when I fixed the canvas bug'].map(eg => (
                  <button
                    key={eg}
                    onClick={() => { setInput(eg); setTimeout(() => handleSend(eg), 50) }}
                    className="px-3 py-1.5 bg-ax-sunken rounded-full text-[11px] text-ax-text-secondary
                      hover:bg-ax-brand/10 hover:text-ax-brand transition-colors font-mono"
                  >
                    {eg}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id}>
              {msg.role === 'user' && (
                <div className="flex justify-end">
                  <div className="max-w-[70%]">
                    <p className="text-[13px] text-ax-text-primary leading-[1.7] whitespace-pre-wrap text-right">
                      {msg.content}
                    </p>
                    <time className="block text-[9px] font-mono text-ax-text-ghost mt-1 text-right">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </time>
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && (
                <div className="animate-fade-in-up">
                  <div className="border-l-2 border-ax-brand/20 pl-5">
                    <div className="text-[13px] text-ax-text-secondary leading-[1.7] whitespace-pre-wrap">
                      <SearchContent content={msg.content} />
                    </div>
                    {msg.streaming && (
                      <div className="flex items-center gap-2 mt-3">
                        <div className="flex gap-1">
                          {[0, 1, 2].map(i => (
                            <div key={i} className="thinking-dot w-1 h-1 rounded-full bg-ax-brand/50" />
                          ))}
                        </div>
                        <span className="text-[9px] font-mono text-ax-text-ghost uppercase tracking-wider">searching</span>
                      </div>
                    )}
                  </div>
                  <time className="block text-[9px] font-mono text-ax-text-ghost mt-2 pl-5">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </time>
                </div>
              )}
            </div>
          ))}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-ax-border-subtle px-6 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 bg-ax-sunken rounded-xl border border-ax-border-subtle
            focus-within:border-ax-brand/40 transition-colors px-4 py-2.5">
            <Search size={14} className="text-ax-text-tertiary shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasSession ? 'Refine your search...' : 'What are you looking for?'}
              disabled={streaming}
              aria-label="Search query"
              className="flex-1 bg-transparent text-[13px] text-ax-text-primary placeholder-ax-text-tertiary/50
                focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || streaming}
              aria-label="Search"
              className="text-ax-brand hover:text-ax-brand/80 disabled:text-ax-text-ghost disabled:cursor-not-allowed
                transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <p className="font-mono text-[9px] text-ax-text-ghost">
              Read-only search · Sessions stored under /axon/search
            </p>
            {hasSession && (
              <button
                onClick={() => {
                  setMessages([])
                  setHasSession(false)
                  setInput('')
                  inputRef.current?.focus()
                }}
                className="font-mono text-[9px] text-ax-text-tertiary hover:text-ax-brand transition-colors"
              >
                New search
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
