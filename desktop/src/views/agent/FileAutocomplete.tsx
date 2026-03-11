import { useEffect, useRef } from 'react'
import { getFileIcon } from './fileIcons'

interface FileAutocompleteProps {
  results: string[]
  loading: boolean
  query: string
  selected: number
  onSelect: (path: string) => void
  onHover: (index: number) => void
  onClose: () => void
}

export function FileAutocomplete({ results, loading, query, selected, onSelect, onHover, onClose }: FileAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selected] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // Close if no results and not loading
  if (!loading && results.length === 0 && query.length > 0) return null

  const visible = results.slice(0, 50)

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-50 animate-slide-up">
      <div className="mx-3 bg-ax-elevated border border-ax-border rounded-lg shadow-lg
        overflow-hidden max-h-[280px] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-ax-border-subtle
          text-[10px] font-mono text-ax-text-tertiary">
          <span className="text-ax-brand">@</span>
          <span>{query}</span>
          {loading && <span className="ml-auto text-ax-text-ghost">...</span>}
          {!loading && results.length > 0 && (
            <span className="ml-auto text-ax-text-ghost">{results.length} files</span>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto overflow-x-hidden scrollbar-hide">
          {visible.map((path, i) => {
            const fileName = path.split('/').pop() || path
            const dirPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
            const icon = getFileIcon(fileName)
            const isSelected = i === selected

            return (
              <button
                key={path}
                className={`w-full flex items-center gap-1.5 px-2.5 py-1 text-left transition-colors
                  ${isSelected ? 'bg-ax-brand/10' : 'hover:bg-ax-sunken/30'}`}
                onMouseEnter={() => onHover(i)}
                onClick={() => onSelect(path)}
              >
                {/* File icon */}
                <span className="w-4 h-4 flex items-center justify-center shrink-0">
                  {icon ? (
                    <span className="font-mono text-[8px] font-bold" style={{ color: icon.color }}>
                      {icon.label}
                    </span>
                  ) : (
                    <span className="w-1.5 h-1.5 rounded-full bg-ax-text-ghost/40" />
                  )}
                </span>
                {/* File name + dir */}
                <span className="text-[11px] text-ax-text-primary truncate">{fileName}</span>
                {dirPath && (
                  <span className="text-[10px] text-ax-text-ghost truncate ml-auto">{dirPath}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Keyboard hint */}
        <div className="flex items-center gap-2 px-2.5 py-0.5 border-t border-ax-border-subtle
          text-[9px] font-mono text-ax-text-ghost">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
