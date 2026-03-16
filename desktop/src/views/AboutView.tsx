import { useState, useEffect } from 'react'
import { ExternalLink, Globe, ArrowLeft } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

type Tab = 'github' | 'website'

const REPO_URL = 'https://github.com/AxonEmbodied/AXON'
const WEBSITE_URL = 'https://robertmaye.co.uk'

function GitHubIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  )
}

function useReadme() {
  const [readme, setReadme] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('https://api.github.com/repos/AxonEmbodied/AXON/readme', {
      headers: { Accept: 'application/vnd.github.v3.html' },
    })
      .then(r => r.ok ? r.text() : null)
      .then(html => { setReadme(html); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return { readme, loading }
}

function GitHubTab() {
  const { readme, loading } = useReadme()

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Repo card */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 rounded-xl bg-ax-sunken text-ax-text-primary">
            <GitHubIcon size={28} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-mono text-body text-ax-text-primary font-medium">AxonEmbodied/AXON</h3>
            <p className="text-small text-ax-text-tertiary mt-0.5">Developer memory system — nightly AI rollups, morning briefings, decision traces</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-mono text-micro px-4 py-2 rounded-lg bg-[#24292f] text-white hover:opacity-90 transition-opacity"
          >
            <GitHubIcon size={14} />
            View on GitHub
            <ExternalLink size={11} />
          </a>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-mono text-micro px-4 py-2 rounded-lg border border-ax-border text-ax-text-secondary hover:bg-ax-sunken transition-colors"
          >
            Issues
            <ExternalLink size={11} />
          </a>
          <a
            href={`${REPO_URL}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-mono text-micro px-4 py-2 rounded-lg border border-ax-border text-ax-text-secondary hover:bg-ax-sunken transition-colors"
          >
            Releases
            <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* README */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border overflow-hidden">
        <div className="px-5 py-3 border-b border-ax-border-subtle flex items-center gap-2">
          <span className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary">README.md</span>
        </div>
        <div className="px-6 py-5">
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-6 bg-ax-sunken rounded w-2/3" />
              <div className="h-4 bg-ax-sunken rounded w-full" />
              <div className="h-4 bg-ax-sunken rounded w-5/6" />
              <div className="h-4 bg-ax-sunken rounded w-3/4" />
            </div>
          ) : readme ? (
            <div
              className="readme-prose"
              dangerouslySetInnerHTML={{ __html: readme }}
            />
          ) : (
            <p className="text-small text-ax-text-tertiary italic">Could not load README. <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-ax-brand hover:underline">View on GitHub</a></p>
          )}
        </div>
      </div>
    </div>
  )
}

function WebsiteTab() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Author card */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-3 rounded-xl bg-ax-sunken text-ax-brand">
            <Globe size={28} strokeWidth={1.5} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-serif italic text-h3 text-ax-text-primary">Robert Maye</h3>
            <p className="text-small text-ax-text-tertiary mt-0.5">Creator of Axon</p>
          </div>
        </div>
        <a
          href={WEBSITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-mono text-micro px-4 py-2 rounded-lg bg-ax-brand text-white hover:opacity-90 transition-opacity"
        >
          <Globe size={14} />
          robertmaye.co.uk
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Embedded website preview */}
      <div className="bg-ax-elevated rounded-xl border border-ax-border overflow-hidden">
        <div className="px-5 py-3 border-b border-ax-border-subtle flex items-center justify-between">
          <span className="font-mono text-micro uppercase tracking-widest text-ax-text-tertiary">Preview</span>
          <a
            href={WEBSITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-micro text-ax-text-tertiary hover:text-ax-brand transition-colors"
          >
            Open in browser <ExternalLink size={10} />
          </a>
        </div>
        <div className="overflow-hidden" style={{ height: '500px' }}>
          <iframe
            src={WEBSITE_URL}
            title="Robert Maye's website"
            className="border-0 origin-top-left"
            style={{
              width: '166.67%',
              height: '833px',
              transform: 'scale(0.6)',
            }}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

export function AboutView() {
  const [tab, setTab] = useState<Tab>('github')
  const goBack = useUIStore(s => s.goBack)

  return (
    <div>
      {/* Back button */}
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-small text-ax-text-tertiary hover:text-ax-text-secondary transition-colors mb-4"
      >
        <ArrowLeft size={14} />
        Back
      </button>

      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <img src="/branding/axon-mark-light.png" alt="" className="w-8 h-8 rounded [filter:invert(0.2)_sepia(1)_saturate(2)_hue-rotate(350deg)]" />
          <h1 className="font-serif italic text-display text-ax-text-primary tracking-tight">
            Axon
          </h1>
        </div>
        <p className="text-body text-ax-text-secondary">
          Developer memory system — protocol over platform
        </p>
      </header>

      {/* Tab switcher */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={() => setTab('github')}
          className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl font-mono text-small transition-all duration-200
            ${tab === 'github'
              ? 'bg-ax-elevated border-2 border-ax-text-primary text-ax-text-primary shadow-md'
              : 'bg-ax-elevated border border-ax-border text-ax-text-secondary hover:bg-ax-sunken'
            }`}
        >
          <GitHubIcon size={18} />
          GitHub
        </button>
        <button
          onClick={() => setTab('website')}
          className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl font-mono text-small transition-all duration-200
            ${tab === 'website'
              ? 'bg-ax-brand text-white shadow-md'
              : 'bg-ax-elevated border border-ax-border text-ax-text-secondary hover:bg-ax-sunken'
            }`}
        >
          <Globe size={18} strokeWidth={1.5} />
          Website
        </button>
      </div>

      {/* Tab content */}
      {tab === 'github' ? <GitHubTab /> : <WebsiteTab />}
    </div>
  )
}
