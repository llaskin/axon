import { create } from 'zustand'
import type { DiscoveredRepo } from '@/lib/types'
import { useProjectStore } from './projectStore'
import { useUIStore } from './uiStore'

interface DiscoveryStore {
  repos: DiscoveredRepo[]
  loading: boolean
  initializing: Set<string>
  fetchRepos: () => Promise<void>
  initRepo: (repo: DiscoveredRepo) => Promise<void>
}

export const useDiscoveryStore = create<DiscoveryStore>((set, get) => ({
  repos: [],
  loading: false,
  initializing: new Set(),

  fetchRepos: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/axon/discover-repos')
      if (!res.ok) throw new Error('Failed to discover repos')
      const all: DiscoveredRepo[] = await res.json()

      // Filter out repos that match any existing project by path or name
      const projects = useProjectStore.getState().projects
      const filtered = all.filter(r =>
        !projects.some(p => p.path === r.path || p.name === r.name)
      )

      set({ repos: filtered, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  initRepo: async (repo) => {
    // Guard against concurrent init for the same repo
    const { initializing } = get()
    if (initializing.has(repo.path)) return
    set({ initializing: new Set([...initializing, repo.path]) })

    try {
      const res = await fetch('/api/axon/init-quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: repo.name, projectPath: repo.path }),
      })
      if (!res.ok) throw new Error('Init failed')

      // Remove from discovered list immediately
      set({ repos: get().repos.filter(r => r.path !== repo.path) })

      // Refresh project list so it appears in sidebar
      const projRes = await fetch('/api/axon/projects')
      if (projRes.ok) {
        const projects = await projRes.json()
        useProjectStore.getState().setProjects(projects)
        useProjectStore.getState().setActiveProject(repo.name)
        // Navigate to genesis progress view (not onboarding)
        useUIStore.getState().setView('genesis-progress')
      }
    } catch (e) {
      console.error('Failed to init repo:', e)
    } finally {
      const updated = new Set(get().initializing)
      updated.delete(repo.path)
      set({ initializing: updated })
    }
  },
}))
