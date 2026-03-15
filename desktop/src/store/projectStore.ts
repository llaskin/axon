import { create } from 'zustand'
import type { Project } from '@/lib/types'

const ORDER_KEY = 'axon-project-order'
function loadOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]') } catch { return [] }
}
function saveOrder(order: string[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order))
}

/** Sort projects by saved order, appending any new ones at the end */
function applyOrder(projects: Project[], order: string[]): Project[] {
  const orderMap = new Map(order.map((name, i) => [name, i]))
  return [...projects].sort((a, b) => {
    const ai = orderMap.get(a.name) ?? Infinity
    const bi = orderMap.get(b.name) ?? Infinity
    return ai - bi
  })
}

interface ProjectStore {
  projects: Project[]
  activeProject: string | null
  loading: boolean
  error: string | null
  swipeDirection: 'left' | 'right' | 'up' | 'down' | null
  setProjects: (projects: Project[]) => void
  setActiveProject: (name: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  switchProject: (direction: 'left' | 'right') => void
  reorderProjects: (orderedNames: string[]) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  activeProject: null,
  loading: true,
  error: null,
  swipeDirection: null,
  setProjects: (projects) => set({ projects: applyOrder(projects, loadOrder()), loading: false, error: null }),
  setActiveProject: (name) => {
    const { projects, activeProject } = get()
    if (name === activeProject) return
    const activeProjects = projects.filter(p => p.status === 'active')
    const oldIdx = activeProjects.findIndex(p => p.name === activeProject)
    const newIdx = activeProjects.findIndex(p => p.name === name)
    const dir = oldIdx === -1 || newIdx === -1 ? null
      : newIdx > oldIdx ? 'down' : 'up'
    set({ activeProject: name, swipeDirection: dir as any })
    setTimeout(() => set({ swipeDirection: null }), 450)
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  switchProject: (direction) => {
    const { projects, activeProject } = get()
    const activeProjects = projects.filter(p => p.status === 'active')
    if (activeProjects.length < 2) return
    const currentIdx = activeProjects.findIndex(p => p.name === activeProject)
    if (currentIdx === -1) return
    const nextIdx = direction === 'right'
      ? (currentIdx + 1) % activeProjects.length
      : (currentIdx - 1 + activeProjects.length) % activeProjects.length
    set({ swipeDirection: direction, activeProject: activeProjects[nextIdx].name })
    // Clear swipe direction after animation
    setTimeout(() => set({ swipeDirection: null }), 300)
  },
  reorderProjects: (orderedNames) => {
    saveOrder(orderedNames)
    set({ projects: applyOrder(get().projects, orderedNames) })
  },
}))
