import { useState, useRef, useCallback, useEffect } from 'react'
import type { AgentEvent, AgentStatus } from './types'

export function useAgentSession() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  // Elapsed timer
  useEffect(() => {
    if (status === 'running') {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [status])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setStatus(prev => prev === 'running' ? 'complete' : prev)
  }, [])

  // Cleanup on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const send = useCallback(async (prompt: string, project: string, allowedTools?: string[]) => {
    // Inject user message into timeline
    setEvents(prev => [...prev, {
      kind: 'user_message',
      id: `user-${Date.now()}`,
      timestamp: Date.now(),
      text: prompt,
    }])
    setError(null)
    setElapsed(0)
    setStatus('running')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/axon/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          project,
          allowedTools: allowedTools || ['Read', 'Glob', 'Grep', 'Bash', 'Edit', 'Write'],
          continueSession: sessionId != null,
        }),
        signal: controller.signal,
      })

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
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
            const evt = JSON.parse(line.slice(6)) as AgentEvent
            setEvents(prev => [...prev, { ...evt, timestamp: Date.now() }])

            if (evt.kind === 'result') {
              setStatus('complete')
              if (evt.sessionId) setSessionId(evt.sessionId)
            } else if (evt.kind === 'error') {
              setError(evt.text || 'Unknown error')
              setStatus('error')
            }
          } catch { /* incomplete JSON, skip */ }
        }
      }

      setStatus(prev => prev === 'running' ? 'complete' : prev)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
      setStatus('error')
    }
  }, [sessionId])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setEvents([])
    setStatus('idle')
    setError(null)
    setElapsed(0)
    setSessionId(null)
  }, [])

  return { events, status, elapsed, error, sessionId, send, stop, reset }
}
