import { useState, useEffect, useRef, useCallback } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'
import { useBackend } from '@/providers/DataProvider'
import { useDebugStore } from '@/store/debugStore'
import { Folder, GitBranch, Zap, ArrowRight, ArrowLeft, Check, Search, Globe, HardDrive } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────

interface DiscoveredRepo {
  name: string
  path: string
  remote: string
  commitCount: number
  lastActivity: string
}

interface ContextStatus {
  initialized: boolean
  remote: string
  commitCount: number
  lastCommit: string
}

type OnboardingStep = 'select-repo' | 'axon-context' | 'user-context' | 'genesis' | 'review'

type GenesisPhase = 'reading' | 'scanning' | 'analyzing' | 'composing' | 'done'

const GENESIS_PHASES: Record<GenesisPhase, { label: string; detail: string }> = {
  reading: { label: 'Reading project', detail: 'Scanning directory structure and documentation...' },
  scanning: { label: 'Scanning history', detail: 'Walking through commit history and branches...' },
  analyzing: { label: 'Analyzing architecture', detail: 'Identifying key modules, patterns, and decisions...' },
  composing: { label: 'Composing genesis', detail: 'Writing your project\'s origin story...' },
  done: { label: 'Genesis complete', detail: 'Your project memory has been initialized.' },
}

// ─── Main View ──────────────────────────────────────────────────

export function OnboardingView() {
  const [step, setStep] = useState<OnboardingStep>('select-repo')
  const [selectedRepo, setSelectedRepo] = useState<DiscoveredRepo | null>(null)
  const [userContext, setUserContext] = useState('')
  const [genesisContent, setGenesisContent] = useState('')
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const { projects, activeProject } = useProjectStore()

  const goTo = useCallback((next: OnboardingStep, dir: 'forward' | 'back' = 'forward') => {
    setDirection(dir)
    setStep(next)
  }, [])

  // Resume genesis for existing project that hasn't completed it
  const resumeChecked = useRef(false)
  useEffect(() => {
    if (resumeChecked.current) return
    if (!activeProject) return
    const proj = projects.find(p => p.name === activeProject)
    if (proj && proj.episodeCount === 0 && proj.path) {
      resumeChecked.current = true
      // Project exists but genesis never completed — skip to genesis step
      setSelectedRepo({
        name: proj.name,
        path: proj.path,
        remote: '',
        commitCount: 0,
        lastActivity: '',
      })
      setStep('genesis')
    }
  }, [activeProject, projects])

  return (
    <div className="animate-fade-in-up">
      {/* Header */}
      <header className="mb-8">
        <p className="font-serif italic text-body text-ax-text-tertiary mb-1">New project</p>
        <h1 className="font-serif text-h1 text-ax-text-primary">
          {step === 'select-repo' && 'Choose a repository'}
          {step === 'axon-context' && 'Knowledge versioning'}
          {step === 'user-context' && 'Your role'}
          {step === 'genesis' && 'Genesis'}
          {step === 'review' && 'Your project, remembered'}
        </h1>
      </header>

      {/* Progress */}
      <StepIndicator current={step} />

      {/* Steps — keyed for transitions */}
      <div
        key={step}
        className={direction === 'forward' ? 'animate-step-forward' : 'animate-step-back'}
      >
        {step === 'select-repo' && (
          <RepoSelector
            onSelect={(repo) => {
              setSelectedRepo(repo)
              goTo('axon-context', 'forward')
            }}
          />
        )}
        {step === 'axon-context' && selectedRepo && (
          <AxonContextSetup
            repo={selectedRepo}
            onContinue={() => goTo('user-context', 'forward')}
            onBack={() => goTo('select-repo', 'back')}
          />
        )}
        {step === 'user-context' && selectedRepo && (
          <UserContextStep
            onContinue={(ctx) => {
              setUserContext(ctx)
              goTo('genesis', 'forward')
            }}
            onBack={() => goTo('axon-context', 'back')}
          />
        )}
        {step === 'genesis' && selectedRepo && (
          <GenesisProgress
            repo={selectedRepo}
            userContext={userContext}
            onComplete={(content) => {
              setGenesisContent(content)
              goTo('review', 'forward')
            }}
          />
        )}
        {step === 'review' && selectedRepo && (
          <GenesisReview
            repo={selectedRepo}
            content={genesisContent}
          />
        )}
      </div>
    </div>
  )
}

// ─── Step Indicator ─────────────────────────────────────────────

const STEPS: { id: OnboardingStep; label: string; num: number }[] = [
  { id: 'select-repo', label: 'Repository', num: 1 },
  { id: 'axon-context', label: 'Context', num: 2 },
  { id: 'user-context', label: 'Role', num: 3 },
  { id: 'genesis', label: 'Genesis', num: 4 },
  { id: 'review', label: 'Review', num: 5 },
]

function StepIndicator({ current }: { current: OnboardingStep }) {
  const currentIdx = STEPS.findIndex(s => s.id === current)

  return (
    <div className="flex items-center justify-between mb-10">
      {STEPS.map((s, i) => {
        const isComplete = i < currentIdx
        const isCurrent = i === currentIdx

        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            {/* Step node */}
            <div className="flex items-center gap-2 shrink-0">
              <div className={`
                relative w-6 h-6 rounded-full flex items-center justify-center
                transition-all duration-400 ease-out
                ${isComplete
                  ? 'bg-ax-accent text-white scale-90'
                  : isCurrent
                    ? 'bg-ax-brand text-white scale-110 shadow-[0_0_0_4px_rgba(200,149,108,0.15)]'
                    : 'bg-ax-sunken text-ax-text-ghost'
                }
              `}>
                {isComplete ? (
                  <Check size={10} strokeWidth={2.5} />
                ) : (
                  <span className="font-mono text-[10px] font-medium">{s.num}</span>
                )}
                {isCurrent && (
                  <div className="absolute inset-0 rounded-full animate-ping-slow bg-ax-brand/20" />
                )}
              </div>
              <span className={`
                font-mono text-micro transition-all duration-300
                ${isComplete
                  ? 'text-ax-accent font-medium'
                  : isCurrent
                    ? 'text-ax-text-primary font-medium'
                    : 'text-ax-text-ghost'
                }
              `}>
                {s.label}
              </span>
            </div>
            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div className="flex-1 mx-3 h-[2px] rounded-full overflow-hidden bg-ax-sunken min-w-4">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out ${
                    i < currentIdx ? 'w-full bg-ax-accent' : 'w-0 bg-ax-brand'
                  }`}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 1: Repo Selector ──────────────────────────────────────

function RepoSelector({ onSelect }: { onSelect: (repo: DiscoveredRepo) => void }) {
  const [repos, setRepos] = useState<DiscoveredRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [customPath, setCustomPath] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [simulateEmpty, setSimulateEmpty] = useState(false)
  const register = useDebugStore((s) => s.register)
  const unregister = useDebugStore((s) => s.unregister)

  // Register debug action for this view
  useEffect(() => {
    register({
      id: 'onboarding:empty-repos',
      label: 'Simulate empty repos',
      active: simulateEmpty,
      toggle: () => setSimulateEmpty(v => !v),
    })
    return () => unregister('onboarding:empty-repos')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulateEmpty])

  useEffect(() => {
    fetch('/api/axon/discover-repos')
      .then(r => r.json())
      .then((data: DiscoveredRepo[]) => {
        setRepos(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const visibleRepos = simulateEmpty ? [] : repos
  const filtered = visibleRepos.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.path.toLowerCase().includes(search.toLowerCase())
  )

  const handleCustomPath = () => {
    if (!customPath.trim()) return
    onSelect({
      name: customPath.split('/').pop() || customPath,
      path: customPath.trim(),
      remote: '',
      commitCount: 0,
      lastActivity: '',
    })
  }

  return (
    <div className="space-y-6">
      <p className="text-body text-ax-text-secondary leading-relaxed">
        Select a Git repository to track. Axon will read its commit history, file structure, and documentation to build your project memory.
      </p>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ax-text-ghost" />
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-ax-elevated border border-ax-border
            text-body text-ax-text-primary placeholder:text-ax-text-ghost
            focus:outline-none focus:border-ax-brand focus:ring-1 focus:ring-ax-brand/20
            transition-colors"
        />
      </div>

      {/* Repo list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="thinking-dot w-2 h-2 rounded-full bg-ax-brand" />
              ))}
            </div>
            <span className="ml-3 text-small text-ax-text-tertiary">Discovering repositories...</span>
          </div>
        ) : filtered.length === 0 && search ? (
          <div className="text-center py-12 text-ax-text-tertiary">
            <Search size={32} className="mx-auto mb-3 opacity-40" />
            <p className="text-body">No matches for &ldquo;{search}&rdquo;</p>
            <p className="text-small mt-1">Try a different search or enter a path manually below</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 px-6">
            <div className="text-center mb-6">
              <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-ax-brand/10 flex items-center justify-center">
                <GitBranch size={24} className="text-ax-brand" />
              </div>
              <h3 className="font-serif italic text-h3 text-ax-text-primary mb-2">No Git repositories found</h3>
              <p className="text-body text-ax-text-secondary leading-relaxed max-w-md mx-auto">
                Axon builds memory from your Git history — commits, branches, and file changes become the raw signal for nightly rollups and morning briefings.
              </p>
            </div>
            <div className="bg-ax-sunken rounded-xl border border-ax-border-subtle p-5 space-y-3 max-w-md mx-auto">
              <p className="text-small text-ax-text-secondary font-medium">To get started you need:</p>
              <ul className="space-y-2 text-small text-ax-text-tertiary">
                <li className="flex items-start gap-2">
                  <span className="text-ax-brand mt-0.5">1.</span>
                  <span>A project folder with <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">git init</code> already run</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ax-brand mt-0.5">2.</span>
                  <span>At least one commit — Axon reads your commit messages to understand what changed</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-ax-brand mt-0.5">3.</span>
                  <span>The repo in one of: <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">~/Github</code>, <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">~/Projects</code>, <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">~/Developer</code>, <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">~/Code</code>, or enter a custom path below</span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          filtered.map((repo, idx) => (
            <button
              key={repo.path}
              onClick={() => onSelect(repo)}
              style={{ animationDelay: `${idx * 30}ms` }}
              className="w-full text-left p-4 rounded-xl bg-ax-elevated border border-ax-border
                hover:border-ax-brand hover:shadow-[0_4px_20px_rgba(var(--ax-shadow-color),0.08)]
                transition-all duration-200 group relative
                focus:outline-none focus-visible:ring-2 focus-visible:ring-ax-brand
                animate-fade-in-up"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <GitBranch size={14} className="text-ax-brand shrink-0" />
                    <span className="font-mono text-body text-ax-text-primary font-medium truncate">
                      {repo.name}
                    </span>
                  </div>
                  <p className="font-mono text-micro text-ax-text-tertiary truncate">{repo.path}</p>
                  {repo.remote && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <Globe size={11} className="text-ax-text-ghost shrink-0" />
                      <span className="font-mono text-micro text-ax-text-ghost truncate">{repo.remote}</span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="font-mono text-small text-ax-text-secondary">
                    {repo.commitCount.toLocaleString()} commits
                  </p>
                  {repo.lastActivity && (
                    <p className="font-mono text-micro text-ax-text-ghost mt-0.5">
                      {repo.lastActivity.split(' ')[0]}
                    </p>
                  )}
                </div>
              </div>
              <ArrowRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-ax-brand opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))
        )}
      </div>

      {/* Custom path */}
      <div className="border-t border-ax-border-subtle pt-4">
        {showCustom ? (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="/path/to/your/repo"
              value={customPath}
              onChange={e => setCustomPath(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCustomPath()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-ax-elevated border border-ax-border
                font-mono text-small text-ax-text-primary placeholder:text-ax-text-ghost
                focus:outline-none focus:border-ax-brand"
              autoFocus
            />
            <button
              onClick={handleCustomPath}
              className="px-4 py-2.5 rounded-lg bg-ax-brand text-white text-small font-medium
                hover:bg-ax-brand-hover transition-colors"
            >
              Use this path
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCustom(true)}
            className="text-small text-ax-text-tertiary hover:text-ax-brand transition-colors"
          >
            Or enter a path manually...
          </button>
        )}
      </div>

    </div>
  )
}

// ─── Step 2: Axon Context Setup ─────────────────────────────────

function AxonContextSetup({ repo, onContinue, onBack }: {
  repo: DiscoveredRepo
  onContinue: () => void
  onBack: () => void
}) {
  const [status, setStatus] = useState<ContextStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Derive the workspace path from repo name (matches axon-init behavior)
  const workspacePath = `~/.axon/workspaces/${repo.name}/`

  useEffect(() => {
    fetch('/api/axon/context-status')
      .then(r => r.json())
      .then((data: ContextStatus) => {
        setStatus(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="thinking-dot w-2 h-2 rounded-full bg-ax-brand" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Philosophy intro */}
      <p className="text-body text-ax-text-secondary leading-relaxed max-w-2xl">
        Axon tracks your <strong className="text-ax-text-primary">code</strong> and your <strong className="text-ax-text-primary">tacit knowledge</strong> about that code. They live in different places — and the AI reads both.
      </p>

      {/* Two concepts — always side by side */}
      <div className="grid grid-cols-2 gap-5">
        {/* Code repo card */}
        <div className="p-5 rounded-xl bg-ax-elevated border border-ax-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-ax-info-subtle flex items-center justify-center">
              <GitBranch size={16} className="text-ax-info" />
            </div>
            <div>
              <h3 className="text-body font-medium text-ax-text-primary">Code Repository</h3>
              <p className="text-micro text-ax-text-tertiary">Source code — read only</p>
            </div>
          </div>
          <div className="font-mono text-micro text-ax-text-secondary bg-ax-sunken rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive size={11} className="text-ax-text-ghost shrink-0" />
              <span className="break-all">{repo.path}</span>
            </div>
            {repo.remote && (
              <div className="flex items-center gap-2 min-w-0">
                <Globe size={11} className="text-ax-text-ghost shrink-0" />
                <span className="break-all">{repo.remote}</span>
              </div>
            )}
          </div>
          <p className="text-small text-ax-text-tertiary mt-3 leading-relaxed">
            Axon reads commits, file structure, and docs. It <strong className="text-ax-text-secondary">never writes</strong> to your codebase.
          </p>
        </div>

        {/* Axon context card — visually distinct */}
        <div className="p-5 rounded-xl bg-ax-elevated border-2 border-ax-brand/30 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-ax-brand-subtle/40 to-transparent pointer-events-none" />
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-ax-brand-subtle flex items-center justify-center">
                <Zap size={16} className="text-ax-brand" />
              </div>
              <div>
                <h3 className="text-body font-medium text-ax-text-primary">Axon Memory</h3>
                <p className="text-micro text-ax-text-tertiary">Tacit knowledge — versioned separately</p>
              </div>
            </div>
            <div className="font-mono text-micro text-ax-text-secondary bg-ax-sunken rounded-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-2 min-w-0">
                <Folder size={11} className="text-ax-brand shrink-0" />
                <span className="break-all">{workspacePath}</span>
              </div>
              {status?.remote ? (
                <div className="flex items-center gap-2 min-w-0">
                  <Globe size={11} className="text-ax-accent shrink-0" />
                  <span className="break-all">{status.remote}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Globe size={11} className="text-ax-text-ghost shrink-0" />
                  <span className="text-ax-text-ghost italic">No remote</span>
                </div>
              )}
            </div>
            <p className="text-small text-ax-text-tertiary mt-3 leading-relaxed">
              Rollups, decisions, and state <strong className="text-ax-text-secondary">auto-commit</strong> here nightly. Your progressive knowledge tree.
            </p>
            <div className="flex items-center gap-4 mt-2 font-mono text-micro text-ax-text-ghost">
              {status?.initialized ? (
                <>
                  <span className="flex items-center gap-1"><Check size={10} className="text-ax-accent" /> Git initialized</span>
                  <span>{status.commitCount} commits</span>
                </>
              ) : (
                <span className="text-ax-warning">Git not initialized — set up during genesis</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context tip — compact */}
      <div className="px-4 py-3 rounded-lg bg-ax-sunken border border-ax-border-subtle">
        <p className="text-small text-ax-text-tertiary leading-relaxed">
          <strong className="text-ax-text-secondary">Context matters.</strong> Genesis and morning briefings can read your source files directly. Nightly rollups synthesize from commit messages, file changes, and notes — so the richer your commits and any <code className="font-mono text-micro bg-ax-elevated px-1 py-0.5 rounded">references/</code> docs, the sharper the output. Quality also varies by model.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-small text-ax-text-tertiary hover:text-ax-brand transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={onContinue}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-ax-brand text-white font-medium
            hover:bg-ax-brand-hover transition-all duration-200
            shadow-[0_2px_8px_rgba(var(--ax-shadow-color),0.15)]
            hover:shadow-[0_4px_16px_rgba(var(--ax-shadow-color),0.2)]
            hover:-translate-y-0.5"
        >
          Continue
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: User Context ──────────────────────────────────────

function UserContextStep({ onContinue, onBack }: {
  onContinue: (context: string) => void
  onBack: () => void
}) {
  const [context, setContext] = useState('')

  return (
    <div className="space-y-6">
      <p className="text-body text-ax-text-secondary leading-relaxed max-w-2xl">
        Help Axon understand <strong className="text-ax-text-primary">who you are</strong> in relation to this project. This shapes how rollups, briefings, and recommendations are tailored to you.
      </p>

      <div className="space-y-3">
        <label className="text-small font-medium text-ax-text-primary">
          What's your relationship to this project? What are you trying to get out of it?
        </label>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          placeholder="e.g. I'm the lead developer pushing this project forward, focused on shipping the desktop app and CLI tools.

Or: I only work on the analytics module — I don't need context about the frontend.

Or: I'm the CEO reviewing high-level progress and making strategic decisions."
          className="w-full h-36 px-4 py-3 rounded-xl bg-ax-elevated border border-ax-border
            text-body text-ax-text-primary placeholder:text-ax-text-ghost leading-relaxed
            focus:outline-none focus:border-ax-brand focus:ring-1 focus:ring-ax-brand/20
            transition-colors resize-none"
        />
      </div>

      <div className="px-4 py-3 rounded-lg bg-ax-sunken border border-ax-border-subtle">
        <p className="text-small text-ax-text-tertiary leading-relaxed">
          <strong className="text-ax-text-secondary">Optional.</strong> If you skip this, Axon assumes you're a full contributor and will cover the entire project equally. You can always change this later in Settings.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-small text-ax-text-tertiary hover:text-ax-brand transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <button
          onClick={() => onContinue(context)}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-ax-brand text-white font-medium
            hover:bg-ax-brand-hover transition-all duration-200
            shadow-[0_2px_8px_rgba(var(--ax-shadow-color),0.15)]
            hover:shadow-[0_4px_16px_rgba(var(--ax-shadow-color),0.2)]
            hover:-translate-y-0.5"
        >
          {context.trim() ? 'Begin Genesis' : 'Skip & Begin Genesis'}
          <Zap size={16} />
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: Genesis Progress ───────────────────────────────────

function GenesisProgress({ repo, userContext, onComplete }: {
  repo: DiscoveredRepo
  userContext?: string
  onComplete: (content: string) => void
}) {
  const [phase, setPhase] = useState<GenesisPhase>('reading')
  const [logs, setLogs] = useState<string[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const contentRef = useRef('')
  const startTime = useRef(Date.now())
  const logEndRef = useRef<HTMLDivElement>(null)

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Phase progression based on elapsed time (fallback if no progress events)
  useEffect(() => {
    if (phase === 'done') return
    const phaseTimers = [
      { at: 3, phase: 'scanning' as GenesisPhase },
      { at: 8, phase: 'analyzing' as GenesisPhase },
      { at: 20, phase: 'composing' as GenesisPhase },
    ]
    const timer = phaseTimers.find(t => t.at === elapsed)
    if (timer) setPhase(timer.phase)
  }, [elapsed, phase])

  // Start genesis
  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const res = await fetch('/api/axon/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: repo.name,
            projectPath: repo.path,
            ...(userContext ? { userContext } : {}),
          }),
        })

        const reader = res.body?.getReader()
        if (!reader) { setError('No response stream'); return }

        const decoder = new TextDecoder()
        let sseBuffer = ''

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break

          sseBuffer += decoder.decode(value, { stream: true })
          const lines = sseBuffer.split('\n')
          sseBuffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6))
              if (event.type === 'progress') {
                const text = event.text.trim()
                if (text) {
                  setLogs(prev => [...prev, text])
                  // Detect phases from output
                  if (text.includes('Reading project')) setPhase('reading')
                  else if (text.includes('Git:') || text.includes('commits')) setPhase('scanning')
                  else if (text.includes('Generating genesis') || text.includes('genesis rollup')) setPhase('composing')
                }
              } else if (event.type === 'content') {
                contentRef.current += event.text
              } else if (event.type === 'done') {
                if (event.code !== 0) {
                  setError(`Genesis failed (exit code ${event.code}). The project may already be initialized.`)
                } else {
                  setPhase('done')
                  // Small delay for the animation to feel right
                  setTimeout(() => {
                    if (!cancelled) onComplete(contentRef.current)
                  }, 1500)
                }
              } else if (event.type === 'error') {
                setError(event.message)
              }
            } catch {}
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Genesis failed')
      }
    }

    run()
    return () => { cancelled = true }
  }, [repo, onComplete])

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const phaseIdx = ['reading', 'scanning', 'analyzing', 'composing', 'done'].indexOf(phase)
  const config = GENESIS_PHASES[phase]

  return (
    <div className="space-y-8">
      {/* Phase indicator */}
      <div className="p-6 rounded-xl bg-ax-elevated border border-ax-border">
        {/* Animated dots */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-1.5">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className={`thinking-dot w-2 h-2 rounded-full ${
                phase === 'done' ? 'bg-ax-accent' : 'bg-ax-brand'
              }`} />
            ))}
          </div>
          <span className="font-mono text-micro text-ax-text-ghost">
            {elapsed}s
          </span>
        </div>

        {/* Phase label */}
        <h3 className="font-serif text-h3 text-ax-text-primary mb-1">
          {config.label}
        </h3>
        <p className="text-small text-ax-text-secondary">
          {config.detail}
        </p>

        {/* Progress bar */}
        <div className="flex gap-1 mt-4">
          {['reading', 'scanning', 'analyzing', 'composing', 'done'].map((p, i) => (
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
              {i === phaseIdx && phase !== 'done' && (
                <div className="absolute inset-0 bg-ax-brand thinking-progress-bar rounded-full" />
              )}
              {i === phaseIdx && phase === 'done' && (
                <div className="absolute inset-0 bg-ax-accent rounded-full" />
              )}
            </div>
          ))}
        </div>

        {/* Project context pill */}
        <div className="flex items-center gap-2 mt-3">
          <span className="font-mono text-micro text-ax-text-tertiary bg-ax-sunken px-2 py-0.5 rounded-full">
            {repo.name}
          </span>
          {phase === 'composing' && elapsed > 25 && (
            <span className="text-micro text-ax-text-ghost animate-fade-in">
              Building your project's origin story...
            </span>
          )}
        </div>
      </div>

      {/* Live log */}
      <div className="rounded-xl bg-ax-sunken border border-ax-border-subtle overflow-hidden">
        <div className="px-4 py-2 border-b border-ax-border-subtle flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${phase === 'done' ? 'bg-ax-accent' : 'bg-ax-brand animate-pulse'}`} />
          <span className="font-mono text-micro text-ax-text-tertiary">genesis log</span>
        </div>
        <div className="p-4 max-h-48 overflow-y-auto font-mono text-micro text-ax-text-secondary leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-ax-text-ghost">Initializing...</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="animate-fade-in">{log}</div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-ax-error-subtle border border-ax-error/20 text-body text-ax-error">
          {error}
        </div>
      )}
    </div>
  )
}

// ─── Step 4: Genesis Review ─────────────────────────────────────

function GenesisReview({ repo, content }: {
  repo: DiscoveredRepo
  content: string
}) {
  const setView = useUIStore(s => s.setView)
  const setProjects = useProjectStore(s => s.setProjects)
  const setActiveProject = useProjectStore(s => s.setActiveProject)
  const backend = useBackend()

  const handleContinue = useCallback(async () => {
    // Refresh project list to pick up the new project
    try {
      const projects = await backend.getProjects()
      setProjects(projects)
      setActiveProject(repo.name)
    } catch {}
    setView('timeline')
  }, [backend, setProjects, setActiveProject, repo.name, setView])

  return (
    <div className="space-y-8">
      {/* Success banner */}
      <div className="p-6 rounded-xl bg-ax-accent-subtle border border-ax-accent/20">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-full bg-ax-accent/20 flex items-center justify-center">
            <Check size={16} className="text-ax-accent" />
          </div>
          <h3 className="font-serif text-h3 text-ax-text-primary">Genesis complete</h3>
        </div>
        <p className="text-body text-ax-text-secondary ml-11">
          Axon has analyzed <strong className="text-ax-text-primary">{repo.name}</strong> and created your project's origin story. This is the foundation your daily rollups will build on.
        </p>
      </div>

      {/* Genesis content */}
      <div className="rounded-xl bg-ax-elevated border border-ax-border overflow-hidden">
        <div className="px-5 py-3 border-b border-ax-border-subtle flex items-center gap-2">
          <Zap size={14} className="text-ax-brand" />
          <span className="font-mono text-small text-ax-text-tertiary">0000_genesis.md</span>
        </div>
        <div className="p-6 max-h-[500px] overflow-y-auto">
          <div className="text-body text-ax-text-secondary leading-relaxed whitespace-pre-wrap">
            {content || 'Genesis content loading...'}
          </div>
        </div>
      </div>

      {/* What happens next */}
      <div className="p-5 rounded-xl bg-ax-sunken border border-ax-border-subtle">
        <h4 className="text-body font-medium text-ax-text-primary mb-3">What happens next</h4>
        <div className="space-y-2 text-small text-ax-text-secondary">
          <div className="flex items-start gap-2">
            <span className="text-ax-brand mt-0.5">1.</span>
            <span><strong>Tonight at 2am</strong>, Axon will collect dendrites (git commits, file changes) and produce your first nightly rollup.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-ax-brand mt-0.5">2.</span>
            <span><strong>Tomorrow morning</strong>, visit the Morning view for a conversational briefing about your project.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-ax-brand mt-0.5">3.</span>
            <span><strong>Over time</strong>, Axon builds a progressive knowledge tree — decisions, patterns, and context that compounds daily.</span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex justify-end pt-2">
        <button
          onClick={handleContinue}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-ax-brand text-white font-medium
            hover:bg-ax-brand-hover transition-all duration-200
            shadow-[0_2px_8px_rgba(var(--ax-shadow-color),0.15)]
            hover:shadow-[0_4px_16px_rgba(var(--ax-shadow-color),0.2)]
            hover:-translate-y-0.5"
        >
          Go to Timeline
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
