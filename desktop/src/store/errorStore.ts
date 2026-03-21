import { create } from 'zustand'

export interface ErrorEntry {
  id: string
  message: string
  source: 'client' | 'server' | 'network' | 'terminal'
  timestamp: Date
  view?: string
  detail?: string
}

interface ErrorStore {
  /** Currently visible toast (null = hidden) */
  toast: ErrorEntry | null
  /** Error history (last 50) */
  history: ErrorEntry[]
  /** Show an error toast — auto-dismisses after 6s */
  showError: (message: string, opts?: { source?: ErrorEntry['source']; view?: string; detail?: string }) => void
  /** Dismiss the current toast */
  dismissToast: () => void
  /** Clear all history */
  clearHistory: () => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useErrorStore = create<ErrorStore>((set) => ({
  toast: null,
  history: [],

  showError: (message, opts) => {
    const entry: ErrorEntry = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      message,
      source: opts?.source || 'client',
      timestamp: new Date(),
      view: opts?.view,
      detail: opts?.detail,
    }

    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      set({ toast: null })
      toastTimer = null
    }, 20000) // WCAG 2.2.1 — minimum 20s for important content

    set(s => ({
      toast: entry,
      history: [entry, ...s.history].slice(0, 50),
    }))
  },

  dismissToast: () => {
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null }
    set({ toast: null })
  },

  clearHistory: () => set({ history: [] }),
}))

/** Build a pre-filled GitHub issue URL from an error */
export function buildIssueUrl(error: ErrorEntry): string {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'
  const body = [
    '## Bug Report',
    '',
    `**Error:** ${error.message}`,
    error.detail ? `**Detail:** ${error.detail}` : '',
    `**Source:** ${error.source}`,
    error.view ? `**View:** ${error.view}` : '',
    `**Version:** ${version}`,
    `**Platform:** ${navigator.platform}`,
    `**Time:** ${error.timestamp.toISOString()}`,
    '',
    '## Steps to Reproduce',
    '1. ',
    '',
    '## Expected Behavior',
    '',
    '## Additional Context',
  ].filter(Boolean).join('\n')

  const params = new URLSearchParams({
    title: `[Bug] ${error.message.slice(0, 80)}`,
    body,
    labels: 'bug',
  })

  return `https://github.com/AxonEmbodied/AXON/issues/new?${params}`
}
