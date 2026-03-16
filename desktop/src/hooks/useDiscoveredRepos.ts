import { useEffect } from 'react'
import { useDiscoveryStore } from '@/store/discoveryStore'
import { useProjectStore } from '@/store/projectStore'

/**
 * Fetches discovered repos on mount (delayed 2s) and re-fetches
 * when the project list changes (e.g. after a quick-init).
 */
export function useDiscoveredRepos() {
  const { repos, loading, fetchRepos, initRepo } = useDiscoveryStore()
  const projectCount = useProjectStore(s => s.projects.length)

  useEffect(() => {
    // Delay initial fetch to avoid slowing sidebar mount
    const t = setTimeout(() => fetchRepos(), 2000)
    return () => clearTimeout(t)
  }, [fetchRepos])

  // Re-fetch when project count changes (repo was initialized)
  useEffect(() => {
    if (projectCount > 0) fetchRepos()
  }, [projectCount, fetchRepos])

  return { repos, loading, initRepo }
}
