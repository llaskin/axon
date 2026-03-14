import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmOption {
  label: string
  value: string
  variant?: 'danger' | 'default'
}

interface ConfirmDialogProps {
  title: string
  message: string
  options: ConfirmOption[]
  onSelect: (value: string) => void
  onCancel: () => void
}

export function ConfirmDialog({ title, message, options, onSelect, onCancel }: ConfirmDialogProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onCancel()
  }, [onCancel])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-ax-elevated rounded-xl border border-ax-border p-6 max-w-sm w-full mx-4 shadow-xl animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="font-serif italic text-h3 text-ax-text-primary mb-2">{title}</h3>
        <p className="text-small text-ax-text-secondary mb-5">{message}</p>
        <div className="flex flex-col gap-2">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              className={`w-full px-4 py-2.5 rounded-lg font-mono text-small transition-colors
                ${opt.variant === 'danger'
                  ? 'bg-ax-error/10 text-ax-error hover:bg-ax-error/20 border border-ax-error/20'
                  : 'bg-ax-sunken text-ax-text-primary hover:bg-ax-sunken/80 border border-ax-border-subtle'
                }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 rounded-lg text-small text-ax-text-tertiary hover:text-ax-text-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
