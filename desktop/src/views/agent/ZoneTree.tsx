import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { ChevronRight, Plus, X, GripVertical, Search, Star, Tag } from 'lucide-react'
import type { TileState, ZoneState } from './zoneReducers'
import type { SessionSummary } from '@/hooks/useSessions'

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

interface ZoneTreeProps {
  sessions: SessionSummary[]
  tiles: TileState[]
  zones: ZoneState[]
  createZone: () => string
  renameZone: (id: string, label: string) => void
  deleteZone: (id: string) => void
  assignTileZone: (sessionId: string, zoneId: string | null) => void
  addTile: (sessionId: string, x: number, y: number) => void
  removeTile: (sessionId: string) => void
}

export function ZoneTree({
  sessions, tiles, zones,
  createZone, renameZone, deleteZone, assignTileZone,
  addTile, removeTile,
}: ZoneTreeProps) {
  // Start with all zones collapsed — keep collapsing new zones as they load
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(zones.map(z => z.id)))
  const knownZoneIdsRef = useRef(new Set(zones.map(z => z.id)))
  useEffect(() => {
    const newIds = zones.filter(z => !knownZoneIdsRef.current.has(z.id)).map(z => z.id)
    if (newIds.length > 0) {
      setCollapsed(prev => {
        const next = new Set(prev)
        for (const id of newIds) next.add(id)
        return next
      })
      for (const id of newIds) knownZoneIdsRef.current.add(id)
    }
  }, [zones])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dragOverZoneId, setDragOverZoneId] = useState<string | null>(null)
  const [availableOpen, setAvailableOpen] = useState(true)
  const [availableSearch, setAvailableSearch] = useState('')
  const [availableFilter, setAvailableFilter] = useState<'all' | 'starred' | 'tagged'>('all')
  const editInputRef = useRef<HTMLInputElement>(null)

  const sessionMap = new Map(sessions.map(s => [s.id, s]))
  const tileSessionIds = useMemo(() => new Set(tiles.map(t => t.sessionId)), [tiles])

  // Sessions not yet on the canvas
  const availableSessions = useMemo(() => {
    let list = sessions.filter(s => !tileSessionIds.has(s.id))
    if (availableFilter === 'starred') list = list.filter(s => s.pinned)
    if (availableFilter === 'tagged') list = list.filter(s => s.tags && s.tags.length > 0)
    if (!availableSearch.trim()) return list
    const q = availableSearch.toLowerCase()
    return list.filter(s =>
      (s.nickname || '').toLowerCase().includes(q) ||
      (s.first_prompt || '').toLowerCase().includes(q)
    )
  }, [sessions, tileSessionIds, availableSearch, availableFilter])

  const toggleCollapse = useCallback((zoneId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(zoneId)) next.delete(zoneId)
      else next.add(zoneId)
      return next
    })
  }, [])

  const handleRename = useCallback((zoneId: string, label: string) => {
    renameZone(zoneId, label.trim())
    setEditingId(null)
  }, [renameZone])

  // Drag handlers for session reassignment
  const handleSessionDragStart = useCallback((e: React.DragEvent, sessionId: string) => {
    e.dataTransfer.setData('text/plain', sessionId)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleZoneDragOver = useCallback((e: React.DragEvent, zoneId: string | null) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverZoneId(zoneId)
  }, [])

  const handleZoneDrop = useCallback((e: React.DragEvent, zoneId: string | null) => {
    e.preventDefault()
    const sessionId = e.dataTransfer.getData('text/plain')
    if (sessionId) assignTileZone(sessionId, zoneId)
    setDragOverZoneId(null)
  }, [assignTileZone])

  const handleDragLeave = useCallback(() => setDragOverZoneId(null), [])

  const handleAddToCanvas = useCallback((sessionId: string) => {
    // Place at a staggered position based on current tile count
    const offset = tiles.length
    const cols = Math.max(1, Math.ceil(Math.sqrt(offset + 1)))
    const x = (offset % cols) * 280
    const y = Math.floor(offset / cols) * 200
    addTile(sessionId, x, y)
  }, [tiles.length, addTile])

  // Build zone tree
  const rootZones = zones
    .filter(z => !z.parentZoneId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const getChildZones = (parentId: string) =>
    zones.filter(z => z.parentZoneId === parentId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const getZoneTiles = (zoneId: string) =>
    tiles.filter(t => t.zoneId === zoneId)

  const unzonedTiles = tiles.filter(t => !t.zoneId)

  const renderSession = (tile: TileState, depth: number) => {
    const session = sessionMap.get(tile.sessionId)
    const title = session?.nickname || session?.first_prompt || 'Untitled'

    return (
      <div
        key={tile.sessionId}
        draggable
        onDragStart={(e) => handleSessionDragStart(e, tile.sessionId)}
        className="flex items-center gap-1.5 h-[22px] px-2 cursor-grab
          hover:bg-[var(--ax-text-primary)]/[0.06] transition-colors group"
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        <GripVertical size={8} className="text-ax-text-ghost opacity-0 group-hover:opacity-100 shrink-0" />
        <span className="text-[11px] text-ax-text-secondary truncate flex-1">
          {title}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); removeTile(tile.sessionId) }}
          className="opacity-0 group-hover:opacity-100 text-ax-text-ghost hover:text-ax-error transition-all shrink-0"
          title="Remove from canvas"
        >
          <X size={8} />
        </button>
        {session?.modified_at && (
          <span className="text-[9px] font-mono text-ax-text-ghost shrink-0">
            {timeAgo(session.modified_at)}
          </span>
        )}
      </div>
    )
  }

  const renderZone = (zone: ZoneState, depth: number) => {
    const isCollapsed = collapsed.has(zone.id)
    const isEditing = editingId === zone.id
    const isDragOver = dragOverZoneId === zone.id
    const zoneTiles = getZoneTiles(zone.id)
    const childZones = getChildZones(zone.id)
    const totalTiles = zoneTiles.length + childZones.reduce(
      (sum, cz) => sum + tiles.filter(t => t.zoneId === cz.id).length, 0
    )

    return (
      <div key={zone.id}>
        {/* Zone header row */}
        <div
          className={`flex items-center gap-1 h-[22px] px-2 cursor-pointer group transition-colors
            ${isDragOver ? 'bg-[var(--ax-text-primary)]/[0.12]' : 'hover:bg-[var(--ax-text-primary)]/[0.06]'}`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => toggleCollapse(zone.id)}
          onDragOver={(e) => handleZoneDragOver(e, zone.id)}
          onDrop={(e) => handleZoneDrop(e, zone.id)}
          onDragLeave={handleDragLeave}
        >
          <ChevronRight
            size={10}
            className={`text-ax-text-ghost shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
          />
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: zone.color }}
          />
          {isEditing ? (
            <input
              ref={editInputRef}
              defaultValue={zone.label}
              className="text-[11px] font-mono uppercase tracking-[0.06em] bg-transparent
                text-ax-text-primary outline-none border-b border-ax-brand w-full"
              autoFocus
              onBlur={(e) => handleRename(zone.id, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(zone.id, (e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setEditingId(null)
              }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-[11px] font-mono uppercase tracking-[0.06em] text-ax-text-secondary truncate flex-1"
              onDoubleClick={(e) => { e.stopPropagation(); setEditingId(zone.id) }}
            >
              {zone.label}
            </span>
          )}
          {totalTiles > 0 && (
            <span className="text-[9px] font-mono text-ax-text-ghost shrink-0">
              {totalTiles}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); deleteZone(zone.id) }}
            className="opacity-0 group-hover:opacity-100 text-ax-text-ghost hover:text-ax-error transition-all shrink-0"
          >
            <X size={10} />
          </button>
        </div>

        {/* Children (tiles + nested zones) */}
        {!isCollapsed && (
          <>
            {childZones.map(cz => renderZone(cz, depth + 1))}
            {zoneTiles.map(t => renderSession(t, depth + 1))}
          </>
        )}
      </div>
    )
  }

  const totalAvailable = sessions.length - tileSessionIds.size

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-ax-border-subtle">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ax-text-tertiary">
          Zones
        </span>
        <button
          onClick={() => createZone()}
          className="flex items-center gap-1 text-[10px] font-mono text-ax-text-tertiary
            hover:text-ax-text-primary transition-colors"
        >
          <Plus size={10} />
          New
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-hide">
        {rootZones.map(z => renderZone(z, 0))}

        {/* Unzoned section */}
        {unzonedTiles.length > 0 && (
          <>
            <div
              className={`flex items-center gap-1.5 h-[22px] px-2 mt-1 transition-colors
                ${dragOverZoneId === '__unzoned' ? 'bg-[var(--ax-text-primary)]/[0.12]' : ''}`}
              onDragOver={(e) => handleZoneDragOver(e, '__unzoned')}
              onDrop={(e) => {
                e.preventDefault()
                const sessionId = e.dataTransfer.getData('text/plain')
                if (sessionId) assignTileZone(sessionId, null)
                setDragOverZoneId(null)
              }}
              onDragLeave={handleDragLeave}
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ax-text-ghost px-1">
                Unzoned
              </span>
              <span className="text-[9px] font-mono text-ax-text-ghost">
                {unzonedTiles.length}
              </span>
            </div>
            {unzonedTiles.map(t => renderSession(t, 0))}
          </>
        )}

        {/* Empty state */}
        {zones.length === 0 && tiles.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] text-ax-text-ghost">
              No zones yet. Create one to organize sessions.
            </p>
          </div>
        )}
      </div>

      {/* Available sessions — not yet on canvas */}
      {totalAvailable > 0 && (
        <div className="shrink-0 border-t border-ax-border-subtle">
          <button
            onClick={() => setAvailableOpen(o => !o)}
            className="flex items-center gap-1.5 w-full px-3 py-2
              hover:bg-[var(--ax-text-primary)]/[0.04] transition-colors"
          >
            <ChevronRight
              size={10}
              className={`text-ax-text-ghost shrink-0 transition-transform duration-150 ${availableOpen ? 'rotate-90' : ''}`}
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ax-text-tertiary">
              Available
            </span>
            <span className="text-[9px] font-mono text-ax-text-ghost ml-auto">
              {totalAvailable}
            </span>
          </button>

          {availableOpen && (
            <div className="min-h-[20vh] max-h-[30vh] overflow-y-auto scrollbar-hide pb-1">
              {/* Filter pills + search */}
              <div className="px-2 pb-1.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  {(['all', 'starred', 'tagged'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setAvailableFilter(f)}
                      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors
                        ${availableFilter === f
                          ? 'bg-ax-brand-subtle text-ax-brand'
                          : 'text-ax-text-ghost hover:text-ax-text-tertiary'
                        }`}
                    >
                      {f === 'starred' && <Star size={8} className={availableFilter === f ? 'fill-current' : ''} />}
                      {f === 'tagged' && <Tag size={8} />}
                      {f === 'all' ? 'All' : f === 'starred' ? 'Starred' : 'Tagged'}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-ax-text-ghost" />
                  <input
                    type="text"
                    value={availableSearch}
                    onChange={(e) => setAvailableSearch(e.target.value)}
                    placeholder="Filter sessions..."
                    className="w-full bg-ax-sunken border border-ax-border-subtle rounded pl-6 pr-2 py-1
                      text-[10px] text-ax-text-primary placeholder-ax-text-ghost
                      focus:outline-none focus:border-ax-brand/40 transition-colors"
                  />
                </div>
              </div>

              {availableSessions.slice(0, 50).map(s => {
                const title = s.nickname || s.first_prompt || 'Untitled'
                return (
                  <div
                    key={s.id}
                    className="flex items-center gap-1 h-[24px] px-2 group
                      hover:bg-[var(--ax-text-primary)]/[0.06] transition-colors cursor-pointer"
                    style={{ paddingLeft: '12px' }}
                    onClick={() => handleAddToCanvas(s.id)}
                  >
                    {s.pinned && <Star size={8} className="text-ax-warning fill-current shrink-0" />}
                    <span className="text-[11px] text-ax-text-tertiary truncate flex-1
                      group-hover:text-ax-text-secondary transition-colors">
                      {title}
                    </span>
                    <span className="opacity-0 group-hover:opacity-100 text-[9px] font-mono
                      text-ax-brand shrink-0 transition-opacity">
                      + add
                    </span>
                  </div>
                )
              })}

              {availableSessions.length === 0 && (
                <p className="text-[10px] text-ax-text-ghost px-3 py-2 text-center">
                  {availableSearch || availableFilter !== 'all' ? 'No matches' : 'All sessions on canvas'}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
