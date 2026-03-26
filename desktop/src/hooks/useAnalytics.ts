import { useState, useEffect, useCallback } from 'react'

export interface AnalyticsData {
  totalTokens: number
  avgTokensPerSession: number
  totalSessions: number
  tokensByAgent: { agent: string; tokens: number }[]
  tokensByModel: { model: string; agent: string; tokens: number }[]
  activeAgents: string[]
}

export function useAnalytics(since: string | null) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const url = since
        ? `/api/axon/sessions/analytics?since=${encodeURIComponent(since)}`
        : '/api/axon/sessions/analytics'
      const res = await fetch(url)
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [since])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, refetch: fetchData }
}
