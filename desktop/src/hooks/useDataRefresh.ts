import { useEffect, useCallback } from 'react'
import { useProjectStore } from '@/store/projectStore'
import { useDiscoveryStore } from '@/store/discoveryStore'
import { useBackend } from '@/providers/DataProvider'

const POLL_INTERVAL = 30_000 // 30 seconds
const DISCOVERY_POLL_INTERVAL = 120_000 // 2 minutes

/**
 * Auto-refreshes project data:
 * - Polls every 30s for updated project metadata
 * - Polls every 2min for discovered repos
 * - Refetches on window focus (tab switch, alt-tab back)
 */
export function useDataRefresh() {
  const { setProjects } = useProjectStore()
  const { fetchRepos } = useDiscoveryStore()
  const backend = useBackend()

  const refresh = useCallback(() => {
    backend.getProjects()
      .then((data) => {
        setProjects(data)
      })
      .catch(() => {
        // Silent — don't overwrite error state on background poll failures
      })
  }, [setProjects, backend])

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL)
    const discoveryInterval = setInterval(fetchRepos, DISCOVERY_POLL_INTERVAL)

    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      clearInterval(discoveryInterval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, fetchRepos])
}
