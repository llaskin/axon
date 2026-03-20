import { create } from 'zustand'

export interface DebugAction {
  id: string
  label: string
  active: boolean
  toggle: () => void
}

interface DebugStore {
  actions: Map<string, DebugAction>
  screenshotMode: boolean
  register: (action: DebugAction) => void
  unregister: (id: string) => void
  isActive: (id: string) => boolean
  toggleScreenshotMode: () => void
}

const GENERIC_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliet', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa']
const nameMap = new Map<string, string>()
let nameIdx = 0

/** Returns a stable generic name for a project name when in screenshot mode */
export function maskProjectName(name: string, active: boolean): string {
  if (!active) return name
  let masked = nameMap.get(name)
  if (!masked) {
    masked = `Project ${GENERIC_NAMES[nameIdx % GENERIC_NAMES.length]}`
    nameMap.set(name, masked)
    nameIdx++
  }
  return masked
}

export const useDebugStore = create<DebugStore>((set, get) => ({
  actions: new Map(),
  screenshotMode: false,
  register: (action) => set((s) => {
    const next = new Map(s.actions)
    next.set(action.id, action)
    return { actions: next }
  }),
  unregister: (id) => set((s) => {
    const next = new Map(s.actions)
    next.delete(id)
    return { actions: next }
  }),
  isActive: (id) => get().actions.get(id)?.active ?? false,
  toggleScreenshotMode: () => set(s => ({ screenshotMode: !s.screenshotMode })),
}))
