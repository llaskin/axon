/**
 * NeuralBackground — ambient background layer for the main content area.
 * Base: subtle dot grid. Overlay: per-project Gource constellation + repo name watermark.
 */
import { useState, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useUIStore } from '@/store/uiStore'

export function NeuralBackground() {
  const activeProject = useProjectStore((s) => s.activeProject)
  const activeView = useUIStore((s) => s.activeView)
  const [imgFailed, setImgFailed] = useState<string | null>(null)
  const muted = activeView === 'agent'

  const gourceUrl = activeProject
    ? `/api/axon/projects/${encodeURIComponent(activeProject)}/gource`
    : null

  // Track which project's image failed so we don't retry endlessly
  const showGource = gourceUrl && imgFailed !== activeProject

  const onError = useCallback(() => {
    setImgFailed(useProjectStore.getState().activeProject)
  }, [])

  const onLoad = useCallback(() => {
    setImgFailed(null)
  }, [])

  if (muted) {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
        <div className="absolute inset-0 neural-noise" />
      </div>
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      {/* Base: subtle dot grid */}
      <div className="absolute inset-0 neural-dots" />

      {/* Overlay: per-project Gource constellation */}
      {showGource && (
        <div className="absolute inset-0 neural-gource">
          <img
            src={gourceUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={onError}
            onLoad={onLoad}
          />
        </div>
      )}

      {/* Repo name watermark */}
      {activeProject && (
        <div className="absolute inset-x-0 top-[22%] flex justify-center -translate-y-1/2">
          <span className="neural-watermark font-serif italic">
            {activeProject}
          </span>
        </div>
      )}
    </div>
  )
}
