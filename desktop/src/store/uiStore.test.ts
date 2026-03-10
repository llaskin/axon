import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUIStore } from './uiStore'

// Mock localStorage (matchMedia is mocked in test/setup.ts)
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

describe('uiStore', () => {
  beforeEach(() => {
    localStorageMock.clear()
    localStorageMock.getItem.mockClear()
    localStorageMock.setItem.mockClear()

    // Reset store to known state
    useUIStore.setState({
      sidebarOpen: true,
      theme: 'light',
      activeView: 'timeline',
      selectedRollup: null,
    })
  })

  describe('initial state', () => {
    it('defaults activeView to timeline', () => {
      expect(useUIStore.getState().activeView).toBe('timeline')
    })

    it('defaults theme to light when no stored preference and system is light', () => {
      expect(useUIStore.getState().theme).toBe('light')
    })

    it('defaults sidebarOpen to true', () => {
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })

    it('defaults selectedRollup to null', () => {
      expect(useUIStore.getState().selectedRollup).toBeNull()
    })
  })

  describe('setView', () => {
    it('changes the active view', () => {
      useUIStore.getState().setView('state')
      expect(useUIStore.getState().activeView).toBe('state')
    })

    it('clears selectedRollup when changing view', () => {
      useUIStore.setState({ selectedRollup: 'rollup-2026-01-01.md' })
      useUIStore.getState().setView('decisions')
      expect(useUIStore.getState().selectedRollup).toBeNull()
    })

    it('accepts all valid view ids', () => {
      const views = ['timeline', 'state', 'decisions', 'settings', 'rollup-detail'] as const
      for (const view of views) {
        useUIStore.getState().setView(view)
        expect(useUIStore.getState().activeView).toBe(view)
      }
    })
  })

  describe('toggleTheme', () => {
    it('toggles from light to dark', () => {
      useUIStore.setState({ theme: 'light' })
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe('dark')
    })

    it('toggles from dark to light', () => {
      useUIStore.setState({ theme: 'dark' })
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe('light')
    })

    it('persists the new theme to localStorage', () => {
      useUIStore.setState({ theme: 'light' })
      useUIStore.getState().toggleTheme()
      expect(localStorageMock.setItem).toHaveBeenCalledWith('ax-theme', 'dark')
    })

    it('round-trips back to original theme after two toggles', () => {
      useUIStore.setState({ theme: 'light' })
      useUIStore.getState().toggleTheme()
      useUIStore.getState().toggleTheme()
      expect(useUIStore.getState().theme).toBe('light')
    })
  })

  describe('setTheme', () => {
    it('sets the theme directly', () => {
      useUIStore.getState().setTheme('dark')
      expect(useUIStore.getState().theme).toBe('dark')
    })

    it('persists the theme to localStorage', () => {
      useUIStore.getState().setTheme('dark')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('ax-theme', 'dark')
    })
  })

  describe('toggleSidebar', () => {
    it('toggles sidebar from open to closed', () => {
      useUIStore.setState({ sidebarOpen: true })
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(false)
    })

    it('toggles sidebar from closed to open', () => {
      useUIStore.setState({ sidebarOpen: false })
      useUIStore.getState().toggleSidebar()
      expect(useUIStore.getState().sidebarOpen).toBe(true)
    })
  })

  describe('openRollup', () => {
    it('sets activeView to rollup-detail and stores the filename', () => {
      useUIStore.getState().openRollup('rollup-2026-03-10.md')
      expect(useUIStore.getState().activeView).toBe('rollup-detail')
      expect(useUIStore.getState().selectedRollup).toBe('rollup-2026-03-10.md')
    })
  })

  describe('goBack', () => {
    it('returns to timeline view and clears selectedRollup', () => {
      useUIStore.setState({ activeView: 'rollup-detail', selectedRollup: 'rollup-2026-03-10.md' })
      useUIStore.getState().goBack()
      expect(useUIStore.getState().activeView).toBe('timeline')
      expect(useUIStore.getState().selectedRollup).toBeNull()
    })
  })
})
