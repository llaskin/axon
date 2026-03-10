import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useProjectStore } from './projectStore'
import type { Project } from '../lib/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    name: 'test-project',
    path: '/tmp/test-project',
    status: 'active',
    createdAt: '2026-01-01',
    lastRollup: null,
    episodeCount: 0,
    openLoopCount: 0,
    ...overrides,
  }
}

describe('projectStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Reset store to initial state before each test
    useProjectStore.setState({
      projects: [],
      activeProject: null,
      loading: true,
      error: null,
      swipeDirection: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('initial state', () => {
    it('has empty projects array', () => {
      expect(useProjectStore.getState().projects).toEqual([])
    })

    it('has null activeProject', () => {
      expect(useProjectStore.getState().activeProject).toBeNull()
    })

    it('has loading set to true', () => {
      expect(useProjectStore.getState().loading).toBe(true)
    })

    it('has null error', () => {
      expect(useProjectStore.getState().error).toBeNull()
    })

    it('has null swipeDirection', () => {
      expect(useProjectStore.getState().swipeDirection).toBeNull()
    })
  })

  describe('setProjects', () => {
    it('sets the projects array', () => {
      const projects = [makeProject({ name: 'alpha' }), makeProject({ name: 'beta' })]
      useProjectStore.getState().setProjects(projects)

      expect(useProjectStore.getState().projects).toEqual(projects)
    })

    it('clears loading', () => {
      expect(useProjectStore.getState().loading).toBe(true)
      useProjectStore.getState().setProjects([makeProject()])
      expect(useProjectStore.getState().loading).toBe(false)
    })

    it('clears error', () => {
      useProjectStore.setState({ error: 'something broke' })
      useProjectStore.getState().setProjects([makeProject()])
      expect(useProjectStore.getState().error).toBeNull()
    })
  })

  describe('setActiveProject', () => {
    it('sets the active project name', () => {
      useProjectStore.getState().setActiveProject('my-project')
      expect(useProjectStore.getState().activeProject).toBe('my-project')
    })

    it('clears swipeDirection', () => {
      useProjectStore.setState({ swipeDirection: 'left' })
      useProjectStore.getState().setActiveProject('my-project')
      expect(useProjectStore.getState().swipeDirection).toBeNull()
    })
  })

  describe('setLoading', () => {
    it('sets loading to the given value', () => {
      useProjectStore.getState().setLoading(false)
      expect(useProjectStore.getState().loading).toBe(false)

      useProjectStore.getState().setLoading(true)
      expect(useProjectStore.getState().loading).toBe(true)
    })
  })

  describe('setError', () => {
    it('sets the error message', () => {
      useProjectStore.getState().setError('fetch failed')
      expect(useProjectStore.getState().error).toBe('fetch failed')
    })

    it('clears loading when an error is set', () => {
      useProjectStore.setState({ loading: true })
      useProjectStore.getState().setError('fetch failed')
      expect(useProjectStore.getState().loading).toBe(false)
    })

    it('can clear the error by passing null', () => {
      useProjectStore.getState().setError('fetch failed')
      useProjectStore.getState().setError(null)
      expect(useProjectStore.getState().error).toBeNull()
    })
  })

  describe('switchProject', () => {
    const activeA = makeProject({ name: 'alpha', status: 'active' })
    const activeB = makeProject({ name: 'beta', status: 'active' })
    const activeC = makeProject({ name: 'gamma', status: 'active' })
    const paused = makeProject({ name: 'paused-one', status: 'paused' })

    it('does nothing when there are fewer than 2 active projects', () => {
      useProjectStore.setState({
        projects: [activeA, paused],
        activeProject: 'alpha',
      })

      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBe('alpha')
      expect(useProjectStore.getState().swipeDirection).toBeNull()
    })

    it('does nothing when there are no projects', () => {
      useProjectStore.setState({ projects: [], activeProject: null })
      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBeNull()
    })

    it('does nothing when activeProject is not found among active projects', () => {
      useProjectStore.setState({
        projects: [activeA, activeB],
        activeProject: 'nonexistent',
      })
      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBe('nonexistent')
    })

    it('cycles right through active projects', () => {
      useProjectStore.setState({
        projects: [activeA, activeB, activeC, paused],
        activeProject: 'alpha',
      })

      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBe('beta')
      expect(useProjectStore.getState().swipeDirection).toBe('right')
    })

    it('wraps around when cycling right past the last active project', () => {
      useProjectStore.setState({
        projects: [activeA, activeB, activeC],
        activeProject: 'gamma',
      })

      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBe('alpha')
    })

    it('cycles left through active projects', () => {
      useProjectStore.setState({
        projects: [activeA, activeB, activeC],
        activeProject: 'beta',
      })

      useProjectStore.getState().switchProject('left')
      expect(useProjectStore.getState().activeProject).toBe('alpha')
      expect(useProjectStore.getState().swipeDirection).toBe('left')
    })

    it('wraps around when cycling left past the first active project', () => {
      useProjectStore.setState({
        projects: [activeA, activeB, activeC],
        activeProject: 'alpha',
      })

      useProjectStore.getState().switchProject('left')
      expect(useProjectStore.getState().activeProject).toBe('gamma')
    })

    it('only considers active projects, skipping paused/archived', () => {
      const archived = makeProject({ name: 'old', status: 'archived' })
      useProjectStore.setState({
        projects: [activeA, paused, archived, activeB],
        activeProject: 'alpha',
      })

      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().activeProject).toBe('beta')
    })

    it('clears swipeDirection after 300ms', () => {
      useProjectStore.setState({
        projects: [activeA, activeB],
        activeProject: 'alpha',
      })

      useProjectStore.getState().switchProject('right')
      expect(useProjectStore.getState().swipeDirection).toBe('right')

      vi.advanceTimersByTime(300)
      expect(useProjectStore.getState().swipeDirection).toBeNull()
    })
  })
})
