import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Maximize2, Star, RefreshCw, Check, X, Pencil, Minus, Plus } from 'lucide-react'
import { CanvasTerminal } from './CanvasTerminal'
import { FullscreenTerminal } from '@/components/shared/FullscreenTerminal'
import { useTerminalStore } from '@/store/terminalStore'
import { useIsTouchDevice } from '@/hooks/useMediaQuery'
import {
  GRID, TILE_W, TILE_H, TILE_EXPANDED_W, TILE_EXPANDED_H, TILE_MINIMIZED_W, TILE_MINIMIZED_H,
  snap, getZoneDepth, getDescendantZoneIds, isAncestorOf,
  computeZoneLayouts,
  type TileState, type ZoneState, type TileAction, type ZoneAction, type ZoneLayout,
} from './zoneReducers'
import type { Viewport } from './useCanvasState'
import type { SessionSummary } from '@/hooks/useSessions'

/* ── Constants ─────────────────────────────────────────────────── */

const MIN_SCALE = 0.08
const MAX_SCALE = 3
const DRAG_THRESHOLD = 'ontouchstart' in globalThis ? 10 : 4
const MINIMIZE_SCALE = 0.5

const HEAT_COLORS: Record<string, string> = {
  read: '#6B8FAD', write: '#7B9E7B', edit: '#C8956C',
  bash: '#C4933B', error: '#B85450', chat: '#9B8E83',
}

/* ── Helpers ───────────────────────────────────────────────────── */

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function MiniHeatStrip({ json }: { json: string | null }) {
  if (!json) return null
  let segments: { type: string }[]
  try { segments = JSON.parse(json) } catch { return null }
  if (!segments.length) return null
  const MAX = 40
  const step = Math.max(1, Math.ceil(segments.length / MAX))
  const sampled = segments.filter((_, i) => i % step === 0).slice(0, MAX)
  return (
    <div className="flex h-[3px] rounded-full overflow-hidden gap-px">
      {sampled.map((seg, i) => (
        <div key={i} className="flex-1 min-w-[1px]"
          style={{ backgroundColor: HEAT_COLORS[seg.type] || HEAT_COLORS.chat }} />
      ))}
    </div>
  )
}

/* ── Props ─────────────────────────────────────────────────────── */

interface CanvasViewProps {
  sessions: SessionSummary[]
  tiles: TileState[]
  zones: ZoneState[]
  viewport: Viewport
  zoneLayouts: Map<string, ZoneLayout>
  tilePositionMap: Map<string, { x: number; y: number }>
  dispatchTiles: React.Dispatch<TileAction>
  dispatchZones: React.Dispatch<ZoneAction>
  setViewport: (v: Viewport) => void
  scheduleSave: () => void
  immediateSave: () => void
  reorgActive: boolean
  onReorganize: () => void
  onReorgApply: () => void
  onReorgCancel: () => void
  onOpenSession?: (sessionId: string) => void
  onRemoveTile?: (sessionId: string) => void
  onSessionRenamed?: () => void
  onAddTile?: (sessionId: string, x: number, y: number) => void
  onAssignTileZone?: (sessionId: string, zoneId: string | null) => void
  activeProject?: string | null
}

/* ── Component ─────────────────────────────────────────────────── */

export function CanvasView({
  sessions, tiles, zones, viewport,
  zoneLayouts, tilePositionMap,
  dispatchTiles, dispatchZones, setViewport,
  scheduleSave, immediateSave,
  reorgActive, onReorganize, onReorgApply, onReorgCancel, onOpenSession, onRemoveTile, onSessionRenamed,
  onAddTile, onAssignTileZone, activeProject,
}: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef(viewport)
  const rafRef = useRef(0)
  const zoomTextRef = useRef<HTMLSpanElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null)
  const [fullscreenTerminalId, setFullscreenTerminalId] = useState<string | null>(null)
  const isTouch = useIsTouchDevice()
  const [droppedTileId, setDroppedTileId] = useState<string | null>(null)
  const [flashZoneId, setFlashZoneId] = useState<string | null>(null)
  const [editingTileId, setEditingTileId] = useState<string | null>(null)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  // Canvas terminal state from global store (survives view switches)
  const canvasTerminals = useTerminalStore(s => s.canvasTerminals)
  const canvasExpanded = useTerminalStore(s => s.canvasExpanded)

  // Keep refs synced
  viewportRef.current = viewport
  const tilesRef = useRef(tiles)
  tilesRef.current = tiles

  // Optimistic nickname overrides — applied instantly, cleared on next refetch
  const [nicknameOverrides, setNicknameOverrides] = useState<Map<string, string>>(new Map())

  // Shared state for session detection across concurrent pollers
  const claimedSessionIdsRef = useRef(new Set<string>())
  const pollIntervalsRef = useRef(new Set<ReturnType<typeof setInterval>>())
  const unmountedRef = useRef(false)

  // Clean up polling intervals on unmount
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      for (const id of pollIntervalsRef.current) clearInterval(id)
      pollIntervalsRef.current.clear()
    }
  }, [])

  // Detect real session ID after spawning a new session
  const detectSessionId = useCallback((fakeId: string, spawnTime: number) => {
    if (!activeProject) return
    let attempts = 0
    const maxAttempts = 15
    const poll = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) { clearInterval(poll); pollIntervalsRef.current.delete(poll); return }
      try {
        const res = await fetch(
          `/api/axon/sessions?project=${encodeURIComponent(activeProject)}&forceIndex=true`
        )
        if (unmountedRef.current) return
        const data = await res.json()
        const currentTiles = tilesRef.current
        const existingTileIds = new Set(currentTiles.map(t => t.sessionId))
        // Also exclude sessions already mapped to a canvas terminal or claimed by another poller
        const canvasMapped = new Set(Object.keys(useTerminalStore.getState().canvasTerminals))
        const claimed = claimedSessionIdsRef.current
        // Find a session created after spawn that isn't already on a tile, mapped, or claimed
        const match = (data.sessions || []).find((s: { id: string; created_at: string | null }) =>
          !existingTileIds.has(s.id) &&
          !canvasMapped.has(s.id) &&
          !claimed.has(s.id) &&
          s.created_at && new Date(s.created_at).getTime() > spawnTime - 5000
        )
        if (match) {
          claimed.add(match.id)
          clearInterval(poll)
          pollIntervalsRef.current.delete(poll)
          dispatchTiles({ type: 'REPLACE_SESSION', oldSessionId: fakeId, newSessionId: match.id })
          useTerminalStore.getState().replaceCanvasSessionId(fakeId, match.id)
          immediateSave()
          onSessionRenamed?.() // Trigger sessions refetch so tile gets its title
        }
      } catch { /* silent */ }
    }, 2000)
    pollIntervalsRef.current.add(poll)
  }, [activeProject, dispatchTiles, immediateSave, onSessionRenamed])

  // Handle terminal exits on canvas tiles (e.g. resume failure)
  useEffect(() => {
    const cleanedUp = new Set<string>()
    return useTerminalStore.subscribe((state) => {
      for (const [sid, tid] of Object.entries(state.canvasTerminals)) {
        if (cleanedUp.has(sid)) continue
        const term = state.terminals[tid]
        if (term?.status === 'exited' && term.exitCode !== 0) {
          cleanedUp.add(sid)
          const exitedTid = tid // Capture the terminal ID that exited
          // Brief delay so user sees the error, then collapse
          setTimeout(() => {
            // Skip if terminal was replaced (user re-clicked tile before timeout)
            const currentTid = useTerminalStore.getState().canvasTerminals[sid]
            if (currentTid && currentTid !== exitedTid) { cleanedUp.delete(sid); return }
            useTerminalStore.getState().killCanvasTerminal(sid)
            cleanedUp.delete(sid) // Allow future failures for same session
            dispatchTiles({ type: 'RESIZE', sessionId: sid, width: TILE_W, height: TILE_H })
            immediateSave()
          }, 1500)
        }
      }
    })
  }, [dispatchTiles, immediateSave])

  const sessionMap = useMemo(() => {
    const map = new Map(sessions.map(s => [s.id, s]))
    // Apply optimistic overrides
    for (const [id, nickname] of nicknameOverrides) {
      const s = map.get(id)
      if (s) map.set(id, { ...s, nickname })
    }
    return map
  }, [sessions, nicknameOverrides])

  // Clear overrides when sessions prop updates (refetch completed)
  useEffect(() => {
    if (nicknameOverrides.size > 0) setNicknameOverrides(new Map())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  // Scale class for detail level
  const [scaleClass, setScaleClass] = useState<'full' | 'thumb' | 'dot'>(() =>
    viewport.scale > 0.4 ? 'full' : viewport.scale > 0.15 ? 'thumb' : 'dot'
  )
  const scaleClassRef = useRef(scaleClass)

  /* ── Rename commit ───────────────────────────────────────────── */

  const commitRename = useCallback(async (sessionId: string, value: string) => {
    setEditingTileId(null)
    const trimmed = value.trim()
    const session = sessionMap.get(sessionId)
    const current = session?.nickname || session?.first_prompt || ''
    if (trimmed === current || !trimmed) return
    // Optimistic update — show new name immediately
    setNicknameOverrides(prev => new Map(prev).set(sessionId, trimmed))
    try {
      await fetch(`/api/axon/sessions/${encodeURIComponent(sessionId)}/meta`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: trimmed }),
      })
      onSessionRenamed?.()
    } catch { /* silent */ }
  }, [sessionMap, onSessionRenamed])

  const commitZoneRename = useCallback((zoneId: string, value: string) => {
    setEditingZoneId(null)
    const trimmed = value.trim()
    if (!trimmed) return
    const zone = zones.find(z => z.id === zoneId)
    if (!zone || trimmed === zone.label) return
    dispatchZones({ type: 'RENAME', id: zoneId, label: trimmed })
  }, [zones, dispatchZones])

  /* ── Apply viewport transform to DOM ──────────────────────────── */

  const applyViewport = useCallback(() => {
    const v = viewportRef.current
    const world = worldRef.current
    const container = containerRef.current
    if (!world || !container) return

    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`

    // Grid background
    const minor = GRID * v.scale
    const major = 100 * v.scale
    const minorAlpha = v.scale < 0.3 ? 0 : v.scale < 0.5 ? ((v.scale - 0.3) / 0.2) * 0.3 : 0.3

    container.style.backgroundImage = [
      `linear-gradient(rgba(128,120,110,${minorAlpha * 0.15}) 1px, transparent 1px)`,
      `linear-gradient(90deg, rgba(128,120,110,${minorAlpha * 0.15}) 1px, transparent 1px)`,
      `linear-gradient(rgba(128,120,110,0.08) 1px, transparent 1px)`,
      `linear-gradient(90deg, rgba(128,120,110,0.08) 1px, transparent 1px)`,
    ].join(',')
    container.style.backgroundSize =
      `${minor}px ${minor}px, ${minor}px ${minor}px, ${major}px ${major}px, ${major}px ${major}px`
    container.style.backgroundPosition =
      `${v.x}px ${v.y}px, ${v.x}px ${v.y}px, ${v.x}px ${v.y}px, ${v.x}px ${v.y}px`

    if (zoomTextRef.current) {
      zoomTextRef.current.textContent = `${Math.round(v.scale * 100)}%`
    }
  }, [])

  const updateScaleClass = useCallback(() => {
    const s = viewportRef.current.scale
    const cls = s > 0.4 ? 'full' : s > 0.15 ? 'thumb' : 'dot'
    if (cls !== scaleClassRef.current) {
      scaleClassRef.current = cls
      setScaleClass(cls)
    }
  }, [])

  // Apply viewport on mount and when viewport state changes
  useEffect(() => { applyViewport() }, [viewport, applyViewport])

  /* ── Fit all ──────────────────────────────────────────────────── */

  const fitAll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    if (width === 0 || height === 0) return

    const zl = computeZoneLayouts(zones, tiles)

    // Collect all bounding rects
    const rects: { x: number; y: number; r: number; b: number }[] = []
    for (const tile of tiles) {
      if (!tile.zoneId) {
        rects.push({ x: tile.x, y: tile.y, r: tile.x + tile.width, b: tile.y + tile.height })
      }
    }
    for (const zone of zones) {
      const layout = zl.get(zone.id)
      if (layout) {
        rects.push({ x: zone.x, y: zone.y, r: zone.x + layout.width, b: zone.y + layout.height })
      }
    }
    if (rects.length === 0) return

    const minX = Math.min(...rects.map(r => r.x))
    const maxX = Math.max(...rects.map(r => r.r))
    const minY = Math.min(...rects.map(r => r.y))
    const maxY = Math.max(...rects.map(r => r.b))

    const pad = 80
    const scaleX = (width - pad * 2) / (maxX - minX || 1)
    const scaleY = (height - pad * 2) / (maxY - minY || 1)
    const scale = Math.min(scaleX, scaleY, 1.5)

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const newViewport = {
      x: width / 2 - cx * scale,
      y: height / 2 - cy * scale,
      scale,
    }
    viewportRef.current = newViewport
    setViewport(newViewport)
    applyViewport()
    updateScaleClass()
    scheduleSave()
  }, [zones, tiles, setViewport, applyViewport, updateScaleClass, scheduleSave])

  // Fit on first load
  const didFitRef = useRef(false)
  useEffect(() => {
    if (didFitRef.current) return
    if (tiles.length === 0 && zones.length === 0) return
    didFitRef.current = true
    if (viewport.x === 0 && viewport.y === 0 && viewport.scale === 1) {
      fitAll()
    }
  }, [tiles, zones, viewport, fitAll])

  /* ── Wheel handler: pan + zoom ────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewportRef.current
      const rect = container.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top

      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > 2) {
        // Trackpad pan
        v.x -= e.deltaX
        v.y -= e.deltaY
      } else {
        // Zoom at cursor
        const oldScale = v.scale
        const factor = e.ctrlKey ? 0.008 : 0.003
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * (1 - e.deltaY * factor)))
        v.x = cx - (cx - v.x) * (newScale / oldScale)
        v.y = cy - (cy - v.y) * (newScale / oldScale)
        v.scale = newScale
      }

      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        applyViewport()
        updateScaleClass()
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [applyViewport, updateScaleClass])

  /* ── Drag state ───────────────────────────────────────────────── */

  const dragRef = useRef<{
    type: 'pan' | 'tile' | 'zone' | 'resize'
    startMouseX: number
    startMouseY: number
    startVpX: number
    startVpY: number
    targetId?: string
    startX: number
    startY: number
    startWidth?: number
    startHeight?: number
    hasMoved: boolean
  } | null>(null)

  /* ── Zone hit detection ───────────────────────────────────────── */

  const findZoneAtWorldPoint = useCallback((wx: number, wy: number, excludeZoneId?: string): string | null => {
    let best: string | null = null
    let bestDepth = -1
    for (const zone of zones) {
      if (zone.id === excludeZoneId) continue
      const layout = zoneLayouts.get(zone.id)
      if (!layout) continue
      if (wx >= zone.x && wx <= zone.x + layout.width &&
          wy >= zone.y && wy <= zone.y + layout.height) {
        const depth = getZoneDepth(zone.id, zones)
        if (depth > bestDepth) {
          bestDepth = depth
          best = zone.id
        }
      }
    }
    return best
  }, [zones, zoneLayouts])

  /* ── Mouse handlers (on container for pan) ─────────────────────── */

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (reorgActive) return // no drag during preview
    const v = viewportRef.current

    // Check for zone header drag
    const zoneHeader = (e.target as HTMLElement).closest('[data-zone-header]') as HTMLElement | null
    if (zoneHeader) {
      const zoneId = zoneHeader.getAttribute('data-zone-header')!
      const zone = zones.find(z => z.id === zoneId)
      if (!zone) return
      dragRef.current = {
        type: 'zone',
        startMouseX: e.clientX, startMouseY: e.clientY,
        startVpX: v.x, startVpY: v.y,
        targetId: zoneId,
        startX: zone.x, startY: zone.y,
        hasMoved: false,
      }
      e.preventDefault()
      return
    }

    // Check for resize handle (before tile drag)
    const resizeHandle = (e.target as HTMLElement).closest('[data-resize-handle]') as HTMLElement | null
    if (resizeHandle) {
      const sessionId = resizeHandle.getAttribute('data-resize-handle')!
      const tile = tiles.find(t => t.sessionId === sessionId)
      if (tile) {
        dragRef.current = {
          type: 'resize',
          startMouseX: e.clientX, startMouseY: e.clientY,
          startVpX: v.x, startVpY: v.y,
          targetId: sessionId,
          startX: 0, startY: 0,
          startWidth: tile.width, startHeight: tile.height,
          hasMoved: false,
        }
        e.preventDefault()
        return
      }
    }

    // Check for tile drag
    const tileEl = (e.target as HTMLElement).closest('[data-tile-id]') as HTMLElement | null
    if (tileEl) {
      const sessionId = tileEl.getAttribute('data-tile-id')!
      const pos = tilePositionMap.get(sessionId)
      const tile = tiles.find(t => t.sessionId === sessionId)
      dragRef.current = {
        type: 'tile',
        startMouseX: e.clientX, startMouseY: e.clientY,
        startVpX: v.x, startVpY: v.y,
        targetId: sessionId,
        startX: pos?.x ?? tile?.x ?? 0,
        startY: pos?.y ?? tile?.y ?? 0,
        hasMoved: false,
      }
      e.preventDefault()
      return
    }

    // Background pan
    dragRef.current = {
      type: 'pan',
      startMouseX: e.clientX, startMouseY: e.clientY,
      startVpX: v.x, startVpY: v.y,
      startX: 0, startY: 0,
      hasMoved: false,
    }
    e.preventDefault()
  }, [zones, tiles, tilePositionMap, reorgActive])

  // Clear drop animation after it plays
  useEffect(() => {
    if (!droppedTileId) return
    const t = setTimeout(() => setDroppedTileId(null), 400)
    return () => clearTimeout(t)
  }, [droppedTileId])

  useEffect(() => {
    if (!flashZoneId) return
    const t = setTimeout(() => setFlashZoneId(null), 500)
    return () => clearTimeout(t)
  }, [flashZoneId])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startMouseX
      const dy = e.clientY - d.startMouseY
      if (!d.hasMoved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

      if (!d.hasMoved) {
        d.hasMoved = true
        setIsDragging(true)
      }

      const v = viewportRef.current

      if (d.type === 'pan') {
        v.x = d.startVpX + dx
        v.y = d.startVpY + dy
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(applyViewport)
      } else if (d.type === 'tile' && d.targetId) {
        const worldDx = dx / v.scale
        const worldDy = dy / v.scale
        const newX = snap(d.startX + worldDx)
        const newY = snap(d.startY + worldDy)
        dispatchTiles({ type: 'MOVE', sessionId: d.targetId, x: newX, y: newY })

        // Track which zone the tile is hovering over
        const tileCx = newX + TILE_W / 2
        const tileCy = newY + TILE_H / 2
        const hitZone = findZoneAtWorldPoint(tileCx, tileCy)
        setHoverZoneId(hitZone)
      } else if (d.type === 'zone' && d.targetId) {
        const worldDx = dx / v.scale
        const worldDy = dy / v.scale
        const newX = snap(d.startX + worldDx)
        const newY = snap(d.startY + worldDy)
        const zone = zones.find(z => z.id === d.targetId)
        if (zone) {
          const zoneDx = newX - zone.x
          const zoneDy = newY - zone.y
          dispatchZones({ type: 'MOVE', id: d.targetId, x: newX, y: newY })
          const descendantIds = getDescendantZoneIds(d.targetId, zones)
          if (descendantIds.size > 0) {
            dispatchZones({ type: 'MOVE_DESCENDANTS', id: d.targetId, dx: zoneDx, dy: zoneDy })
          }
          const zonedTiles = tiles.filter(t => t.zoneId === d.targetId)
          for (const tile of zonedTiles) {
            dispatchTiles({ type: 'MOVE', sessionId: tile.sessionId, x: tile.x + zoneDx, y: tile.y + zoneDy })
          }
          // Show hover indicator when dragging zone over another zone
          const layout = zoneLayouts.get(d.targetId)
          const zoneCx = newX + (layout?.width || 200) / 2
          const zoneCy = newY + (layout?.height || 72) / 2
          const hitZone = findZoneAtWorldPoint(zoneCx, zoneCy, d.targetId)
          // Prevent circular nesting
          const safeHit = hitZone && !isAncestorOf(d.targetId, hitZone, zones) ? hitZone : null
          setHoverZoneId(safeHit)
        }
      } else if (d.type === 'resize' && d.targetId) {
        const dxW = (e.clientX - d.startMouseX) / v.scale
        const dyH = (e.clientY - d.startMouseY) / v.scale
        const newW = Math.max(TILE_MINIMIZED_W, snap((d.startWidth || TILE_EXPANDED_W) + dxW))
        const newH = Math.max(TILE_MINIMIZED_H, snap((d.startHeight || TILE_EXPANDED_H) + dyH))
        dispatchTiles({ type: 'RESIZE', sessionId: d.targetId, width: newW, height: newH })
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      setIsDragging(false)
      setHoverZoneId(null)

      if (!d.hasMoved) {
        // Click (no drag) on tile — 3-state: normal → expanded, minimized → expanded, expanded → no-op
        if (d.type === 'tile' && d.targetId) {
          const sid = d.targetId
          const store = useTerminalStore.getState()
          const termId = store.canvasTerminals[sid]
          const expandState = store.canvasExpanded[sid]

          // On touch devices, open fullscreen terminal instead of inline
          if (isTouch) {
            if (termId) {
              setFullscreenTerminalId(termId)
            } else if (activeProject) {
              const isNew = sid.startsWith('new-')
              dispatchTiles({ type: 'RESIZE', sessionId: sid, width: TILE_EXPANDED_W, height: TILE_EXPANDED_H })
              store.spawn(activeProject, isNew ? undefined : sid).then(tid => {
                useTerminalStore.getState().expandCanvasTile(sid, tid)
                if (isNew) detectSessionId(sid, Date.now())
                setFullscreenTerminalId(tid)
              })
            }
            return
          }

          if (termId && expandState === 'expanded') {
            // Check if terminal is actually alive — if exited, clean up and spawn fresh
            const termEntry = store.terminals[termId]
            if (termEntry?.status === 'exited' && activeProject) {
              store.killCanvasTerminal(sid)
              store.spawn(activeProject).then(tid => {
                useTerminalStore.getState().expandCanvasTile(sid, tid)
                detectSessionId(sid, Date.now())
              })
            }
          } else if (termId && expandState === 'minimized') {
            store.setTileExpanded(sid, true)
          } else if (activeProject) {
            const isNew = sid.startsWith('new-')
            dispatchTiles({ type: 'RESIZE', sessionId: sid, width: TILE_EXPANDED_W, height: TILE_EXPANDED_H })
            store.spawn(activeProject, isNew ? undefined : sid).then(tid => {
              useTerminalStore.getState().expandCanvasTile(sid, tid)
              if (isNew) detectSessionId(sid, Date.now())
            })
          } else if (onOpenSession) {
            onOpenSession(sid)
          }
        }
        return
      }

      if (d.hasMoved) {
        if (d.type === 'resize') {
          immediateSave()
          return
        }
        if (d.type === 'tile' && d.targetId) {
          const v = viewportRef.current
          const worldDx = (e.clientX - d.startMouseX) / v.scale
          const worldDy = (e.clientY - d.startMouseY) / v.scale
          const tileX = snap(d.startX + worldDx)
          const tileY = snap(d.startY + worldDy)
          const tileCx = tileX + TILE_W / 2
          const tileCy = tileY + TILE_H / 2
          const tile = tiles.find(t => t.sessionId === d.targetId)
          const currentZone = tile?.zoneId || null
          const hitZone = findZoneAtWorldPoint(tileCx, tileCy)
          if (hitZone !== currentZone) {
            dispatchTiles({ type: 'ASSIGN_ZONE', sessionId: d.targetId!, zoneId: hitZone })
            if (hitZone) setFlashZoneId(hitZone)
          }
          // Trigger drop settle animation
          setDroppedTileId(d.targetId!)
          immediateSave()
        } else if (d.type === 'zone' && d.targetId) {
          // Check if zone was dropped onto another zone → reparent
          const zone = zones.find(z => z.id === d.targetId)
          if (zone) {
            const layout = zoneLayouts.get(d.targetId)
            const zoneCx = zone.x + (layout?.width || 200) / 2
            const zoneCy = zone.y + (layout?.height || 72) / 2
            const hitZone = findZoneAtWorldPoint(zoneCx, zoneCy, d.targetId)
            const currentParent = zone.parentZoneId || null
            // Prevent circular nesting and self-nesting
            const safeHit = hitZone && !isAncestorOf(d.targetId, hitZone, zones) ? hitZone : null
            if (safeHit !== currentParent) {
              dispatchZones({ type: 'REPARENT', id: d.targetId, parentZoneId: safeHit })
              if (safeHit) setFlashZoneId(safeHit)
            }
          }
          immediateSave()
        } else if (d.type === 'pan') {
          setViewport({ ...viewportRef.current })
          scheduleSave()
        }
      }
    }

    // Touch handlers — mirror mouse handlers for mobile
    const pinchRef = { initialDist: 0, initialScale: 1 }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch-to-zoom start
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        pinchRef.initialDist = Math.hypot(dx, dy)
        pinchRef.initialScale = viewportRef.current.scale
        dragRef.current = null // cancel any single-finger drag
        return
      }
      if (e.touches.length !== 1) return
      // Simulate mousedown with touch coordinates
      const touch = e.touches[0]
      handleMouseDown({
        clientX: touch.clientX,
        clientY: touch.clientY,
        button: 0,
        target: e.target,
        currentTarget: e.currentTarget,
        preventDefault: () => e.preventDefault(),
      } as unknown as React.MouseEvent)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Pinch-to-zoom
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        if (pinchRef.initialDist === 0) return
        const v = viewportRef.current
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const container = containerRef.current
        if (!container) return
        const rect = container.getBoundingClientRect()
        const cx = midX - rect.left
        const cy = midY - rect.top
        const oldScale = v.scale
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchRef.initialScale * (dist / pinchRef.initialDist)))
        v.x = cx - (cx - v.x) * (newScale / oldScale)
        v.y = cy - (cy - v.y) * (newScale / oldScale)
        v.scale = newScale
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          applyViewport()
          updateScaleClass()
        })
        return
      }
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      handleMouseMove({
        clientX: touch.clientX,
        clientY: touch.clientY,
      } as MouseEvent)
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length > 0) return // still touching
      pinchRef.initialDist = 0
      handleMouseUp({
        clientX: e.changedTouches[0]?.clientX ?? 0,
        clientY: e.changedTouches[0]?.clientY ?? 0,
      } as MouseEvent)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    const container = containerRef.current
    if (container) {
      container.addEventListener('touchstart', handleTouchStart, { passive: false })
      container.addEventListener('touchmove', handleTouchMove, { passive: false })
      container.addEventListener('touchend', handleTouchEnd)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (container) {
        container.removeEventListener('touchstart', handleTouchStart)
        container.removeEventListener('touchmove', handleTouchMove)
        container.removeEventListener('touchend', handleTouchEnd)
      }
    }
  }, [zones, tiles, applyViewport, dispatchTiles, dispatchZones,
      setViewport, scheduleSave, immediateSave, findZoneAtWorldPoint, handleMouseDown, updateScaleClass])

  /* ── Escape cancels reorg ─────────────────────────────────────── */

  useEffect(() => {
    if (!reorgActive) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onReorgCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [reorgActive, onReorgCancel])

  // Auto-fit when entering reorg preview
  const prevReorgRef = useRef(false)
  useEffect(() => {
    if (reorgActive && !prevReorgRef.current) {
      // Give a tick for the new layout to render, then fit
      requestAnimationFrame(() => fitAll())
    }
    prevReorgRef.current = reorgActive
  }, [reorgActive, fitAll])

  /* ── HTML5 Drop from Available sidebar ──────────────────────── */

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('axon/available-session')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    const sessionId = e.dataTransfer.getData('axon/available-session')
    if (!sessionId || !onAddTile) return
    e.preventDefault()

    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const v = viewportRef.current
    const worldX = snap((e.clientX - rect.left - v.x) / v.scale)
    const worldY = snap((e.clientY - rect.top - v.y) / v.scale)

    onAddTile(sessionId, worldX, worldY)

    // Auto-assign to zone if dropped over one
    const tileCx = worldX + TILE_W / 2
    const tileCy = worldY + TILE_H / 2
    const hitZone = findZoneAtWorldPoint(tileCx, tileCy)
    if (hitZone && onAssignTileZone) {
      onAssignTileZone(sessionId, hitZone)
      setFlashZoneId(hitZone)
    }

    setDroppedTileId(sessionId)
  }, [onAddTile, onAssignTileZone, findZoneAtWorldPoint])

  /* ── Keyboard navigation (a11y) ────────────────────────────────── */

  const [focusedTileIdx, setFocusedTileIdx] = useState(-1)

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const PAN_STEP = 50
    const ZOOM_STEP = 0.1
    const v = viewportRef.current

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        v.y += PAN_STEP
        requestAnimationFrame(applyViewport)
        break
      case 'ArrowDown':
        e.preventDefault()
        v.y -= PAN_STEP
        requestAnimationFrame(applyViewport)
        break
      case 'ArrowLeft':
        e.preventDefault()
        v.x += PAN_STEP
        requestAnimationFrame(applyViewport)
        break
      case 'ArrowRight':
        e.preventDefault()
        v.x -= PAN_STEP
        requestAnimationFrame(applyViewport)
        break
      case '+':
      case '=':
        v.scale = Math.min(MAX_SCALE, v.scale + ZOOM_STEP)
        requestAnimationFrame(() => { applyViewport(); updateScaleClass() })
        break
      case '-':
        v.scale = Math.max(MIN_SCALE, v.scale - ZOOM_STEP)
        requestAnimationFrame(() => { applyViewport(); updateScaleClass() })
        break
      case 'Tab': {
        if (tiles.length === 0) break
        e.preventDefault()
        const next = e.shiftKey
          ? (focusedTileIdx <= 0 ? tiles.length - 1 : focusedTileIdx - 1)
          : (focusedTileIdx >= tiles.length - 1 ? 0 : focusedTileIdx + 1)
        setFocusedTileIdx(next)
        // Pan to focused tile
        const tile = tiles[next]
        if (tile) {
          const pos = tilePositionMap.get(tile.sessionId)
          if (pos) {
            const container = containerRef.current
            if (container) {
              const rect = container.getBoundingClientRect()
              v.x = rect.width / 2 - pos.x * v.scale
              v.y = rect.height / 2 - pos.y * v.scale
              requestAnimationFrame(applyViewport)
            }
          }
        }
        break
      }
      case 'Enter': {
        if (focusedTileIdx >= 0 && focusedTileIdx < tiles.length) {
          const tile = tiles[focusedTileIdx]
          // Simulate click on tile
          const store = useTerminalStore.getState()
          const termId = store.canvasTerminals[tile.sessionId]
          if (!termId && activeProject) {
            const isNew = tile.sessionId.startsWith('new-')
            dispatchTiles({ type: 'RESIZE', sessionId: tile.sessionId, width: TILE_EXPANDED_W, height: TILE_EXPANDED_H })
            store.spawn(activeProject, isNew ? undefined : tile.sessionId).then(tid => {
              useTerminalStore.getState().expandCanvasTile(tile.sessionId, tid)
              if (isNew) detectSessionId(tile.sessionId, Date.now())
            })
          }
        }
        break
      }
    }
  }, [applyViewport, updateScaleClass, tiles, focusedTileIdx, tilePositionMap, activeProject, dispatchTiles, detectSessionId])

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative overflow-hidden touch-none"
      data-canvas-container
      tabIndex={0}
      role="application"
      aria-label="Session canvas — use arrow keys to pan, +/- to zoom, Tab to cycle tiles, Enter to open"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* World container — CSS transformed */}
      <div
        ref={worldRef}
        className="absolute origin-top-left"
        style={{ willChange: 'transform' }}
      >
        {/* Zones */}
        {zones.map(zone => {
          const layout = zoneLayouts.get(zone.id)
          if (!layout) return null
          const tileCount = tiles.filter(t => t.zoneId === zone.id).length
          const isHovered = hoverZoneId === zone.id
          const isFlashing = flashZoneId === zone.id

          return (
            <div
              key={zone.id}
              data-zone-id={zone.id}
              className={`absolute rounded-xl border-2 canvas-zone
                ${isHovered ? 'canvas-zone-hover' : ''}
                ${isFlashing ? 'canvas-zone-flash' : ''}
                ${reorgActive ? 'canvas-reorg-transition' : ''}`}
              style={{
                left: zone.x, top: zone.y,
                width: layout.width, height: layout.height,
                borderColor: zone.color,
                background: isHovered
                  ? `color-mix(in srgb, ${zone.color} 12%, var(--ax-bg-base))`
                  : `color-mix(in srgb, ${zone.color} 5%, var(--ax-bg-base))`,
                '--zone-color': zone.color,
              } as React.CSSProperties}
            >
              {/* Zone header — drag handle + double-click to rename */}
              <div
                data-zone-header={zone.id}
                className="h-10 flex items-center px-3 gap-2 cursor-grab select-none
                  rounded-t-[10px] transition-colors duration-200
                  hover:bg-[var(--zone-color)]/[0.08]"
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 transition-shadow duration-300
                    ${isHovered ? 'shadow-[0_0_10px_3px_var(--zone-color)]' : ''}`}
                  style={{ backgroundColor: zone.color }}
                />
                {editingZoneId === zone.id ? (
                  <input
                    autoFocus
                    className="font-mono text-[10px] uppercase tracking-wider text-ax-text-primary bg-transparent
                      border-b border-ax-brand outline-none px-0 py-0 flex-1 min-w-0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitZoneRename(zone.id, editValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitZoneRename(zone.id, editValue)
                      if (e.key === 'Escape') setEditingZoneId(null)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="font-mono text-[10px] uppercase tracking-wider text-ax-text-secondary truncate"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      setEditingZoneId(zone.id)
                      setEditValue(zone.label)
                    }}
                  >
                    {zone.label}
                  </span>
                )}
                {tileCount > 0 && (
                  <span className="font-mono text-[9px] text-ax-text-ghost ml-auto shrink-0
                    bg-[var(--zone-color)]/[0.1] px-1.5 py-0.5 rounded-full">
                    {tileCount}
                  </span>
                )}
              </div>
            </div>
          )
        })}

        {/* Tiles */}
        {tiles.map(tile => {
          const pos = tilePositionMap.get(tile.sessionId)
          if (!pos) return null
          const session = sessionMap.get(tile.sessionId)
          const zone = tile.zoneId ? zones.find(z => z.id === tile.zoneId) : null
          const isDropped = droppedTileId === tile.sessionId

          // Check if tile has a live terminal — always use full render path to avoid unmounting
          const hasTerminal = !!canvasTerminals[tile.sessionId]

          if (scaleClass === 'dot' && !hasTerminal) {
            return (
              <div
                key={tile.sessionId}
                data-tile-id={tile.sessionId}
                className={`absolute w-3 h-3 rounded-full cursor-grab canvas-dot
                  ${isDropped ? 'canvas-tile-dropped' : ''}
                  ${reorgActive ? 'canvas-reorg-transition' : ''}`}
                style={{
                  left: pos.x + TILE_W / 2 - 6,
                  top: pos.y + TILE_H / 2 - 6,
                  backgroundColor: zone?.color || 'var(--ax-text-ghost)',
                  boxShadow: `0 0 6px 1px ${zone?.color || 'transparent'}40`,
                }}
              />
            )
          }

          if (scaleClass === 'thumb' && !hasTerminal) {
            return (
              <div
                key={tile.sessionId}
                data-tile-id={tile.sessionId}
                className={`absolute bg-ax-elevated rounded-lg border border-ax-border cursor-grab
                  flex items-center gap-1.5 px-2 overflow-hidden canvas-tile-thumb
                  ${isDropped ? 'canvas-tile-dropped' : ''}
                  ${reorgActive ? 'canvas-reorg-transition' : ''}`}
                style={{
                  left: pos.x, top: pos.y, width: tile.width, height: tile.height,
                  borderColor: zone ? `color-mix(in srgb, ${zone.color} 30%, var(--ax-border))` : undefined,
                }}
              >
                {zone && (
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                )}
                <span className="text-[10px] text-ax-text-primary truncate">
                  {session?.nickname || session?.first_prompt || 'Untitled'}
                </span>
              </div>
            )
          }

          // Full mode (or terminal tile at any zoom) — card, expanded terminal, or minimized
          const termId = canvasTerminals[tile.sessionId]
          const expandState = canvasExpanded[tile.sessionId]
          const isExpanded = expandState === 'expanded' && !!termId
          const isMinimized = expandState === 'minimized' && !!termId

          return (
            <div
              key={tile.sessionId}
              data-tile-id={tile.sessionId}
              className={`absolute bg-ax-elevated rounded-lg border border-ax-border
                cursor-grab overflow-hidden flex flex-col canvas-tile group
                ${isDropped ? 'canvas-tile-dropped' : ''}
                ${isMinimized ? 'canvas-tile-live' : ''}
                ${reorgActive ? 'canvas-reorg-transition' : ''}
                transition-transform duration-300 ease-out`}
              style={{
                left: pos.x, top: pos.y, width: tile.width, height: tile.height,
                borderColor: zone ? `color-mix(in srgb, ${zone.color} 20%, var(--ax-border))` : undefined,
                zIndex: isExpanded ? 10 : isMinimized ? 5 : undefined,
                transform: isMinimized ? `scale(${MINIMIZE_SCALE})` : 'scale(1)',
                transformOrigin: 'top left',
              }}
            >
              {/* Zone accent line */}
              {zone && (
                <div className="h-[2px] w-full shrink-0" style={{ backgroundColor: zone.color }} />
              )}

              {(isExpanded || isMinimized) && termId ? (
                <>
                  {/* Terminal title bar — drag handle */}
                  <div className="shrink-0 h-7 flex items-center px-2 gap-2 bg-ax-sunken/50 border-b border-ax-border-subtle relative z-10">
                    {isMinimized && (
                      <div className="w-2 h-2 rounded-full bg-ax-success animate-pulse shrink-0" />
                    )}
                    <span className="font-mono text-[10px] text-ax-text-secondary truncate flex-1">
                      {session?.nickname || session?.first_prompt || 'Terminal'}
                    </span>
                    {/* Minimize */}
                    {isExpanded && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          useTerminalStore.getState().minimizeCanvasTile(tile.sessionId)
                          immediateSave()
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 rounded text-ax-text-ghost hover:text-ax-text-secondary hover:bg-ax-sunken transition-colors"
                        title="Minimize terminal"
                      >
                        <Minus size={12} />
                      </button>
                    )}
                    {/* Kill */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        useTerminalStore.getState().killCanvasTerminal(tile.sessionId)
                        dispatchTiles({ type: 'RESIZE', sessionId: tile.sessionId, width: TILE_W, height: TILE_H })
                        immediateSave()
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-ax-text-ghost hover:text-ax-error hover:bg-ax-sunken transition-colors"
                      title="Kill terminal"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {/* Terminal body */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <CanvasTerminal terminalId={termId} width={tile.width} height={tile.height - 30} />
                  </div>
                  {/* Resize handle — no stopPropagation, bubbles to handleMouseDown which detects [data-resize-handle] */}
                  <div
                    data-resize-handle={tile.sessionId}
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-20 opacity-0 group-hover:opacity-60 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, transparent 50%, var(--ax-text-ghost) 50%)' }}
                  />
                </>
              ) : (
                <>
                  {/* Hover actions: rename + remove */}
                  <div className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 touch-visible transition-opacity z-10"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditingTileId(tile.sessionId)
                        setEditValue(session?.nickname || session?.first_prompt || '')
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="p-1 rounded text-ax-text-ghost hover:text-ax-text-secondary hover:bg-ax-sunken transition-colors"
                      title="Rename"
                    >
                      <Pencil size={11} />
                    </button>
                    {onRemoveTile && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveTile(tile.sessionId) }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="p-1 rounded text-ax-text-ghost hover:text-ax-error hover:bg-ax-sunken transition-colors"
                        title="Remove from canvas"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {/* Title */}
                  <div className="px-3 pt-2 pb-1 min-w-0">
                    {editingTileId === tile.sessionId ? (
                      <input
                        autoFocus
                        className="w-full font-serif italic text-[13px] text-ax-text-primary bg-transparent
                          border-b border-ax-brand outline-none px-0 py-0"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitRename(tile.sessionId, editValue)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(tile.sessionId, editValue)
                          if (e.key === 'Escape') setEditingTileId(null)
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5">
                        {session?.pinned && (
                          <Star size={10} className="text-ax-warning fill-current shrink-0" />
                        )}
                        <span className="font-serif italic text-[13px] text-ax-text-primary truncate">
                          {session?.nickname || session?.first_prompt || 'Untitled'}
                        </span>
                      </div>
                    )}
                    {!editingTileId && session?.heuristic_summary && (
                      <p className="text-[10px] text-ax-text-tertiary mt-0.5 line-clamp-2">
                        {session.heuristic_summary}
                      </p>
                    )}
                  </div>

                  {/* Heat strip */}
                  <div className="px-3 pb-1 mt-auto">
                    <MiniHeatStrip json={session?.heatstrip_json || null} />
                  </div>

                  {/* Footer stats */}
                  <div className="px-3 pb-2 flex items-center gap-2 text-[9px] font-mono text-ax-text-ghost">
                    {session?.modified_at && <span>{timeAgo(session.modified_at)}</span>}
                    {session && session.message_count > 0 && <span>{session.message_count} msgs</span>}
                    {session && session.tool_call_count > 0 && <span>{session.tool_call_count} tools</span>}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* HUD — bottom-right: New Session, Reorganize, Fit, Zoom */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1">
        {activeProject && !reorgActive && (
          <button
            onClick={() => {
              const container = containerRef.current
              if (!container || !activeProject) return
              const { width, height } = container.getBoundingClientRect()
              const v = viewportRef.current
              const wx = snap((width / 2 - v.x) / v.scale - TILE_EXPANDED_W / 2)
              const wy = snap((height / 2 - v.y) / v.scale - TILE_EXPANDED_H / 2)
              const spawnTime = Date.now()
              const newId = `new-${spawnTime}`
              dispatchTiles({ type: 'ADD', sessionId: newId, x: wx, y: wy })
              dispatchTiles({ type: 'RESIZE', sessionId: newId, width: TILE_EXPANDED_W, height: TILE_EXPANDED_H })
              useTerminalStore.getState().spawn(activeProject).then(tid => {
                useTerminalStore.getState().expandCanvasTile(newId, tid)
                immediateSave()
                detectSessionId(newId, spawnTime)
              })
            }}
            className="text-ax-text-ghost hover:text-ax-text-secondary bg-ax-elevated/80
              backdrop-blur px-1.5 py-1 rounded transition-colors"
            title="New Claude session"
          >
            <Plus size={12} />
          </button>
        )}
        {!reorgActive && tiles.length > 0 && (
          <button
            onClick={onReorganize}
            className="text-ax-text-ghost hover:text-ax-text-secondary bg-ax-elevated/80
              backdrop-blur px-1.5 py-1 rounded transition-colors"
            title="Reorganize by recency"
          >
            <RefreshCw size={12} />
          </button>
        )}
        <button
          onClick={fitAll}
          className="text-ax-text-ghost hover:text-ax-text-secondary bg-ax-elevated/80
            backdrop-blur px-1.5 py-1 rounded transition-colors"
          title="Fit all"
        >
          <Maximize2 size={12} />
        </button>
        <span
          ref={zoomTextRef}
          className="font-mono text-[10px] text-ax-text-ghost bg-ax-elevated/80
            backdrop-blur px-2 py-1 rounded"
        >
          {Math.round(viewport.scale * 100)}%
        </span>
      </div>

      {/* Reorg confirmation bar — bottom-center */}
      {reorgActive && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 canvas-reorg-bar
          flex items-center gap-3 px-4 py-2 rounded-xl
          bg-ax-elevated/90 backdrop-blur-md border border-ax-border
          shadow-lg">
          <span className="font-mono text-[10px] text-ax-text-secondary uppercase tracking-wider">
            Reorganize preview
          </span>
          <button
            onClick={onReorgApply}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-mono
              bg-ax-brand text-white hover:bg-ax-brand-hover transition-colors"
          >
            <Check size={10} />
            Apply
          </button>
          <button
            onClick={onReorgCancel}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-mono
              text-ax-text-tertiary hover:text-ax-text-secondary bg-ax-sunken
              hover:bg-ax-border-subtle transition-colors"
          >
            <X size={10} />
            Cancel
          </button>
          <span className="text-[9px] font-mono text-ax-text-ghost">Esc</span>
        </div>
      )}

      {/* Empty state */}
      {tiles.length === 0 && zones.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="text-micro text-ax-text-tertiary mb-1">
              No canvas layout yet
            </p>
            <p className="text-[11px] text-ax-text-ghost max-w-xs">
              Create zones in the sidebar to organize your sessions
            </p>
          </div>
        </div>
      )}

      {/* Fullscreen terminal overlay (mobile) */}
      {fullscreenTerminalId && (
        <FullscreenTerminal
          terminalId={fullscreenTerminalId}
          onClose={() => setFullscreenTerminalId(null)}
        />
      )}
    </div>
  )
}
