import { useState, useRef, useCallback, useEffect } from 'react'
import { useDebugStore } from '@/store/debugStore'

const STORAGE_KEY = 'axon-intro-seen'
const PLAYBACK_RATE = 2.5
const START_PERCENT = 0.50
const FADE_DURATION_MS = 1500

/** Sample the average color from the video's edge pixels using a canvas */
function sampleEdgeColor(video: HTMLVideoElement): string {
  try {
    const canvas = document.createElement('canvas')
    const size = 8
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return '#0a0a0a'
    ctx.drawImage(video, 0, 0, size, size)
    // Sample corners
    const pixels = [
      ctx.getImageData(0, 0, 1, 1).data,
      ctx.getImageData(size - 1, 0, 1, 1).data,
      ctx.getImageData(0, size - 1, 1, 1).data,
      ctx.getImageData(size - 1, size - 1, 1, 1).data,
    ]
    const r = Math.round(pixels.reduce((s, p) => s + p[0], 0) / 4)
    const g = Math.round(pixels.reduce((s, p) => s + p[1], 0) / 4)
    const b = Math.round(pixels.reduce((s, p) => s + p[2], 0) / 4)
    return `rgb(${r},${g},${b})`
  } catch {
    return '#0a0a0a'
  }
}

export function IntroSplash() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(STORAGE_KEY))
  const [ready, setReady] = useState(false) // fade-in trigger
  const [fading, setFading] = useState(false)
  const [ended, setEnded] = useState(false)
  const [bgColor, setBgColor] = useState('#0a0a0a')
  const videoRef = useRef<HTMLVideoElement>(null)
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const dismiss = useCallback(() => {
    setFading(true)
    localStorage.setItem(STORAGE_KEY, '1')
    setTimeout(() => setVisible(false), FADE_DURATION_MS)
  }, [])

  const show = useCallback(() => {
    setReady(false)
    setFading(false)
    setEnded(false)
    setBgColor('#0a0a0a')
    setVisible(true)
    const v = videoRef.current
    if (v) {
      v.currentTime = v.duration * START_PERCENT
      v.playbackRate = PLAYBACK_RATE
      v.play()
    }
  }, [])

  // Register debug action
  const register = useDebugStore(s => s.register)
  const unregister = useDebugStore(s => s.unregister)

  useEffect(() => {
    register({
      id: 'replay-intro',
      label: 'Replay Intro',
      active: visible,
      toggle: () => {
        if (visible) dismiss()
        else show()
      },
    })
    return () => unregister('replay-intro')
  }, [register, unregister, visible, dismiss, show])

  // Cleanup fade timer
  useEffect(() => () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = v.duration * START_PERCENT
    v.playbackRate = PLAYBACK_RATE
  }, [])

  // Sample edge color once first frame renders, then fade in
  const handleCanPlay = useCallback(() => {
    const v = videoRef.current
    if (v) setBgColor(sampleEdgeColor(v))
    // Small delay so the background color sets before we fade in
    requestAnimationFrame(() => setReady(true))
  }, [])

  const handleEnded = useCallback(() => {
    setEnded(true)
    // Freeze on final frame — user clicks "Get Started" when ready
  }, [])

  // If the video fails to load (missing file), skip the splash entirely
  const handleError = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        backgroundColor: bgColor,
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_DURATION_MS}ms ease-in-out`,
      }}
    >
      {/* Video at 60% with edge blend into background */}
      <div
        className="relative"
        style={{
          width: '60vw', height: '60vh',
          opacity: ready ? 1 : 0,
          transition: 'opacity 800ms ease-in',
        }}
      >
        <video
          ref={videoRef}
          src="/branding/axon-intro.mp4"
          className="w-full h-full object-contain"
          autoPlay
          muted
          playsInline
          crossOrigin="anonymous"
          onLoadedMetadata={handleLoadedMetadata}
          onCanPlay={handleCanPlay}
          onEnded={handleEnded}
          onError={handleError}
        />
        {/* Soft edge blend — feathers the video into the background */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: `0 0 80px 40px ${bgColor}, 0 0 160px 80px ${bgColor}`,
          }}
        />
        <div
          className="absolute -inset-1 pointer-events-none"
          style={{
            background: `
              linear-gradient(to right, ${bgColor} 0%, transparent 8%, transparent 92%, ${bgColor} 100%),
              linear-gradient(to bottom, ${bgColor} 0%, transparent 8%, transparent 92%, ${bgColor} 100%)
            `,
          }}
        />
      </div>

      {/* Get Started — fades in after video ends */}
      <div className={`absolute bottom-16 left-1/2 -translate-x-1/2
        transition-opacity duration-500
        ${ended ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <button
          onClick={dismiss}
          className="px-8 py-3 rounded-lg font-mono text-body
            bg-ax-brand text-white hover:bg-ax-brand-hover transition-colors
            shadow-lg"
        >
          Get Started
        </button>
      </div>

      {/* Skip — always visible */}
      <button
        onClick={() => {
          if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
          dismiss()
        }}
        className="absolute top-6 right-6 font-mono text-micro text-white/50
          hover:text-white/80 transition-colors"
      >
        Skip
      </button>
    </div>
  )
}
