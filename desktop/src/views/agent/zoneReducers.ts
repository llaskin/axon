// Shared zone/tile types, reducers, helpers, and layout computation.
// Ported from AXON-release/app/src/renderer/src/lib/zoneReducers.ts
// Only change: ZONE_COLORS swapped to warm Axon palette.

// === Constants ===
export const GRID = 20
export const TILE_W = 200
export const TILE_H = 72
export const ZONE_PAD = 16
export const ZONE_GAP = 10
export const ZONE_HEADER_H = 32
export const ZONE_MIN_W = TILE_W + ZONE_PAD * 2
export const ZONE_MIN_H = ZONE_HEADER_H + TILE_H / 2 + ZONE_PAD
export const ZONE_COLORS = [
  '#C8956C', // copper (ax-brand)
  '#7B9E7B', // sage (ax-accent)
  '#6B8FAD', // steel (ax-info)
  '#C4933B', // amber (ax-warning)
  '#B85450', // brick (ax-error)
  '#8B7B6B', // warm gray
]

// === Types ===
export interface TileState {
  sessionId: string
  x: number
  y: number
  width: number
  height: number
  zoneId?: string | null
  order?: number
}

export interface ZoneState {
  id: string
  label: string
  x: number
  y: number
  color: string
  parentZoneId?: string | null
  order?: number
}

export type TileAction =
  | { type: 'SET_ALL'; tiles: TileState[] }
  | { type: 'MOVE'; sessionId: string; x: number; y: number }
  | { type: 'ADD'; sessionId: string; x: number; y: number }
  | { type: 'REMOVE'; sessionId: string }
  | { type: 'ASSIGN_ZONE'; sessionId: string; zoneId: string | null }
  | { type: 'REORDER'; updates: { sessionId: string; order: number }[] }

export type ZoneAction =
  | { type: 'SET_ALL'; zones: ZoneState[] }
  | { type: 'ADD'; zone: ZoneState }
  | { type: 'MOVE'; id: string; x: number; y: number }
  | { type: 'RENAME'; id: string; label: string }
  | { type: 'REMOVE'; id: string }
  | { type: 'REPARENT'; id: string; parentZoneId: string | null }
  | { type: 'REORDER'; updates: { id: string; order: number }[] }
  | { type: 'MOVE_DESCENDANTS'; id: string; dx: number; dy: number }

// === Helpers ===
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}

export function getZoneDepth(zoneId: string, zones: ZoneState[]): number {
  let depth = 0
  let current = zones.find((z) => z.id === zoneId)
  while (current?.parentZoneId) {
    depth++
    current = zones.find((z) => z.id === current!.parentZoneId)
    if (depth > 10) break // safety
  }
  return depth
}

export function getDescendantZoneIds(zoneId: string, zones: ZoneState[]): Set<string> {
  const result = new Set<string>()
  const collect = (parentId: string): void => {
    for (const z of zones) {
      if (z.parentZoneId === parentId && !result.has(z.id)) {
        result.add(z.id)
        collect(z.id)
      }
    }
  }
  collect(zoneId)
  return result
}

export function isAncestorOf(ancestorId: string, childId: string, zones: ZoneState[]): boolean {
  let current = zones.find((z) => z.id === childId)
  let depth = 0
  while (current?.parentZoneId && depth < 10) {
    if (current.parentZoneId === ancestorId) return true
    current = zones.find((z) => z.id === current!.parentZoneId)
    depth++
  }
  return false
}

// === Reducers ===
export function tilesReducer(state: TileState[], action: TileAction): TileState[] {
  switch (action.type) {
    case 'SET_ALL':
      return action.tiles
    case 'MOVE':
      return state.map((t) =>
        t.sessionId === action.sessionId
          ? { ...t, x: snap(action.x), y: snap(action.y) }
          : t
      )
    case 'ADD':
      if (state.some((t) => t.sessionId === action.sessionId)) return state
      return [
        ...state,
        {
          sessionId: action.sessionId,
          x: snap(action.x),
          y: snap(action.y),
          width: TILE_W,
          height: TILE_H
        }
      ]
    case 'REMOVE':
      return state.filter((t) => t.sessionId !== action.sessionId)
    case 'ASSIGN_ZONE':
      return state.map((t) =>
        t.sessionId === action.sessionId ? { ...t, zoneId: action.zoneId } : t
      )
    case 'REORDER': {
      const updateMap = new Map(action.updates.map(u => [u.sessionId, u.order]))
      return state.map(t => updateMap.has(t.sessionId) ? { ...t, order: updateMap.get(t.sessionId) } : t)
    }
    default:
      return state
  }
}

export function zonesReducer(state: ZoneState[], action: ZoneAction): ZoneState[] {
  switch (action.type) {
    case 'SET_ALL':
      return action.zones
    case 'ADD':
      return [...state, action.zone]
    case 'MOVE':
      return state.map((z) =>
        z.id === action.id ? { ...z, x: snap(action.x), y: snap(action.y) } : z
      )
    case 'RENAME':
      return state.map((z) =>
        z.id === action.id ? { ...z, label: action.label } : z
      )
    case 'REMOVE':
      // When removing a zone, promote its children to top-level
      return state
        .filter((z) => z.id !== action.id)
        .map((z) => z.parentZoneId === action.id ? { ...z, parentZoneId: null } : z)
    case 'REPARENT':
      return state.map((z) =>
        z.id === action.id ? { ...z, parentZoneId: action.parentZoneId } : z
      )
    case 'REORDER': {
      const updateMap = new Map(action.updates.map(u => [u.id, u.order]))
      return state.map(z => updateMap.has(z.id) ? { ...z, order: updateMap.get(z.id) } : z)
    }
    case 'MOVE_DESCENDANTS': {
      // Move all descendants of a zone by dx, dy
      const descendants = new Set<string>()
      const collectDescendants = (parentId: string): void => {
        for (const z of state) {
          if (z.parentZoneId === parentId && !descendants.has(z.id)) {
            descendants.add(z.id)
            collectDescendants(z.id)
          }
        }
      }
      collectDescendants(action.id)
      if (descendants.size === 0) return state
      return state.map((z) =>
        descendants.has(z.id)
          ? { ...z, x: snap(z.x + action.dx), y: snap(z.y + action.dy) }
          : z
      )
    }
    default:
      return state
  }
}

// === Zone layout computation ===
export interface ZoneLayout {
  width: number
  height: number
  tilePositions: Map<string, { x: number; y: number }>
}

export function computeZoneLayouts(
  zones: ZoneState[],
  tiles: TileState[]
): Map<string, ZoneLayout> {
  const layouts = new Map<string, ZoneLayout>()

  // Sort zones by depth (leaves first) so children are computed before parents
  const sortedZones = [...zones].sort(
    (a, b) => getZoneDepth(b.id, zones) - getZoneDepth(a.id, zones)
  )

  for (const zone of sortedZones) {
    const zoneTiles = tiles.filter((t) => t.zoneId === zone.id)
    const childZones = zones.filter((z) => z.parentZoneId === zone.id)

    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(zoneTiles.length))))
    const rows = Math.max(1, Math.ceil(zoneTiles.length / cols))

    const tilePositions = new Map<string, { x: number; y: number }>()
    zoneTiles.forEach((t, i) => {
      tilePositions.set(t.sessionId, {
        x: zone.x + ZONE_PAD + (i % cols) * (TILE_W + ZONE_GAP),
        y: zone.y + ZONE_HEADER_H + ZONE_PAD + Math.floor(i / cols) * (TILE_H + ZONE_GAP)
      })
    })

    // Base size from tiles
    let width =
      zoneTiles.length > 0
        ? cols * (TILE_W + ZONE_GAP) - ZONE_GAP + ZONE_PAD * 2
        : ZONE_MIN_W
    let height =
      zoneTiles.length > 0
        ? ZONE_HEADER_H + rows * (TILE_H + ZONE_GAP) - ZONE_GAP + ZONE_PAD * 2
        : ZONE_MIN_H

    // Expand to contain child zones
    if (childZones.length > 0) {
      let maxRight = zone.x + width
      let maxBottom = zone.y + height
      for (const child of childZones) {
        const childLayout = layouts.get(child.id)
        if (childLayout) {
          maxRight = Math.max(maxRight, child.x + childLayout.width + ZONE_PAD)
          maxBottom = Math.max(maxBottom, child.y + childLayout.height + ZONE_PAD)
        }
      }
      width = Math.max(width, maxRight - zone.x)
      height = Math.max(height, maxBottom - zone.y)
    }

    layouts.set(zone.id, { width, height, tilePositions })
  }

  return layouts
}

// === Canvas compaction / reorganize ===

const ZONE_FLOW_GAP = 32   // horizontal gap between zones in a column
const ROW_GAP = 40          // vertical gap between rows in a cluster
const GROUP_GAP = 100       // horizontal gap between recency clusters

type RecencyBucket = 'Active' | 'Recent' | 'Older'
const BUCKET_COLORS: Record<RecencyBucket, string> = {
  Active: '#C8956C',  // copper
  Recent: '#6B8FAD',  // steel
  Older: '#8B7B6B',   // warm gray
}
const BUCKET_ORDER: Record<RecencyBucket, number> = { Active: 0, Recent: 1, Older: 2 }

function classifyRecency(modifiedAt: string | null): RecencyBucket {
  if (!modifiedAt) return 'Older'
  const age = Date.now() - new Date(modifiedAt).getTime()
  if (age < 24 * 60 * 60 * 1000) return 'Active'
  if (age < 7 * 24 * 60 * 60 * 1000) return 'Recent'
  return 'Older'
}

export function computeCompactLayout(
  zones: ZoneState[],
  tiles: TileState[],
  sessions: { id: string; modified_at: string | null }[]
): { zones: ZoneState[]; tiles: TileState[] } {
  const sessionMap = new Map(sessions.map(s => [s.id, s]))

  // Deep-copy — preserve nesting
  const newZones = zones.map(z => ({ ...z }))
  const newTiles = tiles.map(t => ({
    ...t,
    width: TILE_W,
    height: TILE_H,
  }))

  // Save original root zone positions for delta computation
  const origPos = new Map(newZones.map(z => [z.id, { x: z.x, y: z.y }]))

  // Step 1: Auto-zone unzoned tiles by recency bucket
  const unzoned = newTiles.filter(t => !t.zoneId)
  if (unzoned.length > 0) {
    const buckets = new Map<RecencyBucket, TileState[]>()
    for (const tile of unzoned) {
      const session = sessionMap.get(tile.sessionId)
      const bucket = classifyRecency(session?.modified_at ?? null)
      if (!buckets.has(bucket)) buckets.set(bucket, [])
      buckets.get(bucket)!.push(tile)
    }
    const ts = Date.now()
    for (const [bucket, bTiles] of buckets) {
      const zoneId = `zone-auto-${bucket.toLowerCase()}-${ts}`
      newZones.push({
        id: zoneId,
        label: bucket,
        x: 0, y: 0,
        color: BUCKET_COLORS[bucket],
      })
      for (const tile of bTiles) {
        tile.zoneId = zoneId
      }
    }
  }

  // Step 2: Recursive recency — a zone's recency = max modified_at across
  //         all tiles in it AND all descendant zones
  function getRecursiveMaxTime(zoneId: string): string {
    let maxTime = ''
    for (const tile of newTiles) {
      if (tile.zoneId === zoneId) {
        const mt = sessionMap.get(tile.sessionId)?.modified_at || ''
        if (mt > maxTime) maxTime = mt
      }
    }
    for (const z of newZones) {
      if (z.parentZoneId === zoneId) {
        const childMax = getRecursiveMaxTime(z.id)
        if (childMax > maxTime) maxTime = childMax
      }
    }
    return maxTime
  }

  const zoneRecency = new Map<string, { bucket: RecencyBucket; maxTime: string }>()
  for (const zone of newZones) {
    const maxTime = getRecursiveMaxTime(zone.id)
    zoneRecency.set(zone.id, {
      bucket: classifyRecency(maxTime || null),
      maxTime,
    })
  }

  // Step 3: Only position root zones (children move with their parent)
  const rootZones = newZones.filter(z => !z.parentZoneId)
  rootZones.sort((a, b) => {
    const ra = zoneRecency.get(a.id)!
    const rb = zoneRecency.get(b.id)!
    const bucketDiff = BUCKET_ORDER[ra.bucket] - BUCKET_ORDER[rb.bucket]
    if (bucketDiff !== 0) return bucketDiff
    return rb.maxTime.localeCompare(ra.maxTime)
  })

  // Step 4: Compute accurate root zone sizes (accounts for children)
  const layouts = computeZoneLayouts(newZones, newTiles)
  const zoneSizes = new Map<string, { width: number; height: number }>()
  for (const zone of rootZones) {
    const layout = layouts.get(zone.id)
    zoneSizes.set(zone.id, layout
      ? { width: layout.width, height: layout.height }
      : { width: ZONE_MIN_W, height: ZONE_MIN_H })
  }

  // Step 5: Cluster layout — recency buckets as side-by-side columns
  //         [Active cluster] [Recent cluster] [Older cluster]
  const bucketGroups = new Map<RecencyBucket, ZoneState[]>()
  for (const zone of rootZones) {
    const r = zoneRecency.get(zone.id)!
    if (!bucketGroups.has(r.bucket)) bucketGroups.set(r.bucket, [])
    bucketGroups.get(r.bucket)!.push(zone)
  }

  let clusterX = 0
  for (const bucket of ['Active', 'Recent', 'Older'] as RecencyBucket[]) {
    const group = bucketGroups.get(bucket)
    if (!group || group.length === 0) continue

    const MAX_CLUSTER_HEIGHT = 1200
    let colX = clusterX
    let cursorY = 0
    let colMaxWidth = 0
    let clusterMaxRight = clusterX

    for (const zone of group) {
      const size = zoneSizes.get(zone.id)!

      // Wrap to a new internal column if too tall
      if (cursorY > 0 && cursorY + size.height > MAX_CLUSTER_HEIGHT) {
        colX += colMaxWidth + ZONE_FLOW_GAP
        cursorY = 0
        colMaxWidth = 0
      }

      zone.x = snap(colX)
      zone.y = snap(cursorY)
      cursorY += size.height + ROW_GAP
      colMaxWidth = Math.max(colMaxWidth, size.width)
      clusterMaxRight = Math.max(clusterMaxRight, colX + size.width)
    }

    clusterX = clusterMaxRight + GROUP_GAP
  }

  // Step 6: Move descendant zones by their root's delta
  for (const root of rootZones) {
    const orig = origPos.get(root.id)
    if (!orig) continue
    const dx = root.x - orig.x
    const dy = root.y - orig.y
    if (dx === 0 && dy === 0) continue
    const descendants = getDescendantZoneIds(root.id, newZones)
    for (const descId of descendants) {
      const desc = newZones.find(z => z.id === descId)
      if (desc) {
        desc.x = snap(desc.x + dx)
        desc.y = snap(desc.y + dy)
      }
    }
  }

  return { zones: newZones, tiles: newTiles }
}

export function computeTilePositionMap(
  tiles: TileState[],
  zoneLayouts: Map<string, ZoneLayout>
): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>()

  for (const tile of tiles) {
    if (tile.zoneId) {
      const layout = zoneLayouts.get(tile.zoneId)
      if (layout) {
        const pos = layout.tilePositions.get(tile.sessionId)
        if (pos) {
          map.set(tile.sessionId, pos)
          continue
        }
      }
    }
    // Free tile or fallback
    map.set(tile.sessionId, { x: tile.x, y: tile.y })
  }

  return map
}
