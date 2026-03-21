import { useEffect, useRef } from 'react'
import { useUIStore, type ViewId } from '@/store/uiStore'

const SWIPE_VIEWS: ViewId[] = ['morning', 'agents', 'timeline', 'source', 'todos']
const DISTANCE_THRESHOLD = 50  // px
const VELOCITY_THRESHOLD = 0.3 // px/ms
const LOCK_ANGLE_PX = 10       // px before directional lock

/**
 * Enable swipe-to-navigate between strip views on touch devices.
 * Attaches to the given container ref.
 *
 * Suppressed when:
 * - Touch target is inside [data-canvas-container] (canvas owns all touch)
 * - Touch target is inside an element with horizontal scroll
 * - A sub-view overlay is active
 */
export function useSwipeNavigation(containerRef: React.RefObject<HTMLElement | null>) {
  const activeView = useUIStore(s => s.activeView)
  const setView = useUIStore(s => s.setView)
  const goBack = useUIStore(s => s.goBack)

  const touchRef = useRef<{
    startX: number
    startY: number
    startTime: number
    locked: 'horizontal' | 'vertical' | null
  } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isSubView = !SWIPE_VIEWS.includes(activeView) && activeView !== 'terminal' && activeView !== 'settings'

    const isHorizontallyScrollable = (el: HTMLElement): boolean => {
      let current: HTMLElement | null = el
      while (current && current !== container) {
        if (current.scrollWidth > current.clientWidth + 2) {
          const style = getComputedStyle(current)
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true
        }
        current = current.parentElement
      }
      return false
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      // Suppress inside canvas
      if ((e.target as HTMLElement).closest('[data-canvas-container]')) return
      // Suppress inside horizontally scrollable elements
      if (isHorizontallyScrollable(e.target as HTMLElement)) return

      touchRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTime: Date.now(),
        locked: null,
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      const t = touchRef.current
      if (!t || e.touches.length !== 1) return

      const dx = e.touches[0].clientX - t.startX
      const dy = e.touches[0].clientY - t.startY

      // Directional lock
      if (!t.locked && (Math.abs(dx) > LOCK_ANGLE_PX || Math.abs(dy) > LOCK_ANGLE_PX)) {
        t.locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      }

      // If locked vertical, abort swipe navigation
      if (t.locked === 'vertical') {
        touchRef.current = null
        return
      }

      // If locked horizontal, prevent vertical scroll
      if (t.locked === 'horizontal') {
        e.preventDefault()
      }
    }

    const handleTouchEnd = (e: TouchEvent) => {
      const t = touchRef.current
      touchRef.current = null
      if (!t || t.locked !== 'horizontal') return

      const dx = (e.changedTouches[0]?.clientX ?? 0) - t.startX
      const elapsed = Date.now() - t.startTime
      const velocity = Math.abs(dx) / elapsed
      const committed = Math.abs(dx) > DISTANCE_THRESHOLD || velocity > VELOCITY_THRESHOLD

      if (!committed) return

      if (isSubView) {
        // Right swipe on sub-view = go back
        if (dx > 0) goBack()
        return
      }

      const currentIdx = SWIPE_VIEWS.indexOf(activeView)
      if (currentIdx < 0) return

      if (dx > 0 && currentIdx > 0) {
        // Swipe right = previous view
        setView(SWIPE_VIEWS[currentIdx - 1])
      } else if (dx < 0 && currentIdx < SWIPE_VIEWS.length - 1) {
        // Swipe left = next view
        setView(SWIPE_VIEWS[currentIdx + 1])
      }
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [containerRef, activeView, setView, goBack])
}
