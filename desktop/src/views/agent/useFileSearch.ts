import { useState, useEffect, useRef } from 'react'

export function useFileSearch(query: string, project: string | null): {
  results: string[]
  loading: boolean
} {
  const [results, setResults] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // Clear previous timer
    if (timerRef.current) clearTimeout(timerRef.current)

    // No query or too short → clear
    if (!query || !project || query.length < 1) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    // 150ms debounce
    timerRef.current = setTimeout(() => {
      // Abort any in-flight request
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      fetch(
        `/api/axon/filesearch?project=${encodeURIComponent(project)}&q=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      )
        .then(r => r.json())
        .then((data: { files: string[] }) => {
          if (!controller.signal.aborted) {
            setResults(data.files)
            setLoading(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([])
            setLoading(false)
          }
        })
    }, 150)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      abortRef.current?.abort()
    }
  }, [query, project])

  return { results, loading }
}
