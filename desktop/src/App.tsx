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
import { TodosView } from '@/views/TodosView'
import { SourceControlView } from '@/views/SourceControlView'
import { AboutView } from '@/views/AboutView'
import { GenesisProgressView } from '@/views/GenesisProgressView'
import { DeepSearchView } from '@/views/DeepSearchView'
import { IntroSplash } from '@/components/shared/IntroSplash'
import { PreflightCheck } from '@/components/shared/PreflightCheck'
import { AuthOverlay } from '@/components/shared/AuthOverlay'
import { setAuthHandler, installAuthInterceptor } from '@/lib/apiClient'

// Install global fetch interceptor ONCE — injects auth headers on all /api/axon/* calls
installAuthInterceptor()
import { useUIStore, type ViewId } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'

/* ── Horizontal strip ────────────────────────────────────────── */

// All six sidebar views live in one physical horizontal strip.
// Navigating between any of them slides the strip — same
// animation everywhere. Sub-views overlay on top.

const STRIP: ViewId[] = ['morning', 'agents', 'timeline', 'source', 'todos', 'terminal', 'settings']
const FULL_BLEED = new Set<ViewId>(['agents', 'terminal'])
const EDITORIAL = new Set<ViewId>(['morning', 'agents', 'timeline'])

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
      }}
    >
      <div className={FULL_BLEED.has(viewId as ViewId) ? 'h-full' : 'max-w-3xl mx-auto px-8 py-10 overflow-y-auto h-full'}>
        {everActive ? children : null}
      </div>
    </div>
  )
}

/* ── Editorial navigation pills ──────────────────────────────── */

const EDITORIAL_NAV = [
  { id: 'morning' as ViewId, label: 'Morning', Icon: Coffee },
  { id: 'agents' as ViewId, label: 'Agents', Icon: Brain },
  { id: 'timeline' as ViewId, label: 'Timeline', Icon: Clock },
]

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

  // Genesis guard: redirect based on project initialization state
  useEffect(() => {
    if (!activeProject) return
    const proj = projects.find(p => p.name === activeProject)
    if (proj && proj.episodeCount === 0 && !ALLOWED_UNINITIALIZED.has(activeView)) {
      if (proj.genesisStatus === 'running') {
        setView('genesis-progress')
      } else {
        setView('onboarding')
      }
    }
  }, [activeProject, activeView, projects, setView])

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

  // Empty state: no projects after loading completes
  if (noProjects && activeView !== 'settings' && activeView !== 'onboarding') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-sm mx-auto px-6">
          <h2 className="font-serif italic text-h2 text-ax-text-primary mb-2">Welcome to Axon</h2>
          <p className="text-body text-ax-text-secondary mb-6">
            Add your first project to get started with nightly rollups, morning briefings, and decision traces.
          </p>
          <button
            onClick={() => setView('onboarding')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg
              bg-ax-brand text-white font-mono text-small
              hover:bg-ax-brand-hover transition-colors"
          >
            <Plus size={14} />
            Add your first project
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
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
            {viewId === 'morning' && <MorningView />}
            {viewId === 'agents' && <SessionsView />}
            {viewId === 'timeline' && <TimelineView />}
            {viewId === 'source' && <SourceControlView />}
            {viewId === 'todos' && <TodosView />}
            {viewId === 'terminal' && <AgentView />}
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
          <div className={`${activeView === 'onboarding' ? 'max-w-5xl' : 'max-w-3xl'} mx-auto px-8 py-10 overflow-y-auto h-full`}>
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

export default function App() {
  return (
    <DataProvider>
      <Shell>
        <ViewRouter />
      </Shell>
      <IntroSplash />
      <PreflightCheck />
      <AuthGate />
    </DataProvider>
  )
}
