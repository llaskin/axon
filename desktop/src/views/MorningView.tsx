import { useEffect, useState, useRef, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useBackend } from '@/providers/DataProvider'
import { useRollups } from '@/hooks/useRollups'
import { formatDate, getGreeting } from '@/lib/utils'
import { Coffee, Send, Clock, Sparkles, RotateCcw } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'system' | 'assistant' | 'user'
  content: string
  timestamp: Date
  streaming?: boolean
}

type SessionStatus = 'idle' | 'loading-context' | 'connecting' | 'streaming' | 'ready' | 'error'

type ThinkingPhase = 'gathering' | 'reading' | 'sending' | 'thinking'

// ─── Tauri shell integration ─────────────────────────────────────

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// ─── Component ───────────────────────────────────────────────────

export function MorningView() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const projects = useProjectStore((s) => s.projects)
  const backend = useBackend()
  const { rollups } = useRollups(activeProject)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase>('gathering')
  const [error, setError] = useState<string | null>(null)
  const [pastSessions, setPastSessions] = useState<Array<{ filename: string; date: string; content: string }>>([])
  const [showHistory, setShowHistory] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const childRef = useRef<{ kill: () => void } | null>(null)

  const activeProjectData = projects.find(p => p.name === activeProject)

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Load past sessions
  useEffect(() => {
    if (!activeProject) return
    backend.getMornings(activeProject).then(raw => {
      setPastSessions(raw.map(r => ({
        filename: r.filename,
        date: r.filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '',
        content: r.content,
      })).filter(s => s.content.length > 10))
    }).catch(() => setPastSessions([]))
  }, [activeProject])

  // Build morning context from project data
  const buildMorningPrompt = useCallback(async (preloadedState?: string) => {
    if (!activeProject) return ''

    const stateContent = preloadedState ?? await backend.getState(activeProject).catch(() => '')
    const latestRollup = rollups[0]

    const parts = [
      `You are Axon, a developer intelligence system. This is a morning briefing session for project "${activeProject}".`,
      '',
      '## Project State',
      stateContent || '(no state file found)',
      '',
    ]

    if (latestRollup) {
      parts.push(
        '## Latest Rollup',
        `**${latestRollup.frontmatter.headline || latestRollup.filename}** (${latestRollup.frontmatter.date || 'unknown date'})`,
        '',
        latestRollup.body.slice(0, 3000),
        '',
      )
    }

    parts.push(
      '## Instructions',
      'Deliver a concise morning briefing:',
      '1. **Status** — one-line overall state',
      '2. **What happened** — key changes since last rollup (2-3 bullets)',
      '3. **Top priorities** — ranked by leverage, with scope estimates',
      '4. **Risk flags** — anything stale, blocked, or untested',
      '5. **Recommended first move** — what to start with and why',
      '',
      'Be opinionated. This is a briefing, not a summary. After the briefing, stay in conversation — the developer may want to discuss priorities or plan the day.',
    )

    return parts.join('\n')
  }, [activeProject, rollups, backend])

  // Start a morning session
  const startSession = useCallback(async () => {
    if (!activeProject) return

    setStatus('loading-context')
    setThinkingPhase('gathering')
    setError(null)
    setMessages([])

    try {
      // Phase: gathering → reading → sending
      setThinkingPhase('gathering')
      const stateContent = await backend.getState(activeProject).catch(() => '')

      setThinkingPhase('reading')
      const prompt = await buildMorningPrompt(stateContent)

      setThinkingPhase('sending')
      setStatus('connecting')

      if (isTauri()) {
        // Spawn claude via Tauri shell
        const { Command } = await import('@tauri-apps/plugin-shell')

        setThinkingPhase('thinking')
        setStatus('streaming')

        const command = Command.create('claude', ['-p', prompt, '--allowedTools', 'Read,Glob,Grep'])
        let buffer = ''

        command.stdout.on('data', (data: string) => {
          buffer += data
          // First chunk arrives — create the message bubble
          setMessages(prev => {
            const existing = prev.find(m => m.id === 'assistant-briefing')
            if (existing) return prev.map(m => m.id === 'assistant-briefing' ? { ...m, content: buffer } : m)
            return [...prev, { id: 'assistant-briefing', role: 'assistant' as const, content: buffer, timestamp: new Date(), streaming: true }]
          })
        })

        command.stderr.on('data', (data: string) => {
          // Claude CLI progress output — ignore
          console.debug('[claude stderr]', data)
        })

        command.on('close', (data: { code: number | null }) => {
          setMessages(prev =>
            prev.map(m => m.id === 'assistant-briefing' ? { ...m, streaming: false } : m)
          )
          if (data.code !== 0 && buffer.length === 0) {
            setError('Claude exited with an error. Check that the claude CLI is installed.')
          }
          setStatus('ready')
          childRef.current = null
        })

        command.on('error', (err: string) => {
          setError(`Failed to start Claude: ${err}`)
          setStatus('error')
          childRef.current = null
        })

        const child = await command.spawn()
        childRef.current = child

      } else {
        // Dev mode — stream via Vite SSE proxy
        setThinkingPhase('thinking')
        setStatus('streaming')

        try {
          const res = await fetch('/api/axon/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          })

          const reader = res.body?.getReader()
          if (!reader) throw new Error('No response stream')

          const decoder = new TextDecoder()
          let buffer = ''
          let sseBuffer = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            sseBuffer += decoder.decode(value, { stream: true })
            const lines = sseBuffer.split('\n')
            sseBuffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6))
                if (event.type === 'content') {
                  buffer += event.text
                  setMessages(prev => {
                    const existing = prev.find(m => m.id === 'assistant-briefing')
                    if (existing) return prev.map(m => m.id === 'assistant-briefing' ? { ...m, content: buffer } : m)
                    return [...prev, { id: 'assistant-briefing', role: 'assistant' as const, content: buffer, timestamp: new Date(), streaming: true }]
                  })
                } else if (event.type === 'done') {
                  setMessages(prev =>
                    prev.map(m => m.id === 'assistant-briefing' ? { ...m, streaming: false } : m)
                  )
                  setStatus('ready')
                } else if (event.type === 'error') {
                  setError(event.message)
                  setStatus('error')
                }
              } catch {}
            }
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Stream failed')
          setStatus('error')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session')
      setStatus('error')
    }
  }, [activeProject, buildMorningPrompt, rollups, activeProjectData])

  // Send a follow-up message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || status !== 'ready') return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStatus('streaming')

    if (isTauri()) {
      const { Command } = await import('@tauri-apps/plugin-shell')

      const responseId = `assistant-${Date.now()}`
      setMessages(prev => [
        ...prev,
        { id: responseId, role: 'assistant', content: '', timestamp: new Date(), streaming: true },
      ])

      const command = Command.create('claude', [
        '--continue', '-p', userMsg.content,
        '--allowedTools', 'Read,Glob,Grep',
      ])

      let buffer = ''

      command.stdout.on('data', (data: string) => {
        buffer += data
        setMessages(prev =>
          prev.map(m => m.id === responseId ? { ...m, content: buffer } : m)
        )
      })

      command.on('close', () => {
        setMessages(prev =>
          prev.map(m => m.id === responseId ? { ...m, streaming: false } : m)
        )
        setStatus('ready')
      })

      command.on('error', () => {
        setStatus('ready')
      })

      await command.spawn()
    } else {
      // Dev mode — stream via Vite SSE proxy
      const responseId = `assistant-${Date.now()}`
      setMessages(prev => [
        ...prev,
        { id: responseId, role: 'assistant', content: '', timestamp: new Date(), streaming: true },
      ])

      try {
        const res = await fetch('/api/axon/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: userMsg.content, continueSession: true }),
        })

        const reader = res.body?.getReader()
        if (!reader) throw new Error('No response stream')

        const decoder = new TextDecoder()
        let buffer = ''
        let sseBuffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'content') {
                buffer += event.text
                setMessages(prev =>
                  prev.map(m => m.id === responseId ? { ...m, content: buffer } : m)
                )
              } else if (event.type === 'done') {
                setMessages(prev =>
                  prev.map(m => m.id === responseId ? { ...m, streaming: false } : m)
                )
                setStatus('ready')
              }
            } catch {}
          }
        }
      } catch {
        setStatus('ready')
      }
    }
  }, [input, status])

  // Handle Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Kill active process on unmount
  useEffect(() => {
    return () => {
      if (childRef.current) {
        childRef.current.kill()
      }
    }
  }, [])

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <header className="shrink-0 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-serif italic text-body text-ax-text-tertiary mb-1">
              {getGreeting()}
            </p>
            <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
              Morning
            </h1>
          </div>
          <div className="flex gap-2">
            {pastSessions.length > 0 && (
              <button
                onClick={() => setShowHistory(!showHistory)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-small font-mono transition-all
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand
                  ${showHistory
                    ? 'bg-ax-brand-subtle text-ax-brand border border-ax-brand/30'
                    : 'bg-ax-sunken text-ax-text-tertiary hover:text-ax-text-secondary border border-ax-border-subtle'
                  }`}
              >
                <Clock size={14} />
                {pastSessions.length} past
              </button>
            )}
          </div>
        </div>
      </header>

      {/* History panel */}
      {showHistory && (
        <div className="shrink-0 mb-4 max-h-64 overflow-y-auto bg-ax-sunken rounded-xl border border-ax-border-subtle p-3 space-y-2">
          {pastSessions.map(session => (
            <button
              key={session.filename}
              onClick={() => {
                setMessages([
                  { id: 'system-history', role: 'system', content: `Viewing session from ${formatDate(session.date)}`, timestamp: new Date() },
                  { id: 'assistant-history', role: 'assistant', content: session.content, timestamp: new Date() },
                ])
                setStatus('ready')
                setShowHistory(false)
              }}
              className="w-full text-left px-3 py-2 rounded-lg bg-ax-elevated border border-ax-border-subtle
                hover:border-ax-border transition-colors flex items-center gap-3
                focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand"
            >
              <time className="font-mono text-small text-ax-text-tertiary shrink-0">{formatDate(session.date)}</time>
              <span className="text-small text-ax-text-secondary truncate">
                {session.content.split('\n').find(l => l.trim())?.slice(0, 60) || '(empty)'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Chat area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4 min-h-0"
      >
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-16 h-16 bg-ax-brand-subtle rounded-2xl flex items-center justify-center mb-6">
              <Coffee size={28} className="text-ax-brand" />
            </div>
            <h2 className="font-serif italic text-h3 text-ax-text-primary mb-2">
              Ready for your briefing
            </h2>
            <p className="text-body text-ax-text-secondary max-w-sm mb-6">
              {activeProject ? (
                <>Start an AI-powered morning briefing for <span className="font-mono">{activeProject}</span>. Claude will review your latest rollup, state, and open loops.</>
              ) : (
                'Select a project to begin'
              )}
            </p>
            {activeProject && (
              <div className="flex gap-3">
                <button
                  onClick={startSession}
                  className="flex items-center gap-2 px-5 py-2.5 bg-ax-brand text-white rounded-lg text-body font-medium
                    hover:bg-ax-brand-hover transition-colors shadow-sm
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand focus-visible:ring-offset-2"
                >
                  <Sparkles size={16} />
                  Start Briefing
                </button>
              </div>
            )}

            {/* Quick stats */}
            {activeProjectData && (
              <div className="flex gap-4 mt-8">
                <div className="flex items-center gap-2 text-small text-ax-text-tertiary">
                  <Clock size={12} />
                  {activeProjectData.lastRollup ? formatDate(activeProjectData.lastRollup) : 'No rollups'}
                </div>
                <div className="text-small text-ax-text-tertiary">
                  {rollups.length} rollup{rollups.length !== 1 ? 's' : ''}
                </div>
                {activeProjectData.openLoopCount > 0 && (
                  <div className="text-small text-ax-text-tertiary">
                    {activeProjectData.openLoopCount} open loops
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Thinking indicator — visible during loading + streaming with no content yet */}
        {(status === 'loading-context' || status === 'connecting' || (status === 'streaming' && messages.length === 0)) && (
          <ThinkingIndicator phase={thinkingPhase} project={activeProject || ''} />
        )}

        {/* Mini thinking for follow-up messages (has messages but streaming with no new content yet) */}
        {status === 'streaming' && messages.length > 0 && !messages.some(m => m.streaming) && (
          <div className="flex justify-start animate-fade-in">
            <div className="bg-ax-elevated border border-ax-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="thinking-dot w-1.5 h-1.5 rounded-full bg-ax-brand" />
              ))}
              <span className="text-small text-ax-text-tertiary">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      {(status === 'ready' || status === 'streaming') && (
        <div className="shrink-0 pt-3 border-t border-ax-border-subtle">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={status === 'streaming' ? 'Waiting for response...' : 'Ask about priorities, plan the day, or discuss decisions...'}
                disabled={status === 'streaming'}
                rows={1}
                className="w-full bg-ax-elevated border border-ax-border rounded-xl px-4 py-3 pr-12
                  text-body text-ax-text-primary placeholder-ax-text-tertiary resize-none
                  focus:outline-none focus:border-ax-brand focus:ring-1 focus:ring-ax-brand/20
                  disabled:opacity-50 transition-colors"
                style={{ minHeight: '48px', maxHeight: '120px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || status !== 'ready'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg
                  text-ax-text-tertiary hover:text-ax-brand disabled:opacity-30
                  transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-micro text-ax-text-tertiary">
              Connected to Claude CLI
            </span>
            {status === 'ready' && messages.length > 1 && (
              <button
                onClick={() => {
                  setMessages([])
                  setStatus('idle')
                  setInput('')
                }}
                className="flex items-center gap-1 text-micro text-ax-text-tertiary hover:text-ax-text-secondary transition-colors"
              >
                <RotateCcw size={10} />
                New session
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="shrink-0 mt-3 bg-ax-error-subtle border border-ax-error/20 rounded-xl p-4">
          <p className="text-small text-ax-error">{error}</p>
          <button
            onClick={() => { setError(null); setStatus('idle'); setMessages([]) }}
            className="text-micro text-ax-error/70 hover:text-ax-error mt-1 underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Thinking Indicator ─────────────────────────────────────────

const PHASE_CONFIG: Record<ThinkingPhase, { label: string; detail: string }> = {
  gathering: { label: 'Gathering context', detail: 'Reading project state and open loops...' },
  reading: { label: 'Preparing briefing', detail: 'Analyzing latest rollup and priorities...' },
  sending: { label: 'Connecting to Claude', detail: 'Sending project context...' },
  thinking: { label: 'Claude is thinking', detail: 'Composing your morning briefing...' },
}

function ThinkingIndicator({ phase, project }: { phase: ThinkingPhase; project: string }) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())

  useEffect(() => {
    startRef.current = Date.now()
    setElapsed(0)
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const config = PHASE_CONFIG[phase]
  const phaseIdx = ['gathering', 'reading', 'sending', 'thinking'].indexOf(phase)

  return (
    <div className="flex justify-start animate-fade-in-up">
      <div className="max-w-[85%] w-full">
        <div className="bg-ax-elevated border border-ax-border rounded-2xl rounded-bl-md px-5 py-5 space-y-4">
          {/* Animated wave dots */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="thinking-dot w-1.5 h-1.5 rounded-full bg-ax-brand"
                />
              ))}
            </div>
            <span className="text-body text-ax-text-primary font-medium">
              {config.label}
            </span>
            <span className="text-micro text-ax-text-tertiary font-mono ml-auto">
              {elapsed}s
            </span>
          </div>

          {/* Detail text */}
          <p className="text-small text-ax-text-secondary">
            {config.detail}
          </p>

          {/* Progress phases */}
          <div className="flex gap-1">
            {['gathering', 'reading', 'sending', 'thinking'].map((p, i) => (
              <div
                key={p}
                className={`h-1 rounded-full flex-1 transition-all duration-500 relative overflow-hidden ${
                  i < phaseIdx
                    ? 'bg-ax-brand'
                    : i === phaseIdx
                      ? 'bg-ax-brand/30'
                      : 'bg-ax-sunken'
                }`}
              >
                {i === phaseIdx && (
                  <div className="absolute inset-0 bg-ax-brand thinking-progress-bar rounded-full" />
                )}
              </div>
            ))}
          </div>

          {/* Context info pill */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-micro text-ax-text-tertiary bg-ax-sunken px-2 py-0.5 rounded-full font-mono">
              {project}
            </span>
            {phase === 'thinking' && elapsed > 3 && (
              <span className="text-micro text-ax-text-ghost animate-fade-in">
                Claude is reading your project deeply...
              </span>
            )}
            {phase === 'thinking' && elapsed > 8 && (
              <span className="text-micro text-ax-text-ghost animate-fade-in">
                Almost there
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Message Bubble ──────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-micro text-ax-text-tertiary bg-ax-sunken px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-ax-brand text-white rounded-2xl rounded-br-md px-4 py-3">
          <p className="text-body leading-relaxed whitespace-pre-wrap">{message.content}</p>
          <time className="block text-micro opacity-50 mt-1 text-right">
            {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex justify-start animate-fade-in-up">
      <div className="max-w-[90%]">
        <div className="bg-ax-elevated border border-ax-border rounded-2xl rounded-bl-md px-5 py-4">
          <div className="text-body text-ax-text-primary leading-relaxed whitespace-pre-wrap">
            <AssistantContent content={message.content} />
          </div>
          {message.streaming && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-ax-border-subtle">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="thinking-dot w-1 h-1 rounded-full bg-ax-brand/60" />
                ))}
              </div>
              <span className="text-micro text-ax-text-ghost">streaming</span>
            </div>
          )}
        </div>
        <time className="block text-micro text-ax-text-tertiary mt-1 ml-2">
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
    </div>
  )
}

// ─── Render assistant content with inline formatting ─────────────

function AssistantContent({ content }: { content: string }) {
  if (!content) return null

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Headings
    const h2Match = line.match(/^##\s+(.+)/)
    if (h2Match) {
      elements.push(
        <h3 key={i} className="font-serif text-h4 text-ax-text-primary font-medium mt-4 mb-2 first:mt-0">
          {formatInline(h2Match[1])}
        </h3>
      )
      continue
    }

    const h3Match = line.match(/^###\s+(.+)/)
    if (h3Match) {
      elements.push(
        <h4 key={i} className="font-medium text-ax-text-primary mt-3 mb-1">
          {formatInline(h3Match[1])}
        </h4>
      )
      continue
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      elements.push(<hr key={i} className="border-ax-border-subtle my-3" />)
      continue
    }

    // Code block markers
    if (line.startsWith('```')) {
      // Collect code block
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-ax-sunken rounded-lg p-3 my-2 overflow-x-auto border border-ax-border-subtle">
          {lang && <div className="font-mono text-micro text-ax-text-tertiary mb-1 uppercase">{lang}</div>}
          <code className="font-mono text-small text-ax-text-primary">{codeLines.join('\n')}</code>
        </pre>
      )
      continue
    }

    // Blockquotes
    const quoteMatch = line.match(/^>\s*(.*)/)
    if (quoteMatch) {
      elements.push(
        <div key={i} className="border-l-2 border-ax-brand/40 pl-3 py-0.5 text-ax-text-secondary italic">
          {formatInline(quoteMatch[1])}
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
        <div key={i} className="flex gap-2 mb-1" style={{ paddingLeft: `${indent * 16}px` }}>
          <span className="font-mono text-ax-brand shrink-0 w-5 text-right">{num}.</span>
          <span>{formatInline(numMatch[2])}</span>
        </div>
      )
      continue
    }

    // Bullet list
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)/)
    if (bulletMatch) {
      const indent = Math.floor(bulletMatch[1].length / 2)
      elements.push(
        <div key={i} className="flex gap-2 mb-1" style={{ paddingLeft: `${indent * 16}px` }}>
          <span className="text-ax-text-tertiary shrink-0">{indent > 0 ? '◦' : '•'}</span>
          <span>{formatInline(bulletMatch[2])}</span>
        </div>
      )
      continue
    }

    // Regular text
    if (line.trim()) {
      elements.push(<p key={i} className="mb-1">{formatInline(line)}</p>)
    } else {
      elements.push(<div key={i} className="h-1.5" />)
    }
  }

  return <>{elements}</>
}

function formatInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="text-ax-text-primary font-medium">{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="font-mono text-small bg-ax-sunken px-1 py-0.5 rounded">{part.slice(1, -1)}</code>
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch)
      return <span key={i} className="text-ax-brand underline underline-offset-2">{linkMatch[1]}</span>
    return <span key={i}>{part}</span>
  })
}
