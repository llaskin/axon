import { create } from 'zustand'
import type { Project } from '@/lib/types'

interface ProjectStore {
  projects: Project[]
  activeProject: string | null
  loading: boolean
  error: string | null
  setProjects: (projects: Project[]) => void
  setActiveProject: (name: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeProject: null,
  loading: true,
  error: null,
  setProjects: (projects) => set({ projects, loading: false, error: null }),
  setActiveProject: (name) => set({ activeProject: name }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
}))
