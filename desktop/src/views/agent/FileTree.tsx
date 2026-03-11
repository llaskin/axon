import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, GitBranch, AtSign } from 'lucide-react'
import { getFileIcon } from './fileIcons'

interface FileEntry {
  name: string
  type: 'dir' | 'file'
  path: string
}

interface DirNode {
  entries: FileEntry[]
  loaded: boolean
  open: boolean
}

/* ── Git status types ─────────────────────────────────────────── */

type GitStatus = 'M' | 'A' | 'D' | 'R' | 'U' // modified, added, deleted, renamed, untracked
type GitMap = Record<string, GitStatus>

const GIT_COLOR: Record<GitStatus, string> = {
  M: 'var(--ax-warning)',      // modified — amber
  A: 'var(--ax-success)',      // added — green
  D: 'var(--ax-error)',        // deleted — red
  R: 'var(--ax-info)',         // renamed — blue
  U: 'var(--ax-accent)',       // untracked — green-grey
}
const GIT_LABEL: Record<GitStatus, string> = {
  M: 'M', A: 'A', D: 'D', R: 'R', U: 'U',
}
const GIT_GROUP_LABEL: Record<GitStatus, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Untracked',
}

/* ── Folder icon (SVG) ────────────────────────────────────────── */

function FolderIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
        <path d="M1.5 3h4l1.5 1.5H14.5v1H3l-2 7V3z" fill="var(--ax-brand-primary)" fillOpacity="0.7" />
        <path d="M1 12l2-7h12l-2 7H1z" fill="var(--ax-brand-primary)" fillOpacity="0.45" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="shrink-0">
      <path d="M1.5 3h4l1.5 1.5H14.5V13h-13V3z" fill="var(--ax-brand-primary)" fillOpacity="0.55" />
    </svg>
  )
}

/* ── Helper: precompute which directories contain changes ─────── */

function buildDirChangeMap(gitFiles: GitMap): Map<string, GitStatus> {
  const map = new Map<string, GitStatus>()
  for (const [fp, status] of Object.entries(gitFiles)) {
    const parts = fp.split('/')
    // Walk up the path: a/b/c.ts → mark 'a/b', 'a'
    for (let i = parts.length - 1; i > 0; i--) {
      const dir = parts.slice(0, i).join('/')
      if (map.has(dir)) break // already marked by an earlier file
      map.set(dir, status)
    }
  }
  return map
}

/* ── FileTree root ────────────────────────────────────────────── */

export function FileTree({ project, onFileReference }: { project: string; onFileReference?: (path: string) => void }) {
  const [tree, setTree] = useState<Map<string, DirNode>>(new Map())
  const [root, setRoot] = useState('')
  const [gitFiles, setGitFiles] = useState<GitMap>({})
  const [showGit, setShowGit] = useState(true)
  const [scOpen, setScOpen] = useState(true) // source control panel
  const [scHeight, setScHeight] = useState(180) // draggable source control height
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  const loadDir = useCallback(async (path: string) => {
    try {
      const url = `/api/axon/filetree?project=${encodeURIComponent(project)}${path ? `&path=${encodeURIComponent(path)}` : ''}`
      const res = await fetch(url)
      const data = await res.json() as { root: string; items: FileEntry[] }
      if (!path) setRoot(data.root)
      setTree(prev => {
        const next = new Map(prev)
        next.set(path, { entries: data.items, loaded: true, open: true })
        return next
      })
    } catch { /* ignore */ }
  }, [project])

  const loadGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/axon/gitstatus?project=${encodeURIComponent(project)}`)
      const data = await res.json() as { files: GitMap }
      setGitFiles(data.files)
    } catch { setGitFiles({}) }
  }, [project])

  useEffect(() => {
    setTree(new Map())
    loadDir('')
    loadGitStatus()
  }, [project, loadDir, loadGitStatus])

  const toggle = useCallback((path: string) => {
    setTree(prev => {
      const next = new Map(prev)
      const node = next.get(path)
      if (node) {
        next.set(path, { ...node, open: !node.open })
      } else {
        loadDir(path)
      }
      return next
    })
  }, [loadDir])

  const rootNode = tree.get('')
  const changedCount = Object.keys(gitFiles).length

  // Precompute directory → status map (O(n) once, not O(n) per directory)
  const dirChangeMap = useMemo(() => buildDirChangeMap(gitFiles), [gitFiles])

  // Group changed files by status for the source control panel
  const gitGroups = useMemo(() => {
    const groups: Partial<Record<GitStatus, string[]>> = {}
    for (const [fp, status] of Object.entries(gitFiles)) {
      if (!groups[status]) groups[status] = []
      groups[status]!.push(fp)
    }
    for (const files of Object.values(groups)) files?.sort()
    return groups
  }, [gitFiles])

  return (
    <div className="flex flex-col h-full select-none">
      {/* Section header */}
      <div className="flex items-center h-9 shrink-0 px-4 border-b border-[var(--ax-border)]">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ax-text-secondary flex-1 truncate">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          {/* Git status toggle */}
          <button
            onClick={() => setShowGit(g => !g)}
            className={`w-5 h-5 flex items-center justify-center rounded transition-colors
              ${showGit
                ? 'text-ax-accent hover:text-ax-accent-hover bg-[var(--ax-text-primary)]/[0.06]'
                : 'text-ax-text-ghost hover:text-ax-text-tertiary'
              } hover:bg-[var(--ax-text-primary)]/[0.06]`}
            aria-label={showGit ? 'Hide git status' : 'Show git status'}
            title="Toggle git status"
          >
            <GitBranch size={13} />
          </button>
          <button
            onClick={() => { setTree(new Map()); loadDir(''); loadGitStatus() }}
            className="w-5 h-5 flex items-center justify-center rounded
              text-ax-text-ghost hover:text-ax-text-tertiary hover:bg-[var(--ax-text-primary)]/[0.06] transition-colors"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Collapsible root section */}
      <button
        className="flex items-center h-[22px] px-2 w-full text-left
          hover:bg-[var(--ax-text-primary)]/[0.06] font-semibold"
        onClick={() => {
          const r = tree.get('')
          if (r) setTree(prev => { const n = new Map(prev); n.set('', { ...r, open: !r.open }); return n })
        }}
      >
        <ChevronDown size={12} className="text-ax-text-tertiary shrink-0 mr-1" />
        <span className="text-[11px] uppercase tracking-[0.05em] text-ax-text-secondary truncate flex-1">
          {root.split('/').slice(-1)[0] || project}
        </span>
        {showGit && changedCount > 0 && (
          <span className="font-mono text-[9px] px-1 rounded" style={{ color: GIT_COLOR.M, background: 'var(--ax-warning-subtle)' }}>
            {changedCount}
          </span>
        )}
      </button>

      {/* Tree content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide text-[13px] leading-[22px]">
        {rootNode?.open ? (
          rootNode.entries.length > 0 ? (
            <DirEntries entries={rootNode.entries} tree={tree} toggle={toggle} depth={0}
              gitFiles={showGit ? gitFiles : {}} dirChangeMap={showGit ? dirChangeMap : null}
              onFileReference={onFileReference} />
          ) : (
            <div className="px-4 py-3 text-[11px] text-ax-text-ghost italic">Empty directory</div>
          )
        ) : !rootNode ? (
          <div className="px-4 py-3 text-[11px] text-ax-text-ghost">Loading...</div>
        ) : null}
      </div>

      {/* Source Control panel — draggable, collapsible */}
      {showGit && changedCount > 0 && (
        <div className="shrink-0 flex flex-col" style={{ height: scOpen ? scHeight + 22 : 22 }}>
          {/* Drag handle */}
          {scOpen && (
            <div
              className="h-[3px] cursor-row-resize hover:bg-ax-brand/30 active:bg-ax-brand/50 transition-colors border-t border-[var(--ax-border)]"
              onMouseDown={(e) => {
                e.preventDefault()
                dragRef.current = { startY: e.clientY, startH: scHeight }
                const onMove = (ev: MouseEvent) => {
                  if (!dragRef.current) return
                  const delta = dragRef.current.startY - ev.clientY
                  setScHeight(Math.max(60, Math.min(500, dragRef.current.startH + delta)))
                }
                const onUp = () => {
                  dragRef.current = null
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
            />
          )}
          {!scOpen && <div className="border-t border-[var(--ax-border)]" />}

          {/* Source Control header */}
          <button
            className="flex items-center h-[22px] px-2 w-full text-left shrink-0
              hover:bg-[var(--ax-text-primary)]/[0.06] font-semibold"
            onClick={() => setScOpen(o => !o)}
          >
            {scOpen
              ? <ChevronDown size={12} className="text-ax-text-tertiary shrink-0 mr-1" />
              : <ChevronRight size={12} className="text-ax-text-tertiary shrink-0 mr-1" />
            }
            <GitBranch size={11} className="text-ax-text-tertiary mr-1" />
            <span className="text-[11px] uppercase tracking-[0.05em] text-ax-text-secondary truncate flex-1">
              Source Control
            </span>
            <span className="font-mono text-[9px] px-1 rounded" style={{ color: GIT_COLOR.M, background: 'var(--ax-warning-subtle)' }}>
              {changedCount}
            </span>
          </button>

          {/* Changed files grouped by status */}
          {scOpen && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide text-[13px] leading-[22px]">
              {(['M', 'A', 'R', 'D', 'U'] as GitStatus[]).map(status => {
                const files = gitGroups[status]
                if (!files || files.length === 0) return null
                return (
                  <GitStatusGroup key={status} status={status} files={files} />
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Source Control: status group ──────────────────────────────── */

function GitStatusGroup({ status, files }: { status: GitStatus; files: string[] }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button
        className="w-full flex items-center h-[20px] px-2 text-left
          hover:bg-[var(--ax-text-primary)]/[0.06]"
        onClick={() => setOpen(o => !o)}
      >
        {open
          ? <ChevronDown size={10} className="text-ax-text-tertiary shrink-0 mr-1" />
          : <ChevronRight size={10} className="text-ax-text-tertiary shrink-0 mr-1" />
        }
        <span className="text-[10px] font-medium truncate flex-1" style={{ color: GIT_COLOR[status] }}>
          {GIT_GROUP_LABEL[status]}
        </span>
        <span className="font-mono text-[9px] mr-1" style={{ color: GIT_COLOR[status] }}>
          {files.length}
        </span>
      </button>
      {open && files.map(fp => (
        <GitFileItem key={fp} path={fp} status={status} />
      ))}
    </>
  )
}

function GitFileItem({ path, status }: { path: string; status: GitStatus }) {
  const fileName = path.split('/').pop() || path
  const dirPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  const icon = getFileIcon(fileName)

  return (
    <div
      className="flex items-center h-[20px] pr-2 pl-6
        hover:bg-[var(--ax-text-primary)]/[0.06] cursor-default"
    >
      {/* File type badge */}
      <span className="w-4 h-4 flex items-center justify-center shrink-0">
        {icon ? (
          <span className="font-mono text-[8px] font-bold leading-none" style={{ color: icon.color }}>
            {icon.label}
          </span>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-ax-text-ghost/40" />
        )}
      </span>
      <span className="ml-1 truncate flex-1" style={{ color: GIT_COLOR[status] }}>
        <span className="text-[12px]">{fileName}</span>
      </span>
      {dirPath && (
        <span className="text-[9px] text-ax-text-ghost truncate max-w-[80px] ml-1">
          {dirPath}
        </span>
      )}
      <span
        className="font-mono text-[9px] font-bold shrink-0 w-3 text-center ml-0.5"
        style={{ color: GIT_COLOR[status] }}
      >
        {GIT_LABEL[status]}
      </span>
    </div>
  )
}

/* ── Recursive entries ────────────────────────────────────────── */

function DirEntries({
  entries, tree, toggle, depth, gitFiles, dirChangeMap, onFileReference,
}: {
  entries: FileEntry[]
  tree: Map<string, DirNode>
  toggle: (path: string) => void
  depth: number
  gitFiles: GitMap
  dirChangeMap: Map<string, GitStatus> | null
  onFileReference?: (path: string) => void
}) {
  return (
    <>
      {entries.map(entry => (
        entry.type === 'dir'
          ? <DirItem key={entry.path} entry={entry} tree={tree} toggle={toggle} depth={depth} gitFiles={gitFiles} dirChangeMap={dirChangeMap} onFileReference={onFileReference} />
          : <FileItem key={entry.path} entry={entry} depth={depth} gitStatus={gitFiles[entry.path]} onFileReference={onFileReference} />
      ))}
    </>
  )
}

function DirItem({
  entry, tree, toggle, depth, gitFiles, dirChangeMap, onFileReference,
}: {
  entry: FileEntry
  tree: Map<string, DirNode>
  toggle: (path: string) => void
  depth: number
  gitFiles: GitMap
  dirChangeMap: Map<string, GitStatus> | null
  onFileReference?: (path: string) => void
}) {
  const node = tree.get(entry.path)
  const isOpen = node?.open ?? false
  const dirStatus = dirChangeMap?.get(entry.path) ?? null

  return (
    <>
      <div className="group relative">
        <button
          onClick={() => toggle(entry.path)}
          className="w-full flex items-center h-[22px] pr-2 text-left
            hover:bg-[var(--ax-text-primary)]/[0.06] active:bg-[var(--ax-text-primary)]/[0.08]"
          style={{ paddingLeft: 8 + depth * 16 }}
        >
          <span className="w-4 flex items-center justify-center shrink-0">
            {isOpen
              ? <ChevronDown size={12} className="text-ax-text-tertiary" />
              : <ChevronRight size={12} className="text-ax-text-tertiary" />
            }
          </span>
          <span className="shrink-0 mx-0.5">
            <FolderIcon open={isOpen} />
          </span>
          <span
            className="ml-1 truncate flex-1"
            style={dirStatus ? { color: GIT_COLOR[dirStatus] } : undefined}
          >
            <span className={dirStatus ? '' : 'text-ax-text-secondary'}>{entry.name}</span>
          </span>
        </button>
        {onFileReference && (
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center
              rounded opacity-0 group-hover:opacity-100 text-ax-text-ghost hover:text-ax-brand
              hover:bg-ax-brand/10 transition-all"
            onClick={(e) => { e.stopPropagation(); onFileReference(entry.path + '/') }}
            title={`Reference @${entry.path}/`}
          >
            <AtSign size={10} />
          </button>
        )}
      </div>
      {isOpen && node?.entries && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 w-px bg-[var(--ax-border-subtle)]"
            style={{ left: 16 + depth * 16 }}
          />
          <DirEntries entries={node.entries} tree={tree} toggle={toggle} depth={depth + 1} gitFiles={gitFiles} dirChangeMap={dirChangeMap} onFileReference={onFileReference} />
        </div>
      )}
    </>
  )
}

function FileItem({ entry, depth, gitStatus, onFileReference }: { entry: FileEntry; depth: number; gitStatus?: GitStatus; onFileReference?: (path: string) => void }) {
  const icon = getFileIcon(entry.name)

  return (
    <div
      className="group relative flex items-center h-[22px] pr-2
        hover:bg-[var(--ax-text-primary)]/[0.06] cursor-default"
      style={{ paddingLeft: 8 + depth * 16 + 18 }}
    >
      {/* Colored 2-char file type badge */}
      <span className="w-4 h-4 flex items-center justify-center shrink-0">
        {icon ? (
          <span
            className="font-mono text-[8px] font-bold leading-none"
            style={{ color: icon.color }}
          >
            {icon.label}
          </span>
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-ax-text-ghost/40" />
        )}
      </span>
      <span
        className="ml-1 truncate flex-1"
        style={gitStatus ? { color: GIT_COLOR[gitStatus] } : undefined}
      >
        <span className={gitStatus ? '' : 'text-ax-text-tertiary'}>{entry.name}</span>
      </span>
      {/* Git status badge */}
      {gitStatus && (
        <span
          className="font-mono text-[9px] font-bold ml-auto shrink-0 w-3 text-center"
          style={{ color: GIT_COLOR[gitStatus] }}
        >
          {GIT_LABEL[gitStatus]}
        </span>
      )}
      {/* @ reference button */}
      {onFileReference && (
        <button
          className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center
            rounded opacity-0 group-hover:opacity-100 text-ax-text-ghost hover:text-ax-brand
            hover:bg-ax-brand/10 transition-all"
          onClick={(e) => { e.stopPropagation(); onFileReference(entry.path) }}
          title={`Reference @${entry.path}`}
        >
          <AtSign size={10} />
        </button>
      )}
    </div>
  )
}
