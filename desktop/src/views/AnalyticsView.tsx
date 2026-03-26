import { useState, useMemo } from 'react'
import { useAnalytics } from '@/hooks/useAnalytics'
import { AGENTS, type AgentId } from '@/lib/agents/types'

type Period = 'today' | 'week' | 'month' | 'all'

function getPeriodSince(period: Period): string | null {
  const now = new Date()
  switch (period) {
    case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    case 'week': {
      const d = new Date(now)
      d.setDate(d.getDate() - d.getDay())
      d.setHours(0, 0, 0, 0)
      return d.toISOString()
    }
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    case 'all': return null
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function agentColor(agent: string): string {
  return AGENTS[agent as AgentId]?.color || '#888'
}

export function AnalyticsView() {
  const [period, setPeriod] = useState<Period>('all')
  const since = useMemo(() => getPeriodSince(period), [period])
  const { data, loading } = useAnalytics(since)

  if (loading || !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-ax-sunken rounded w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-ax-sunken rounded-xl" />)}
        </div>
      </div>
    )
  }

  const maxAgentTokens = Math.max(...data.tokensByAgent.map(a => a.tokens), 1)
  const maxModelTokens = Math.max(...data.tokensByModel.map(m => m.tokens), 1)

  return (
    <div>
      {/* Period toggle */}
      <div className="flex gap-0.5 bg-ax-sunken rounded-lg p-0.5 mb-6 w-fit">
        {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1 rounded-md font-mono text-micro transition-colors
              ${period === p ? 'bg-ax-elevated text-ax-text-primary shadow-sm' : 'text-ax-text-tertiary hover:text-ax-text-secondary'}`}
          >
            {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : 'All Time'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Avg Tokens / Session</div>
          <div className="text-2xl font-bold text-ax-text-primary">{formatTokens(data.avgTokensPerSession)}</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Total Tokens</div>
          <div className="text-2xl font-bold text-ax-text-primary">{formatTokens(data.totalTokens)}</div>
          <div className="font-mono text-micro text-ax-text-tertiary mt-1">{data.totalSessions} sessions</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Active Sessions</div>
          <div className="text-2xl font-bold text-ax-text-primary">{data.totalSessions}</div>
        </div>
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <div className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-1">Active Agents</div>
          <div className="text-2xl font-bold text-ax-text-primary">{data.activeAgents.length}</div>
          <div className="font-mono text-micro text-ax-text-tertiary mt-1">
            {data.activeAgents.map(a => AGENTS[a as AgentId]?.name || a).join(', ')}
          </div>
        </div>
      </div>

      {/* Tokens by Agent */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border p-5 mb-4">
        <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-3">Tokens by Agent</h4>
        <div className="space-y-2">
          {data.tokensByAgent.map(a => (
            <div key={a.agent} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: agentColor(a.agent) }} />
              <span className="font-mono text-small text-ax-text-secondary w-28 shrink-0 truncate">
                {AGENTS[a.agent as AgentId]?.name || a.agent}
              </span>
              <div className="flex-1 h-4 bg-ax-sunken rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{
                  width: `${Math.max(2, Math.round((a.tokens / maxAgentTokens) * 100))}%`,
                  background: agentColor(a.agent),
                }} />
              </div>
              <span className="font-mono text-micro text-ax-text-tertiary w-16">
                {a.tokens > 0 ? formatTokens(a.tokens) : 'N/A'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Tokens by Model */}
      {data.tokensByModel.length > 0 && (
        <div className="bg-ax-elevated rounded-xl border border-ax-border p-5">
          <h4 className="font-mono text-micro text-ax-text-tertiary uppercase tracking-wider mb-3">Tokens by Model</h4>
          <div className="space-y-2">
            {data.tokensByModel.map(m => (
              <div key={`${m.agent}-${m.model}`} className="flex items-center gap-3">
                <span className="font-mono text-small text-ax-text-secondary w-28 shrink-0 text-right truncate" title={m.model}>
                  {m.model}
                </span>
                <div className="flex-1 h-4 bg-ax-sunken rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{
                    width: `${Math.max(2, Math.round((m.tokens / maxModelTokens) * 100))}%`,
                    background: agentColor(m.agent),
                  }} />
                </div>
                <span className="font-mono text-micro text-ax-text-tertiary w-16">{formatTokens(m.tokens)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
