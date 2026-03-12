import { useReducer, useCallback, useEffect, useRef, useState, useMemo } from 'react'
import {
  tilesReducer, zonesReducer,
  computeZoneLayouts, computeTilePositionMap, computeCompactLayout,
  ZONE_COLORS, snap, TILE_W, TILE_H, ZONE_MIN_W, ZONE_MIN_H,
  type TileState, type ZoneState,
} from './zoneReducers'
import type { SessionSummary } from '@/hooks/useSessions'

export interface Viewport { x: number; y: number; scale: number }

export function useCanvasState(projectName: string | null) {
  const [tiles, dispatchTiles] = useReducer(tilesReducer, [])
  const [zones, dispatchZones] = useReducer(zonesReducer, [])
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 })
  const [loaded, setLoaded] = useState(false)
  const [reorgActive, setReorgActive] = useState(false)
  const reorgSnapshotRef = useRef<{ tiles: TileState[]; zones: ZoneState[] } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tilesRef = useRef(tiles)
  const zonesRef = useRef(zones)
  const viewportRef = useRef(viewport)
  const savedTileCountRef = useRef(0)
  const projectRef = useRef(projectName)

  tilesRef.current = tiles
  zonesRef.current = zones
  viewportRef.current = viewport
  projectRef.current = projectName

  // Load layout on mount / project change
  useEffect(() => {
    if (!projectName) return
    setLoaded(false)
    fetch(`/api/axon/canvas-layout?project=${encodeURIComponent(projectName)}`)
      .then(r => r.json())
      .then(data => {
        // Normalize tile dimensions to current constants (handles old 240x160 tiles)
        const loadedTiles = (data.tiles || []).map((t: TileState) => ({
          ...t, width: TILE_W, height: TILE_H,
        }))
        dispatchTiles({ type: 'SET_ALL', tiles: loadedTiles })
        dispatchZones({ type: 'SET_ALL', zones: data.zones || [] })
        if (data.viewport) setViewport(data.viewport)
        savedTileCountRef.current = (data.tiles || []).length
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [projectName])

  // Save function (skipped during reorg preview)
  const reorgActiveRef = useRef(false)
  reorgActiveRef.current = reorgActive

  const save = useCallback(() => {
    if (reorgActiveRef.current) return
    const project = projectRef.current
    if (!project) return
    const t = tilesRef.current
    const z = zonesRef.current
    const v = viewportRef.current
    if (t.length === 0 && z.length === 0) return
    // Safety: never overwrite populated layout with empty
    if (t.length === 0 && savedTileCountRef.current > 0) return
    savedTileCountRef.current = Math.max(savedTileCountRef.current, t.length)

    fetch(`/api/axon/canvas-layout?project=${encodeURIComponent(project)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tiles: t, zones: z, viewport: v }),
    }).catch(console.error)
  }, [])

  // Debounced save (2s) for drags
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(save, 2000)
  }, [save])

  // Immediate save for structural changes
  const immediateSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    requestAnimationFrame(() => save())
  }, [save])

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        save()
      }
    }
  }, [save])

  // Computed layouts
  const zoneLayouts = useMemo(
    () => computeZoneLayouts(zones, tiles),
    [zones, tiles]
  )
  const tilePositionMap = useMemo(
    () => computeTilePositionMap(tiles, zoneLayouts),
    [tiles, zoneLayouts]
  )

  // Auto-layout for first-time canvas (no saved layout)
  const autoLayout = useCallback((sessions: SessionSummary[]) => {
    const significant = sessions.filter(s =>
      s.pinned || (s.tags && s.tags.length > 0) ||
      s.tool_call_count > 10 || s.message_count > 20
    )
    const toPlace = significant.length > 0 ? significant : sessions.slice(0, 20)
    if (toPlace.length === 0) return
    const gap = 40
    const cols = Math.max(1, Math.ceil(Math.sqrt(toPlace.length)))

    const newTiles: TileState[] = toPlace.map((s, i) => ({
      sessionId: s.id,
      x: (i % cols) * (TILE_W + gap),
      y: Math.floor(i / cols) * (TILE_H + gap),
      width: TILE_W,
      height: TILE_H,
    }))
    dispatchTiles({ type: 'SET_ALL', tiles: newTiles })
    immediateSave()
  }, [immediateSave])

  // Zone CRUD
  const createZone = useCallback((containerRef?: React.RefObject<HTMLDivElement | null>) => {
    const idx = zonesRef.current.length
    // Place zone at center of viewport if possible
    let zx = 100 + idx * 50
    let zy = 100 + idx * 50
    if (containerRef?.current) {
      const v = viewportRef.current
      const { width, height } = containerRef.current.getBoundingClientRect()
      zx = snap((width / 2 - v.x) / v.scale - ZONE_MIN_W / 2)
      zy = snap((height / 2 - v.y) / v.scale - ZONE_MIN_H / 2)
    }
    const zone: ZoneState = {
      id: `zone-${Date.now()}`,
      label: `Zone ${idx + 1}`,
      x: snap(zx),
      y: snap(zy),
      color: ZONE_COLORS[idx % ZONE_COLORS.length],
    }
    dispatchZones({ type: 'ADD', zone })
    immediateSave()
    return zone.id
  }, [immediateSave])

  const renameZone = useCallback((id: string, label: string) => {
    dispatchZones({ type: 'RENAME', id, label: label || 'Untitled' })
    immediateSave()
  }, [immediateSave])

  const deleteZone = useCallback((id: string) => {
    // Unassign tiles from this zone
    const zoneTiles = tilesRef.current.filter(t => t.zoneId === id)
    for (const tile of zoneTiles) {
      dispatchTiles({ type: 'ASSIGN_ZONE', sessionId: tile.sessionId, zoneId: null })
    }
    dispatchZones({ type: 'REMOVE', id })
    savedTileCountRef.current = Math.max(0, savedTileCountRef.current - zoneTiles.length)
    immediateSave()
  }, [immediateSave])

  const assignTileZone = useCallback((sessionId: string, zoneId: string | null) => {
    dispatchTiles({ type: 'ASSIGN_ZONE', sessionId, zoneId })
    immediateSave()
  }, [immediateSave])

  const addTile = useCallback((sessionId: string, x: number, y: number) => {
    dispatchTiles({ type: 'ADD', sessionId, x, y })
    immediateSave()
  }, [immediateSave])

  const removeTile = useCallback((sessionId: string) => {
    dispatchTiles({ type: 'REMOVE', sessionId })
    savedTileCountRef.current = Math.max(0, savedTileCountRef.current - 1)
    immediateSave()
  }, [immediateSave])

  // Reorganize / compaction preview
  const reorganize = useCallback((sessions: { id: string; modified_at: string | null }[]) => {
    const currentTiles = tilesRef.current
    const currentZones = zonesRef.current
    if (currentTiles.length === 0) return false
    // Snapshot for undo
    reorgSnapshotRef.current = {
      tiles: currentTiles.map(t => ({ ...t })),
      zones: currentZones.map(z => ({ ...z })),
    }
    const result = computeCompactLayout(currentZones, currentTiles, sessions)
    dispatchTiles({ type: 'SET_ALL', tiles: result.tiles })
    dispatchZones({ type: 'SET_ALL', zones: result.zones })
    setReorgActive(true)
    return true
  }, [])

  const applyReorg = useCallback(() => {
    reorgSnapshotRef.current = null
    setReorgActive(false)
    immediateSave()
  }, [immediateSave])

  const cancelReorg = useCallback(() => {
    const snap = reorgSnapshotRef.current
    if (snap) {
      dispatchTiles({ type: 'SET_ALL', tiles: snap.tiles })
      dispatchZones({ type: 'SET_ALL', zones: snap.zones })
    }
    reorgSnapshotRef.current = null
    setReorgActive(false)
  }, [])

  return {
    tiles, zones, viewport, loaded,
    dispatchTiles, dispatchZones, setViewport,
    zoneLayouts, tilePositionMap,
    scheduleSave, immediateSave, save,
    autoLayout,
    createZone, renameZone, deleteZone, assignTileZone,
    addTile, removeTile,
    reorgActive, reorganize, applyReorg, cancelReorg,
  }
}
