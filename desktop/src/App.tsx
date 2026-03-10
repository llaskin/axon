import { DataProvider } from '@/providers/DataProvider'
import { Shell } from '@/components/layout/Shell'
import { TimelineView } from '@/views/TimelineView'
import { RollupDetailView } from '@/views/RollupDetailView'
import { StateView } from '@/views/StateView'
import { SettingsView } from '@/views/SettingsView'
import { useUIStore } from '@/store/uiStore'

function ViewRouter() {
  const activeView = useUIStore((s) => s.activeView)

  switch (activeView) {
    case 'timeline':
      return <TimelineView />
    case 'rollup-detail':
      return <RollupDetailView />
    case 'state':
      return <StateView />
    case 'decisions':
      return <div className="text-center py-20">
        <p className="font-serif italic text-h3 text-ax-text-tertiary mb-2">Decisions</p>
        <p className="text-body text-ax-text-tertiary">Coming soon — searchable decision trace explorer</p>
      </div>
    case 'settings':
      return <SettingsView />
    default:
      return <TimelineView />
  }
}

export default function App() {
  return (
    <DataProvider>
      <Shell>
        <ViewRouter />
      </Shell>
    </DataProvider>
  )
}
