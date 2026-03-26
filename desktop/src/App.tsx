import { type ReactNode, useState, useEffect, useRef } from 'react'
import { Coffee, Brain, Clock, Plus } from 'lucide-react'
import { DataProvider } from '@/providers/DataProvider'
import { Shell } from '@/components/layout/Shell'
import { TimelineView } from '@/views/TimelineView'
import { RollupDetailView } from '@/views/RollupDetailView'
import { StateView } from '@/views/StateView'
import { SettingsView } from '@/views/SettingsView'
import { DecisionsView } from '@/views/DecisionsView'
import { MorningView } from '@/views/MorningView'
import { OnboardingView } from '@/views/OnboardingView'
import { AgentView } from '@/views/AgentView'
import { SessionsView } from '@/views/SessionsView'
import { AnalyticsView } from '@/views/AnalyticsView'

function AnalyticsViewPage() {
  return (
    <div className="max-w-3xl mx-auto px-8 py-10">
      <AnalyticsView />
    </div>
  )
}
import { TodosView } from '@/views/TodosView'
import { SourceControlView } from '@/views/SourceControlView'
import { AboutView } from '@/views/AboutView'
import { GenesisProgressView } from '@/views/GenesisProgressView'
import { DeepSearchView } from '@/views/DeepSearchView'
import { IntroSplash } from '@/components/shared/IntroSplash'
import { PreflightCheck } from '@/components/shared/PreflightCheck'
import { AuthOverlay } from '@/components/shared/AuthOverlay'
import { setAuthHandler, installAuthInterceptor } from '@/lib/apiClient'
import { ErrorToast } from '@/components/shared/ErrorToast'
import { useErrorStore } from '@/store/errorStore'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'
import { Component, type ErrorInfo } from 'react'

// Install global fetch interceptor ONCE — injects auth headers on all /api/axon/* calls
installAuthInterceptor()
import { useUIStore, type ViewId } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'

/* ── Horizontal strip ────────────────────────────────────────── */

// All six sidebar views live in one physical horizontal strip.
// Navigating between any of them slides the strip — same
// animation everywhere. Sub-views overlay on top.

const STRIP: ViewId[] = ['agents', 'timeline', 'settings']
const FULL_BLEED = new Set<ViewId>(['agents'])
const EDITORIAL = new Set<ViewId>([])

/* ── Strip pane — lazy-mounted, slides horizontally ──────────── */

function StripPane({
  viewId, active, offsetPercent, children,
}: {
  viewId: string
  active: boolean
  offsetPercent: number
  children: ReactNode
}) {
  // Content lazy-mounts on first visit; wrapper div is always in the
  // DOM so it slides from its off-screen position smoothly.
  const [everActive, setEverActive] = useState(active)
  useEffect(() => {
    if (active && !everActive) setEverActive(true)
  }, [active, everActive])

  return (
    <div
      className="absolute inset-0"
      style={{
        transform: `translateX(${offsetPercent}%)`,
        transition: 'transform 300ms ease-out',
        willChange: 'transform',
      }}
    >
      <div className={FULL_BLEED.has(viewId as ViewId) ? 'h-full pb-16 sm:pb-0' : 'max-w-3xl mx-auto px-4 sm:px-8 py-6 sm:py-10 pb-20 sm:pb-10 overflow-y-auto h-full'}>
        {everActive ? children : null}
      </div>
    </div>
  )
}

/* ── Editorial navigation pills ──────────────────────────────── */

const EDITORIAL_NAV: { id: ViewId; label: string; Icon: typeof Brain }[] = []

function EditorialNav({ activeView }: { activeView: ViewId }) {
  const setView = useUIStore(s => s.setView)

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-0.5
      bg-ax-elevated/80 backdrop-blur-sm border border-ax-border-subtle rounded-full px-1 py-0.5
      shadow-sm"
    >
      {EDITORIAL_NAV.map(({ id, label, Icon }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-200
              font-mono text-[10px] uppercase tracking-wider
              ${isActive
                ? 'bg-ax-brand/10 text-ax-brand-primary'
                : 'text-ax-text-ghost hover:text-ax-text-secondary hover:bg-ax-sunken/50'
              }`}
            aria-label={label}
          >
            <Icon size={11} strokeWidth={isActive ? 2.5 : 1.5} />
            <span className={isActive ? 'max-w-20 opacity-100' : 'max-w-0 opacity-0 overflow-hidden'}
              style={{ transition: 'max-width 200ms ease-out, opacity 200ms ease-out' }}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ── View router ─────────────────────────────────────────────── */

const ALLOWED_UNINITIALIZED = new Set<ViewId>(['onboarding', 'settings', 'terminal', 'genesis-progress', 'source', 'deep-search'])

function ViewRouter() {
  const activeView = useUIStore(s => s.activeView)
  const setView = useUIStore(s => s.setView)
  const swipeDir = useUIStore(s => s.viewSwipeDirection)
  const { projects, activeProject } = useProjectStore()

  // Genesis guard disabled — sessions view is always available

  const loading = useProjectStore(s => s.loading)
  const noProjects = !loading && projects.length === 0

  // Strip index tracking
  const stripIdx = STRIP.indexOf(activeView)
  const isStrip = stripIdx >= 0
  const lastIdxRef = useRef(stripIdx >= 0 ? stripIdx : 0)
  if (stripIdx >= 0) lastIdxRef.current = stripIdx
  const currentIdx = isStrip ? stripIdx : lastIdxRef.current

  // Re-fit terminals after slide completes (300ms transition)
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event('terminal-refit')), 320)
    return () => clearTimeout(t)
  }, [currentIdx])

  const isSubView = !isStrip

  // Swipe navigation on mobile
  const swipeContainerRef = useRef<HTMLDivElement>(null)
  useSwipeNavigation(swipeContainerRef)

  // No empty state needed — sessions view always has content from ~/.claude/

  return (
    <div ref={swipeContainerRef} className="relative h-full w-full overflow-hidden">
      {/* One horizontal strip — all views slide the same way */}
      <div className="relative h-full overflow-hidden">
        {EDITORIAL.has(activeView) && <EditorialNav activeView={activeView} />}
        {STRIP.map((viewId, i) => (
          <StripPane
            key={viewId}
            viewId={viewId}
            active={activeView === viewId}
            offsetPercent={(i - currentIdx) * 100}
          >
            {viewId === 'agents' && <SessionsView />}
            {viewId === 'timeline' && <AnalyticsViewPage />}
            {viewId === 'settings' && <SettingsView />}
          </StripPane>
        ))}
      </div>

      {/* Sub-views overlay on top (rollup detail, state, etc.) */}
      {isSubView && (
        <div key={activeView} className={`absolute inset-0 z-10 bg-ax-base ${
          swipeDir === 'right' ? 'animate-slide-right'
          : swipeDir === 'left' ? 'animate-slide-left'
          : 'animate-fade-in'
        }`}>
          <div className={`${activeView === 'onboarding' ? 'max-w-5xl' : 'max-w-3xl'} mx-auto px-4 sm:px-8 py-6 sm:py-10 overflow-y-auto h-full`}>
            {activeView === 'rollup-detail' && <RollupDetailView />}
            {activeView === 'state' && <StateView />}
            {activeView === 'decisions' && <DecisionsView />}
            {activeView === 'onboarding' && <OnboardingView />}
            {activeView === 'genesis-progress' && <GenesisProgressView />}
            {activeView === 'about' && <AboutView />}
            {activeView === 'deep-search' && <DeepSearchView />}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Auth gate for remote connections ──────────────────────────── */

function AuthGate() {
  const [needsAuth, setNeedsAuth] = useState(false)

  useEffect(() => {
    setAuthHandler(() => setNeedsAuth(true))
    return () => setAuthHandler(() => {})
  }, [])

  return (
    <AuthOverlay
      visible={needsAuth}
      onAuthenticated={() => {
        setNeedsAuth(false)
        // Reload data after authenticating
        window.location.reload()
      }}
    />
  )
}

/* ── Error Boundary ─────────────────────────────────────────────── */

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    useErrorStore.getState().showError(error.message, {
      source: 'client',
      detail: info.componentStack?.slice(0, 200) || undefined,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex items-center justify-center bg-ax-base">
          <div className="max-w-sm text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-[var(--ax-error)]/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-[var(--ax-error)] text-xl">!</span>
            </div>
            <h1 className="font-serif italic text-[20px] text-ax-text-primary mb-2">Something went wrong</h1>
            <p className="text-[13px] text-ax-text-tertiary mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
              className="px-4 py-2 bg-ax-brand text-white rounded-lg font-mono text-small hover:bg-ax-brand-hover transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <DataProvider>
        <Shell>
          <ViewRouter />
        </Shell>
        <IntroSplash />
        <PreflightCheck />
        <AuthGate />
        <ErrorToast />
      </DataProvider>
    </ErrorBoundary>
  )
}
