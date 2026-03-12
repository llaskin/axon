import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { Maximize2, Star, RefreshCw, Check, X } from 'lucide-react'
import {
  GRID, TILE_W, TILE_H,
  snap, getZoneDepth, getDescendantZoneIds,
  computeZoneLayouts,
  type TileState, type ZoneState, type TileAction, type ZoneAction, type ZoneLayout,
} from './zoneReducers'
import type { Viewport } from './useCanvasState'
import type { SessionSummary } from '@/hooks/useSessions'

/* ── Constants ─────────────────────────────────────────────────── */

const MIN_SCALE = 0.08
const MAX_SCALE = 3
const DRAG_THRESHOLD = 4

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
}

/* ── Component ─────────────────────────────────────────────────── */

export function CanvasView({
  sessions, tiles, zones, viewport,
  zoneLayouts, tilePositionMap,
  dispatchTiles, dispatchZones, setViewport,
  scheduleSave, immediateSave,
  reorgActive, onReorganize, onReorgApply, onReorgCancel,
}: CanvasViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef(viewport)
  const rafRef = useRef(0)
  const zoomTextRef = useRef<HTMLSpanElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverZoneId, setHoverZoneId] = useState<string | null>(null)
  const [droppedTileId, setDroppedTileId] = useState<string | null>(null)
  const [flashZoneId, setFlashZoneId] = useState<string | null>(null)

  // Keep ref synced
  viewportRef.current = viewport

  const sessionMap = useMemo(
    () => new Map(sessions.map(s => [s.id, s])),
    [sessions]
  )

  // Scale class for detail level
  const [scaleClass, setScaleClass] = useState<'full' | 'thumb' | 'dot'>(() =>
    viewport.scale > 0.4 ? 'full' : viewport.scale > 0.15 ? 'thumb' : 'dot'
  )
  const scaleClassRef = useRef(scaleClass)

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
    type: 'pan' | 'tile' | 'zone'
    startMouseX: number
    startMouseY: number
    startVpX: number
    startVpY: number
    targetId?: string
    startX: number
    startY: number
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
        }
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      setIsDragging(false)
      setHoverZoneId(null)

      if (d.hasMoved) {
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
        } else if (d.type === 'zone') {
          immediateSave()
        } else if (d.type === 'pan') {
          setViewport({ ...viewportRef.current })
          scheduleSave()
        }
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [zones, tiles, applyViewport, dispatchTiles, dispatchZones,
      setViewport, scheduleSave, immediateSave, findZoneAtWorldPoint])

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

  /* ── Render ───────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 relative overflow-hidden"
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
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
              {/* Zone header — drag handle */}
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
                <span className="font-mono text-[10px] uppercase tracking-wider text-ax-text-secondary truncate">
                  {zone.label}
                </span>
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

          if (scaleClass === 'dot') {
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

          if (scaleClass === 'thumb') {
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

          // Full mode — detailed card
          return (
            <div
              key={tile.sessionId}
              data-tile-id={tile.sessionId}
              className={`absolute bg-ax-elevated rounded-lg border border-ax-border
                cursor-grab overflow-hidden flex flex-col canvas-tile
                ${isDropped ? 'canvas-tile-dropped' : ''}
                ${reorgActive ? 'canvas-reorg-transition' : ''}`}
              style={{
                left: pos.x, top: pos.y, width: tile.width, height: tile.height,
                borderColor: zone ? `color-mix(in srgb, ${zone.color} 20%, var(--ax-border))` : undefined,
              }}
            >
              {/* Zone accent line */}
              {zone && (
                <div className="h-[2px] w-full shrink-0" style={{ backgroundColor: zone.color }} />
              )}

              {/* Title */}
              <div className="px-3 pt-2 pb-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {session?.pinned && (
                    <Star size={10} className="text-ax-warning fill-current shrink-0" />
                  )}
                  <span className="font-serif italic text-[13px] text-ax-text-primary truncate">
                    {session?.nickname || session?.first_prompt || 'Untitled'}
                  </span>
                </div>
                {session?.heuristic_summary && (
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
            </div>
          )
        })}
      </div>

      {/* HUD — bottom-right: Reorganize, Fit, Zoom */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1">
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
    </div>
  )
}
