import { DataProvider } from '@/providers/DataProvider'
import { Shell } from '@/components/layout/Shell'
import { TimelineView } from '@/views/TimelineView'
import { RollupDetailView } from '@/views/RollupDetailView'
import { StateView } from '@/views/StateView'
import { SettingsView } from '@/views/SettingsView'
import { DecisionsView } from '@/views/DecisionsView'
import { MorningView } from '@/views/MorningView'
import { OnboardingView } from '@/views/OnboardingView'
import { AgentView } from '@/views/AgentView'
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
      return <DecisionsView />
    case 'settings':
      return <SettingsView />
    case 'morning':
      return <MorningView />
    case 'onboarding':
      return <OnboardingView />
    case 'agent':
      return <AgentView />
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
