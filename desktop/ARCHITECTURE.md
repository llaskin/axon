# Axon Desktop — Architecture Document

> Date: 2026-03-10
> Status: Ready for scaffolding
> Stack: Tauri 2.x + Vite + React 19 + TypeScript + Tailwind CSS 4

---

## 1. Project Structure

```
desktop/
├── ARCHITECTURE.md                          # This file
├── package.json                             # React + Vite deps
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── index.html                               # Vite entry
├── tailwind.config.ts
├── postcss.config.js
│
├── src/                                     # React application
│   ├── main.tsx                             # React DOM mount
│   ├── App.tsx                              # Root component + router
│   ├── globals.css                          # Tailwind imports + base styles
│   │
│   ├── lib/                                 # Core utilities
│   │   ├── tauri.ts                         # Tauri invoke/event wrappers
│   │   ├── parser.ts                        # YAML frontmatter + markdown parsing
│   │   ├── types.ts                         # Shared TypeScript types
│   │   └── constants.ts                     # Route paths, config keys
│   │
│   ├── providers/                           # React context providers
│   │   ├── DataProvider.tsx                 # Backend abstraction (Tauri vs mock)
│   │   └── ProjectProvider.tsx              # Active project context
│   │
│   ├── hooks/                               # Data hooks (the public API)
│   │   ├── useProjects.ts                   # List workspaces with status
│   │   ├── useRollups.ts                    # Episode list with parsed frontmatter
│   │   ├── useRollup.ts                     # Single rollup detail (parsed markdown)
│   │   ├── useState.ts                      # Current state.md
│   │   ├── useStream.ts                     # stream.md entries
│   │   ├── useDendrites.ts                  # Dendrite files
│   │   ├── useConfig.ts                     # Project + global config.yaml
│   │   ├── useCron.ts                       # Cron status + controls
│   │   ├── useFileWatcher.ts                # Re-fetch on fs changes
│   │   ├── useDecisions.ts                  # Aggregated decision traces
│   │   └── useMorning.ts                    # Morning briefing controls
│   │
│   ├── store/                               # Zustand stores
│   │   ├── projectStore.ts                  # Active project, project list cache
│   │   └── uiStore.ts                       # Sidebar state, view preferences
│   │
│   ├── views/                               # Top-level route views
│   │   ├── TimelineView.tsx                 # Rollup cards, scrollable timeline
│   │   ├── StateView.tsx                    # Rendered state.md
│   │   ├── MorningView.tsx                  # Briefing chat interface
│   │   ├── DecisionExplorerView.tsx         # Searchable decision traces
│   │   ├── SettingsView.tsx                 # Project management, cron config
│   │   └── RollupDetailView.tsx             # Full rollup rendered
│   │
│   ├── components/                          # Shared UI components
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx                  # Project list + nav
│   │   │   ├── Shell.tsx                    # App shell (sidebar + content)
│   │   │   └── Header.tsx                   # View header + breadcrumbs
│   │   │
│   │   ├── timeline/
│   │   │   ├── RollupCard.tsx               # Single rollup card (frontmatter data)
│   │   │   ├── RollupTimeline.tsx           # Scrollable card list
│   │   │   └── TimelineFilter.tsx           # Date range, tag filters
│   │   │
│   │   ├── state/
│   │   │   ├── StatePanel.tsx               # Rendered state section
│   │   │   ├── OpenLoops.tsx                # Checkbox list from state
│   │   │   └── KeyFiles.tsx                 # File table from state
│   │   │
│   │   ├── decisions/
│   │   │   ├── DecisionCard.tsx             # Single DT card
│   │   │   ├── DecisionSearch.tsx           # Full-text search
│   │   │   └── DecisionTimeline.tsx         # Chronological decision list
│   │   │
│   │   ├── settings/
│   │   │   ├── CronPanel.tsx               # Cron toggle, schedule, status
│   │   │   ├── ProjectCard.tsx             # Project status + actions
│   │   │   └── DendriteConfig.tsx          # Dendrite toggles per project
│   │   │
│   │   ├── morning/
│   │   │   ├── ChatInterface.tsx           # Message input + display
│   │   │   ├── BriefingPanel.tsx           # Latest rollup summary
│   │   │   └── SuggestedActions.tsx        # "For tomorrow" items
│   │   │
│   │   └── shared/
│   │       ├── MarkdownRenderer.tsx         # MD -> HTML with syntax highlighting
│   │       ├── StatusDot.tsx                # Green/amber/grey indicator
│   │       ├── Badge.tsx                    # Open loop count, tag pill
│   │       ├── LoadingState.tsx             # Skeleton/spinner
│   │       └── EmptyState.tsx              # "No rollups yet" etc.
│   │
│   └── assets/
│       └── fonts/                           # Instrument Serif, JetBrains Mono
│
├── src-tauri/                               # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json                      # Window config, bundle settings
│   ├── capabilities/
│   │   └── default.json                     # Tauri capability permissions
│   ├── icons/                               # App icons (.icns, .ico, .png)
│   ├── src/
│   │   ├── main.rs                          # Tauri bootstrap
│   │   ├── lib.rs                           # Plugin registration
│   │   ├── commands/                        # Tauri IPC commands
│   │   │   ├── mod.rs
│   │   │   ├── filesystem.rs                # Read files, list dirs, parse YAML
│   │   │   ├── watcher.rs                   # Filesystem change notifications
│   │   │   ├── shell.rs                     # Execute axon CLI commands
│   │   │   └── config.rs                    # Read/write config.yaml
│   │   ├── parser.rs                        # YAML frontmatter extraction
│   │   └── state.rs                         # Tauri managed state (watcher handles)
│   └── build.rs
│
└── test/                                    # Test utilities
    ├── fixtures/                             # Mock ~/.axon/ structure
    │   ├── config.yaml
    │   └── workspaces/
    │       └── test-project/
    │           ├── config.yaml
    │           ├── state.md
    │           ├── stream.md
    │           ├── episodes/
    │           │   ├── 2026-03-09_rollup.md
    │           │   └── 2026-03-10_rollup.md
    │           └── dendrites/
    │               ├── 2026-03-10T23-00-00Z_git-log.md
    │               └── 2026-03-10T23-00-00Z_file-tree.md
    └── mock-backend.ts                      # Mock Tauri invoke for dev server
```

---

## 2. Tech Stack

### Build Tooling

| Tool | Version | Purpose |
|------|---------|---------|
| Tauri | 2.x (`@tauri-apps/cli@^2`, `@tauri-apps/api@^2`) | Desktop shell, native fs, IPC |
| Vite | 6.x | Dev server, HMR, build |
| React | 19.x | UI framework |
| TypeScript | 5.7+ | Type safety |
| Tailwind CSS | 4.x | Utility-first styling |

### State Management: Zustand

**Choice: Zustand over Jotai and React Context.**

Reasoning:

1. **Zustand over React Context** -- Context triggers re-renders on every consumer when any value changes. With multiple data sources (projects, rollups, state, stream, dendrites, config, cron) this creates unnecessary render cascading. Context is fine for "rarely changing" values like theme or locale, not for data that updates on filesystem changes.

2. **Zustand over Jotai** -- Jotai's atom model excels in fine-grained reactivity for complex interdependent state (think spreadsheets). Axon's state is simpler: a few independent data slices, each derived from filesystem reads. Zustand's store-slice pattern maps directly to this -- one slice per data source, each with its own fetch/refresh logic. It also has a smaller API surface, which means less conceptual overhead for a project that should stay lean.

3. **Practical advantages** -- Zustand stores are accessible outside React (useful for Tauri event handlers that need to update state without being inside a component tree). `subscribeWithSelector` enables fine-grained subscriptions. Middleware for devtools and persistence is built in.

```typescript
// Example: projectStore.ts
import { create } from 'zustand'

interface ProjectStore {
  projects: Project[]
  activeProject: string | null
  setActiveProject: (name: string) => void
  fetchProjects: () => Promise<void>
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  activeProject: null,
  setActiveProject: (name) => set({ activeProject: name }),
  fetchProjects: async () => {
    const projects = await backend.listProjects()
    set({ projects })
  },
}))
```

### Router: TanStack Router

**Choice: TanStack Router (`@tanstack/react-router` v1) over React Router.**

Reasoning:

1. **Type-safe route params** -- When navigating to `/project/:name/rollup/:date`, TanStack Router enforces that `name` and `date` are provided and correctly typed at compile time. React Router v6 has improved here but still relies on runtime strings.

2. **Search params as state** -- The Decision Explorer needs URL-persisted search queries and filters. TanStack Router treats search params as first-class typed state, not string parsing afterthoughts.

3. **File-based route generation** -- Optional but useful as the app grows. Each view file can define its own route, loader, and error boundary.

4. **Smaller bundle** -- TanStack Router tree-shakes more aggressively than React Router's kitchen-sink approach.

Route structure:

```
/                           -> redirect to first project's timeline
/:project/timeline          -> TimelineView
/:project/timeline/:date    -> RollupDetailView
/:project/state             -> StateView
/:project/morning           -> MorningView
/:project/decisions         -> DecisionExplorerView
/settings                   -> SettingsView
```

### Key Dependencies

```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tanstack/react-router": "^1.0.0",
    "zustand": "^5.0.0",
    "gray-matter": "^4.0.3",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "date-fns": "^4.0.0",
    "yaml": "^2.6.0",
    "fuse.js": "^7.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "~5.7.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "@tailwindcss/typography": "^0.5.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0"
  }
}
```

---

## 3. Tauri Backend (Rust Commands)

All filesystem reads go through Rust. All writes go through CLI shell execution. This matches the protocol spec: "Writes go through the CLI commands (shell exec from the UI), not direct file manipulation."

### Cargo.toml dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
notify = "7"              # Filesystem watcher
walkdir = "2"             # Directory traversal
chrono = { version = "0.4", features = ["serde"] }
gray-matter = "0.2"       # YAML frontmatter parsing (or manual split)
```

### Command Module: `filesystem.rs`

```rust
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub status: String,           // "active" | "paused" | "archived"
    pub last_rollup: Option<String>,
    pub episode_count: usize,
    pub open_loop_count: usize,
    pub last_activity: Option<String>,
    pub project_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EpisodeMeta {
    pub filename: String,
    pub frontmatter: serde_json::Value,  // Parsed YAML as JSON
    pub date: String,
    pub is_rollup: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
    pub body: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DendriteInfo {
    pub filename: String,
    pub dendrite_type: String,    // "git-log", "file-tree", "manual-note"
    pub collected_at: String,
    pub frontmatter: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StreamEntry {
    pub timestamp: String,
    pub source: String,
    pub message: String,
    pub raw: String,
}

// --- Commands ---

/// List all workspaces with status metadata.
/// Reads each workspace's config.yaml and state.md frontmatter.
#[tauri::command]
async fn list_projects(axon_home: String) -> Result<Vec<ProjectInfo>, String> { ... }

/// List episodes for a project with parsed YAML frontmatter.
/// Does NOT return full markdown body -- only frontmatter for card rendering.
#[tauri::command]
async fn list_episodes(axon_home: String, project: String) -> Result<Vec<EpisodeMeta>, String> { ... }

/// Read a single file with parsed frontmatter separated from body.
/// Used for: state.md, individual rollups, dendrites.
#[tauri::command]
async fn read_file_with_frontmatter(path: String) -> Result<FileContent, String> { ... }

/// Read raw file content (no parsing).
/// Used for: stream.md, config.yaml, logs.
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> { ... }

/// List dendrite files for a project with parsed frontmatter.
#[tauri::command]
async fn list_dendrites(axon_home: String, project: String) -> Result<Vec<DendriteInfo>, String> { ... }

/// Parse stream.md into structured entries.
/// Format: "- [2026-03-10T16:45:00Z] @user: message text"
#[tauri::command]
async fn parse_stream(axon_home: String, project: String) -> Result<Vec<StreamEntry>, String> { ... }

/// Read and parse config.yaml (project or global).
#[tauri::command]
async fn read_config(path: String) -> Result<serde_json::Value, String> { ... }

/// Get the axon home directory path.
/// Checks AXON_HOME env var, falls back to ~/.axon/
#[tauri::command]
async fn get_axon_home() -> Result<String, String> { ... }

/// Search across all episodes for decision traces matching a query.
/// Returns matched DT blocks with source episode metadata.
#[tauri::command]
async fn search_decisions(
    axon_home: String,
    project: String,
    query: String,
) -> Result<Vec<DecisionTrace>, String> { ... }
```

### Command Module: `watcher.rs`

```rust
use notify::{Watcher, RecursiveMode, Event};
use tauri::{AppHandle, Emitter, Manager};
use std::sync::Mutex;

/// Managed state: holds the watcher handle so it persists.
pub struct WatcherState {
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// Start watching a directory. Emits "fs-change" events to the frontend.
/// The event payload includes the changed path and change kind.
#[tauri::command]
async fn watch_directory(
    app: AppHandle,
    path: String,
    state: tauri::State<'_, WatcherState>,
) -> Result<(), String> { ... }

/// Stop the active filesystem watcher.
#[tauri::command]
async fn unwatch(state: tauri::State<'_, WatcherState>) -> Result<(), String> { ... }
```

The watcher emits Tauri events with this payload:

```typescript
interface FsChangeEvent {
  path: string
  kind: 'create' | 'modify' | 'remove'
  timestamp: number
}
```

### Command Module: `shell.rs`

All write operations and CLI interactions go through shell execution. This preserves the CLI as the single source of truth.

```rust
use tauri_plugin_shell::ShellExt;

/// Execute an axon CLI command and return stdout.
/// The axon binary path is resolved from the CLI directory.
#[tauri::command]
async fn exec_axon(
    app: AppHandle,
    args: Vec<String>,  // e.g., ["rollup", "--project", "my-app"]
) -> Result<String, String> { ... }

/// Execute an axon command and stream stdout/stderr as events.
/// Used for long-running operations like `axon rollup`.
#[tauri::command]
async fn exec_axon_streaming(
    app: AppHandle,
    args: Vec<String>,
) -> Result<(), String> {
    // Uses tauri_plugin_shell to spawn process
    // Emits "axon-stdout" and "axon-stderr" events as lines arrive
    // Emits "axon-exit" with exit code when process completes
    ...
}

/// Get cron status for a project.
/// Calls `axon cron status --project <name>` and parses output.
#[tauri::command]
async fn get_cron_status(
    app: AppHandle,
    project: String,
) -> Result<CronStatus, String> { ... }
```

### Command Module: `config.rs`

```rust
/// Write a value to a project's config.yaml.
/// Only used for settings the UI manages directly (dendrite toggles, timezone).
/// Complex operations (cron install/remove) still go through shell.
#[tauri::command]
async fn update_config(
    axon_home: String,
    project: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> { ... }
```

### `main.rs` Bootstrap

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(WatcherState {
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            // filesystem
            list_projects,
            list_episodes,
            read_file_with_frontmatter,
            read_file,
            list_dendrites,
            parse_stream,
            read_config,
            get_axon_home,
            search_decisions,
            // watcher
            watch_directory,
            unwatch,
            // shell
            exec_axon,
            exec_axon_streaming,
            get_cron_status,
            // config
            update_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 4. Data Layer — React Hooks

### Backend Abstraction Pattern

The critical insight: hooks should not call `invoke()` directly. They call through a backend interface that can be swapped between Tauri (production) and a mock (development).

```typescript
// src/lib/types.ts

export interface Project {
  name: string
  status: 'active' | 'paused' | 'archived'
  lastRollup: string | null
  episodeCount: number
  openLoopCount: number
  lastActivity: string | null
  projectPath: string | null
}

export interface EpisodeMeta {
  filename: string
  frontmatter: RollupFrontmatter
  date: string
  isRollup: boolean
}

export interface RollupFrontmatter {
  type: string
  date: string
  project: string
  headline?: string
  tags?: string[]
  energy?: string
  commits?: number
  decisions?: number
  openLoops?: number
  sessions?: number
  previous?: string
}

export interface FileContent {
  path: string
  content: string
  frontmatter: Record<string, unknown> | null
  body: string
}

export interface DendriteInfo {
  filename: string
  dendriteType: string
  collectedAt: string
  frontmatter: Record<string, unknown>
}

export interface StreamEntry {
  timestamp: string
  source: string
  message: string
  raw: string
}

export interface DecisionTrace {
  id: string           // "DT-1"
  title: string
  input: string
  constraint: string
  tradeoff: string
  decision: string
  episodeDate: string
  episodeFile: string
  project: string
}

export interface CronStatus {
  installed: boolean
  loaded: boolean
  schedule: string | null
  lastRun: string | null
  lastExitCode: number | null
}
```

```typescript
// src/providers/DataProvider.tsx

import { createContext, useContext, type ReactNode } from 'react'

export interface Backend {
  // Filesystem reads
  listProjects(): Promise<Project[]>
  listEpisodes(project: string): Promise<EpisodeMeta[]>
  readFileWithFrontmatter(path: string): Promise<FileContent>
  readFile(path: string): Promise<string>
  listDendrites(project: string): Promise<DendriteInfo[]>
  parseStream(project: string): Promise<StreamEntry[]>
  readConfig(path: string): Promise<Record<string, unknown>>
  getAxonHome(): Promise<string>
  searchDecisions(project: string, query: string): Promise<DecisionTrace[]>

  // Shell execution
  execAxon(args: string[]): Promise<string>
  execAxonStreaming(args: string[], onStdout: (line: string) => void, onStderr: (line: string) => void): Promise<number>
  getCronStatus(project: string): Promise<CronStatus>

  // Config writes
  updateConfig(project: string, key: string, value: unknown): Promise<void>

  // Filesystem watching
  watchDirectory(path: string, onChange: (event: FsChangeEvent) => void): Promise<() => void>
}

const BackendContext = createContext<Backend | null>(null)

export function DataProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  return (
    <BackendContext.Provider value={backend}>
      {children}
    </BackendContext.Provider>
  )
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error('useBackend must be used within DataProvider')
  return backend
}
```

### Hook Implementations

Each hook follows the same pattern: call the backend, cache in Zustand, re-fetch on filesystem changes.

```typescript
// src/hooks/useProjects.ts
import { useEffect } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useBackend } from '../providers/DataProvider'
import { useFileWatcher } from './useFileWatcher'

export function useProjects() {
  const backend = useBackend()
  const { projects, fetchProjects } = useProjectStore()

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  // Re-fetch when workspaces directory changes
  useFileWatcher('workspaces/', fetchProjects)

  return projects
}
```

```typescript
// src/hooks/useRollups.ts
import { useState, useEffect, useCallback } from 'react'
import { useBackend } from '../providers/DataProvider'
import { useFileWatcher } from './useFileWatcher'
import type { EpisodeMeta } from '../lib/types'

export function useRollups(project: string) {
  const backend = useBackend()
  const [episodes, setEpisodes] = useState<EpisodeMeta[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const data = await backend.listEpisodes(project)
    // Sort by date descending (most recent first)
    setEpisodes(data.sort((a, b) => b.date.localeCompare(a.date)))
    setLoading(false)
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])
  useFileWatcher(`workspaces/${project}/episodes/`, fetch)

  return { episodes, loading, refetch: fetch }
}
```

```typescript
// src/hooks/useRollup.ts -- single rollup detail
export function useRollup(project: string, date: string) {
  const backend = useBackend()
  const [rollup, setRollup] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const home = await backend.getAxonHome()
      const path = `${home}/workspaces/${project}/episodes/${date}_rollup.md`
      try {
        const data = await backend.readFileWithFrontmatter(path)
        setRollup(data)
      } catch {
        // Try without _rollup suffix (session captures)
        const fallback = `${home}/workspaces/${project}/episodes/${date}.md`
        const data = await backend.readFileWithFrontmatter(fallback)
        setRollup(data)
      }
      setLoading(false)
    }
    load()
  }, [backend, project, date])

  return { rollup, loading }
}
```

```typescript
// src/hooks/useState.ts
export function useProjectState(project: string) {
  const backend = useBackend()
  const [state, setState] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const home = await backend.getAxonHome()
    const data = await backend.readFileWithFrontmatter(
      `${home}/workspaces/${project}/state.md`
    )
    setState(data)
    setLoading(false)
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])
  useFileWatcher(`workspaces/${project}/state.md`, fetch)

  return { state, loading, refetch: fetch }
}
```

```typescript
// src/hooks/useStream.ts
export function useStream(project: string) {
  const backend = useBackend()
  const [entries, setEntries] = useState<StreamEntry[]>([])

  const fetch = useCallback(async () => {
    const data = await backend.parseStream(project)
    setEntries(data.reverse()) // Most recent first
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])
  useFileWatcher(`workspaces/${project}/stream.md`, fetch)

  return { entries, refetch: fetch }
}
```

```typescript
// src/hooks/useDendrites.ts
export function useDendrites(project: string) {
  const backend = useBackend()
  const [dendrites, setDendrites] = useState<DendriteInfo[]>([])

  const fetch = useCallback(async () => {
    const data = await backend.listDendrites(project)
    setDendrites(data.sort((a, b) => b.collectedAt.localeCompare(a.collectedAt)))
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])
  useFileWatcher(`workspaces/${project}/dendrites/`, fetch)

  return { dendrites, refetch: fetch }
}
```

```typescript
// src/hooks/useFileWatcher.ts
import { useEffect, useRef } from 'react'
import { useBackend } from '../providers/DataProvider'

/**
 * Watch a path relative to AXON_HOME for changes.
 * Calls `onChange` when the filesystem reports a create/modify/remove.
 * Debounces to avoid rapid-fire re-fetches (300ms).
 */
export function useFileWatcher(relativePath: string, onChange: () => void) {
  const backend = useBackend()
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    let cleanup: (() => void) | undefined

    async function setup() {
      const home = await backend.getAxonHome()
      const fullPath = `${home}/${relativePath}`

      const unwatch = await backend.watchDirectory(fullPath, () => {
        // Debounce: wait 300ms after last change before re-fetching
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(onChange, 300)
      })
      cleanup = unwatch
    }

    setup()

    return () => {
      cleanup?.()
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [backend, relativePath, onChange])
}
```

```typescript
// src/hooks/useDecisions.ts
import Fuse from 'fuse.js'

export function useDecisions(project: string) {
  const backend = useBackend()
  const [decisions, setDecisions] = useState<DecisionTrace[]>([])
  const [query, setQuery] = useState('')

  const fetch = useCallback(async () => {
    const data = await backend.searchDecisions(project, '')
    setDecisions(data)
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])

  // Client-side fuzzy search over cached decisions
  const fuse = useMemo(
    () => new Fuse(decisions, {
      keys: ['title', 'decision', 'input', 'constraint', 'tradeoff'],
      threshold: 0.3,
    }),
    [decisions]
  )

  const results = query
    ? fuse.search(query).map(r => r.item)
    : decisions

  return { decisions: results, query, setQuery, refetch: fetch }
}
```

```typescript
// src/hooks/useCron.ts
export function useCron(project: string) {
  const backend = useBackend()
  const [status, setStatus] = useState<CronStatus | null>(null)

  const fetch = useCallback(async () => {
    const data = await backend.getCronStatus(project)
    setStatus(data)
  }, [backend, project])

  useEffect(() => { fetch() }, [fetch])

  const install = useCallback(async (time?: string) => {
    const args = ['cron', 'install', '--project', project]
    if (time) args.push('--time', time)
    await backend.execAxon(args)
    await fetch()
  }, [backend, project, fetch])

  const remove = useCallback(async () => {
    await backend.execAxon(['cron', 'remove', '--project', project])
    await fetch()
  }, [backend, project, fetch])

  return { status, install, remove, refetch: fetch }
}
```

---

## 5. View Architecture

### Shell Layout

```
┌──────────────────────────────────────────────────────────┐
│  AXON                                         [settings] │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│ PROJECTS │              MAIN CONTENT                     │
│          │                                               │
│ ● my-app │  (TimelineView / StateView / MorningView /   │
│   [3]    │   DecisionExplorerView / SettingsView)        │
│          │                                               │
│ ● axon   │                                               │
│   [1]    │                                               │
│          │                                               │
│ ◐ blog   │                                               │
│          │                                               │
├──────────┤                                               │
│ NAV      │                                               │
│          │                                               │
│ Timeline │                                               │
│ State    │                                               │
│ Morning  │                                               │
│ Decisions│                                               │
└──────────┴───────────────────────────────────────────────┘
```

Sidebar is split: top half lists projects (with StatusDot and open-loop Badge), bottom half lists view navigation for the active project.

### View: Timeline (`/:project/timeline`)

The primary view. A reverse-chronological list of rollup cards.

**Data source:** `useRollups(project)` -- reads episode frontmatter only.

**Card content** (from YAML frontmatter, no markdown parsing):
- `headline` -- the story in one line
- `date` -- rendered as relative ("2 days ago") and absolute
- `tags` -- rendered as pills
- `energy` -- visual indicator (colour or icon)
- `commits`, `decisions`, `openLoops` -- compact metric row
- Click -> navigates to `/:project/timeline/:date` (RollupDetailView)

**Features:**
- Infinite scroll or paginated (episodes are files, so finite)
- Date range filter (date picker narrows the list)
- Tag filter (click a tag pill to filter)
- Visual connectors between cards showing `previous` chain

### View: Rollup Detail (`/:project/timeline/:date`)

Full rollup rendered as HTML.

**Data source:** `useRollup(project, date)` -- reads full file, parses markdown.

**Rendering:**
- YAML frontmatter -> metadata header (date, metrics, tags)
- Markdown body -> rendered via `react-markdown` + `remark-gfm` + `rehype-highlight`
- Decision Traces get special treatment: each DT block renders as an expandable card
- "Unfinished" section renders as interactive checklist (read-only -- state changes go through rollup regeneration)
- "Files Most Touched" renders as a table with file paths
- Back button returns to timeline with scroll position preserved

### View: State (`/:project/state`)

The current project state rendered as a living document.

**Data source:** `useProjectState(project)`

**Rendering:**
- Section-based layout matching state.md structure:
  - "What This Project Is" -> hero paragraph
  - "Current Focus" -> highlighted panel
  - "Where Things Stand" -> status table
  - "Active Decisions" -> decision cards (linked to Decision Explorer)
  - "Open Loops" -> checklist with `[ ]` and `[>]` styling
  - "Blockers" -> red-highlighted items
  - "Suggested Next Move" -> call-to-action panel
  - "Key Files" -> file table
  - "Recent Timeline" -> compact day-by-day list

**Special behaviour:**
- Open Loops with `[>]` markers (rolled over) get visual emphasis -- amber background, day count badge ("3 days")
- "Suggested Next Move" is visually prominent -- this is what the user sees first

### View: Morning (`/:project/morning`)

Embedded chat interface that delegates to `axon morning`.

**Data source:** `useMorning(project)`

**Implementation:**
- On view mount, display the latest rollup summary as a "briefing card" at top
- Below that, show "For tomorrow" items from the most recent rollup
- Chat input at bottom
- When user sends a message, execute `axon morning --project <name>` via `execAxonStreaming`
- Stream stdout into chat bubbles in real-time
- Conversation is saved to `mornings/YYYY-MM-DD.log` by the CLI

**UI pattern:**
- Not a full chat app. Think of it as a "briefing terminal" -- the AI speaks first (summary), then the user can ask follow-up questions
- Messages render markdown inline (code blocks, links, bold)
- Visual distinction between Axon's messages (left-aligned, warm) and user messages (right-aligned)

### View: Decision Explorer (`/:project/decisions`)

Searchable, filterable view of all decision traces across all episodes.

**Data source:** `useDecisions(project)` -- aggregates DT blocks from all episodes.

**Features:**
- Search bar with fuzzy matching (Fuse.js on cached results)
- Each decision renders as a card: ID, title, the four fields (Input, Constraint, Tradeoff, Decision)
- Source link: "from rollup 2026-03-10" -> click navigates to RollupDetailView
- Filter by date range
- Filter by keyword/tag
- Sort by date (default) or relevance (when searching)

### View: Settings (`/settings`)

Project management and cron configuration.

**Data sources:** `useProjects()`, `useCron(project)`, `useConfig(project)`

**Sections:**

1. **Project List** -- all workspaces with status management
   - Status toggle: active / paused / archived (calls `axon archive/pause/resume`)
   - "Initialize new project" button (calls `axon init`)
   - Delete is intentionally absent (manual operation)

2. **Cron Management** (per-project, when a project is selected)
   - Toggle switch: enable/disable nightly rollup
   - Time picker: schedule hour (default 02:00)
   - Status indicator: green (loaded + recent success), amber (loaded + last run failed), grey (not installed)
   - "Run now" button: triggers `axon rollup` via streaming shell exec
   - Run history table: timestamp, duration, exit code, episode link
   - Log viewer: tail of `logs/{project}_rollup.log` and `.err`

3. **Dendrite Configuration** (per-project)
   - Toggles for each dendrite type (git-log, file-tree, session-summary, todo-state, manual-note)
   - Settings per dendrite (e.g., git-log max_commits, file-tree extra_ignore)
   - Writes to project `config.yaml`

4. **Global Settings**
   - Axon home path display
   - CLI path display / health check
   - Git sync status (is `~/.axon` a git repo? remote configured?)

---

## 6. IPC Patterns

Tauri 2 provides three IPC mechanisms. Axon uses all three for different purposes.

### Pattern 1: `invoke` (Request/Response)

For one-shot data fetching. The React frontend calls a Rust command and awaits a typed response.

```typescript
import { invoke } from '@tauri-apps/api/core'

// Frontend calls:
const projects = await invoke<ProjectInfo[]>('list_projects', { axonHome })

// Rust handles:
#[tauri::command]
async fn list_projects(axon_home: String) -> Result<Vec<ProjectInfo>, String> { ... }
```

**Used for:** All filesystem reads (list_projects, list_episodes, read_file_with_frontmatter, read_config, search_decisions, parse_stream, list_dendrites).

### Pattern 2: Events (Push Notifications)

For filesystem watcher notifications. Rust emits events; React listens.

```typescript
import { listen } from '@tauri-apps/api/event'

// Frontend listens:
const unlisten = await listen<FsChangeEvent>('fs-change', (event) => {
  console.log('File changed:', event.payload.path)
  // Trigger re-fetch of affected data
})

// Rust emits:
app.emit("fs-change", FsChangeEvent {
    path: changed_path,
    kind: "modify",
    timestamp: now,
})?;
```

**Used for:** Filesystem change notifications, background process completion signals.

### Pattern 3: Streaming Shell Events

For long-running CLI operations (`axon rollup`, `axon morning`). The process stdout/stderr is streamed as events.

```typescript
// Frontend:
const unlisten1 = await listen<string>('axon-stdout', (e) => {
  appendToChat(e.payload)
})
const unlisten2 = await listen<number>('axon-exit', (e) => {
  setRunning(false)
  if (e.payload === 0) refetchRollups()
})

await invoke('exec_axon_streaming', { args: ['rollup', '--project', project] })
```

**Used for:** `axon rollup` (progress narration), `axon morning` (chat streaming).

### IPC Flow Summary

```
┌────────────┐         invoke          ┌────────────┐
│   React    │ ──────────────────────> │   Rust     │
│            │ <────────────────────── │            │
│            │       Result<T>         │            │
│            │                         │            │
│            │    listen("fs-change")  │            │
│            │ <═══════════════════════│  (notify)  │
│            │       FsChangeEvent     │            │
│            │                         │            │
│            │  listen("axon-stdout")  │            │
│            │ <═══════════════════════│  (shell)   │
│            │    line-by-line stream   │            │
└────────────┘                         └────────────┘
```

---

## 7. Build and Distribution

### Dev Workflow

```bash
# First time setup
cd desktop/
npm install
cd src-tauri && cargo build && cd ..

# Development (React hot-reload + Tauri window)
npm run tauri dev
# This starts Vite dev server on :1420 and opens a Tauri webview pointing at it.
# React changes hot-reload. Rust changes trigger a Tauri rebuild.

# React-only development (no Tauri, uses mock backend)
npm run dev
# Starts Vite on :1420 with mock DataProvider (see Section 8).
# Faster iteration for pure UI work.
```

### `package.json` Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  }
}
```

### `vite.config.ts`

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows'
      ? 'chrome105'
      : process.env.TAURI_ENV_PLATFORM === 'macos'
        ? 'safari14'
        : 'chrome105',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
```

### `tauri.conf.json` (Key sections)

```json
{
  "productName": "Axon",
  "version": "0.1.0",
  "identifier": "com.axon.desktop",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420",
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build"
  },
  "app": {
    "withGlobalTauri": false,
    "windows": [
      {
        "title": "Axon",
        "width": 1200,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "decorations": true,
        "transparent": false
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "signingIdentity": null,
      "entitlements": null
    }
  }
}
```

### macOS .dmg Build

```bash
# Build for release
cd desktop/
npm run tauri:build

# Output location:
# src-tauri/target/release/bundle/dmg/Axon_0.1.0_aarch64.dmg    (Apple Silicon)
# src-tauri/target/release/bundle/macos/Axon.app                  (App bundle)
```

The `.dmg` contains the `.app` bundle (typically 5-15MB for a Tauri app). No Chromium bundled -- uses the system WebKit/WKWebView.

### Capabilities (`src-tauri/capabilities/default.json`)

```json
{
  "identifier": "default",
  "description": "Default capability for Axon",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "shell:allow-spawn",
    "shell:allow-stdin-write"
  ]
}
```

Filesystem access does not require capability permissions in Tauri 2 when accessed through Rust commands (only the JS-side `fs` plugin requires permissions). Since all fs ops go through our Rust commands, we only need shell permissions.

---

## 8. Migration Path — Dual Backend

The `DataProvider` pattern enables developing the React UI without Tauri running. Two backend implementations exist:

### Tauri Backend (Production)

```typescript
// src/lib/tauri-backend.ts
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Backend } from '../providers/DataProvider'

export function createTauriBackend(): Backend {
  let axonHome: string | null = null

  async function getHome(): Promise<string> {
    if (!axonHome) {
      axonHome = await invoke<string>('get_axon_home')
    }
    return axonHome
  }

  return {
    async listProjects() {
      const home = await getHome()
      return invoke<Project[]>('list_projects', { axonHome: home })
    },

    async listEpisodes(project) {
      const home = await getHome()
      return invoke<EpisodeMeta[]>('list_episodes', { axonHome: home, project })
    },

    async readFileWithFrontmatter(path) {
      return invoke<FileContent>('read_file_with_frontmatter', { path })
    },

    async readFile(path) {
      return invoke<string>('read_file', { path })
    },

    async listDendrites(project) {
      const home = await getHome()
      return invoke<DendriteInfo[]>('list_dendrites', { axonHome: home, project })
    },

    async parseStream(project) {
      const home = await getHome()
      return invoke<StreamEntry[]>('parse_stream', { axonHome: home, project })
    },

    async readConfig(path) {
      return invoke<Record<string, unknown>>('read_config', { path })
    },

    async getAxonHome() {
      return getHome()
    },

    async searchDecisions(project, query) {
      const home = await getHome()
      return invoke<DecisionTrace[]>('search_decisions', {
        axonHome: home, project, query,
      })
    },

    async execAxon(args) {
      return invoke<string>('exec_axon', { args })
    },

    async execAxonStreaming(args, onStdout, onStderr) {
      const unlistenOut = await listen<string>('axon-stdout', (e) => onStdout(e.payload))
      const unlistenErr = await listen<string>('axon-stderr', (e) => onStderr(e.payload))

      return new Promise<number>(async (resolve) => {
        const unlistenExit = await listen<number>('axon-exit', (e) => {
          unlistenOut()
          unlistenErr()
          unlistenExit()
          resolve(e.payload)
        })
        await invoke('exec_axon_streaming', { args })
      })
    },

    async getCronStatus(project) {
      return invoke<CronStatus>('get_cron_status', { project })
    },

    async updateConfig(project, key, value) {
      const home = await getHome()
      await invoke('update_config', { axonHome: home, project, key, value })
    },

    async watchDirectory(path, onChange) {
      const unlisten = await listen<FsChangeEvent>('fs-change', (event) => {
        if (event.payload.path.startsWith(path)) {
          onChange(event.payload)
        }
      })
      await invoke('watch_directory', { path })
      return unlisten
    },
  }
}
```

### Mock Backend (Development)

```typescript
// src/lib/mock-backend.ts
import type { Backend } from '../providers/DataProvider'
import fixtureProjects from '../../test/fixtures/projects.json'
import fixtureEpisodes from '../../test/fixtures/episodes.json'
// ... other fixture imports

export function createMockBackend(): Backend {
  return {
    async listProjects() {
      return fixtureProjects as Project[]
    },

    async listEpisodes(project) {
      return (fixtureEpisodes[project] ?? []) as EpisodeMeta[]
    },

    async readFileWithFrontmatter(path) {
      // Read from test/fixtures/ mirroring the path structure
      const response = await fetch(`/fixtures${path.replace(/^.*\.axon/, '')}`)
      const content = await response.text()
      return parseFileContent(path, content)
    },

    async readFile(path) {
      const response = await fetch(`/fixtures${path.replace(/^.*\.axon/, '')}`)
      return response.text()
    },

    // ... all methods return fixture data or no-ops

    async execAxon(args) {
      console.log('[mock] axon', args.join(' '))
      return 'Mock execution complete'
    },

    async execAxonStreaming(args, onStdout) {
      console.log('[mock] axon streaming', args.join(' '))
      onStdout('Mock: Starting rollup...')
      await new Promise(r => setTimeout(r, 500))
      onStdout('Mock: Reading dendrites...')
      await new Promise(r => setTimeout(r, 500))
      onStdout('Mock: Rollup complete.')
      return 0
    },

    async watchDirectory(_path, _onChange) {
      // No-op in dev -- changes come from HMR, not filesystem
      return () => {}
    },

    async getAxonHome() {
      return '/mock/.axon'
    },

    // ... remaining methods
  }
}
```

### Backend Selection at Mount

```typescript
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DataProvider } from './providers/DataProvider'
import { createTauriBackend } from './lib/tauri-backend'
import { createMockBackend } from './lib/mock-backend'

// Detect if running inside Tauri
const isTauri = '__TAURI_INTERNALS__' in window

const backend = isTauri ? createTauriBackend() : createMockBackend()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider backend={backend}>
      <App />
    </DataProvider>
  </StrictMode>,
)
```

### Dev Workflow Comparison

| Mode | Command | Backend | Use case |
|------|---------|---------|----------|
| `npm run dev` | Vite only | Mock | UI development, styling, component work. No Rust needed. |
| `npm run tauri:dev` | Vite + Tauri | Tauri | Full integration. Reads real `~/.axon/`. |

The mock backend serves fixture files from `test/fixtures/` via Vite's public directory. The fixture directory mirrors the `~/.axon/` structure, providing realistic data for all views.

### Vite Config for Fixtures

```typescript
// Addition to vite.config.ts for dev mode:
export default defineConfig({
  // ...existing config
  publicDir: process.env.TAURI_ENV_PLATFORM ? 'public' : 'test/fixtures-public',
})
```

Where `test/fixtures-public/fixtures/` contains the mock `~/.axon/` structure accessible via `fetch('/fixtures/...')`.

---

## 9. Styling Approach

Following the "Editorial Neural" aesthetic from the vision doc.

### Tailwind Configuration

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper palette
        paper: {
          50:  '#FEFDFB',   // lightest cream
          100: '#FBF8F3',   // card background
          200: '#F3EDE3',   // sidebar bg
          300: '#E8DFD0',   // borders
          400: '#D4C5AD',   // muted text
          500: '#B5A48A',   // secondary text
        },
        sage: {
          400: '#8FAE8B',   // accent light
          500: '#6B8F68',   // primary accent
          600: '#567A53',   // accent dark
        },
        ink: {
          300: '#8B8680',   // muted
          400: '#6B6560',   // secondary
          500: '#4A4540',   // body text
          600: '#2E2A26',   // headings
          700: '#1A1715',   // near-black
        },
        status: {
          green:  '#6B8F68',
          amber:  '#C4913E',
          red:    '#B85C5C',
          grey:   '#B5A48A',
        },
      },
      fontFamily: {
        serif:  ['Instrument Serif', 'Crimson Pro', 'Georgia', 'serif'],
        sans:   ['Inter', 'system-ui', 'sans-serif'],
        mono:   ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        // Editorial scale
        'hero':    ['2.5rem',  { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'heading': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'subhead': ['1.25rem', { lineHeight: '1.3' }],
        'body':    ['0.9375rem', { lineHeight: '1.6' }],
        'small':   ['0.8125rem', { lineHeight: '1.5' }],
        'mono':    ['0.8125rem', { lineHeight: '1.5', fontFamily: 'JetBrains Mono' }],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
} satisfies Config
```

### CSS Base Styles

```css
/* src/globals.css */
@import 'tailwindcss';

@layer base {
  body {
    @apply bg-paper-50 text-ink-500 antialiased;
    font-feature-settings: "kern" 1, "liga" 1;
  }

  h1, h2, h3 {
    @apply font-serif text-ink-600;
  }

  code, pre {
    @apply font-mono;
  }
}
```

### Component Styling Pattern

No CSS modules, no styled-components. Tailwind utility classes directly in JSX. The `@tailwindcss/typography` plugin handles markdown rendering via the `prose` class.

```tsx
// Example: RollupCard
function RollupCard({ episode }: { episode: EpisodeMeta }) {
  const { headline, date, tags, energy, commits, decisions, openLoops } = episode.frontmatter

  return (
    <article className="bg-paper-100 border border-paper-300 rounded-lg p-6 hover:shadow-sm transition-shadow">
      <time className="font-mono text-small text-ink-300">{formatDate(date)}</time>
      <h3 className="font-serif text-heading text-ink-600 mt-1">{headline}</h3>

      <div className="flex gap-2 mt-3">
        {tags?.map(tag => (
          <span key={tag} className="font-mono text-small text-sage-600 bg-sage-400/20 px-2 py-0.5 rounded">
            {tag}
          </span>
        ))}
      </div>

      <div className="flex gap-6 mt-4 font-mono text-small text-ink-300">
        <span>{commits} commits</span>
        <span>{decisions} decisions</span>
        <span>{openLoops} open loops</span>
      </div>
    </article>
  )
}
```

---

## 10. Decision Summary

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| Framework | Tauri 2 | ~5MB binary, native fs, WKWebView. Matches "premium, lightweight" ethos. Protocol spec recommends it. |
| Bundler | Vite 6 | Fast HMR, Tauri-native integration, ESM-first. |
| UI | React 19 + TypeScript | Team familiarity, ecosystem depth, concurrent features. |
| Styling | Tailwind 4 + @tailwindcss/typography | Utility-first matches component-per-file pattern. Typography plugin handles markdown rendering. |
| State | Zustand 5 | Store-per-slice maps to data sources. Works outside React (Tauri event handlers). Minimal API. |
| Router | TanStack Router v1 | Type-safe params, search-params-as-state for Decision Explorer. |
| Markdown | react-markdown + remark-gfm + rehype-highlight | Renders rollups/state as HTML with GFM tables and syntax highlighting. |
| Search | Fuse.js | Client-side fuzzy search over cached decision traces. No server needed. |
| YAML parsing (Rust) | serde_yaml | Parse frontmatter in Rust before sending to frontend. |
| YAML parsing (JS) | gray-matter | Parse frontmatter in mock backend / fallback. |
| Filesystem watching | notify 7 (Rust) | Cross-platform fs events, used by Tauri command. |
| Shell execution | tauri-plugin-shell | Spawn axon CLI processes, stream stdout/stderr. |
| Backend abstraction | DataProvider context + Backend interface | Enables mock backend for UI-only development. |
| Write path | Shell exec only | CLI remains single source of truth. UI never writes files directly. |
| Date handling | date-fns 4 | Tree-shakeable, functional API. |
| Fonts | Instrument Serif + JetBrains Mono | Editorial serif for headlines, monospace for metadata. Matches "Editorial Neural" aesthetic. |

---

## 11. Scaffolding Sequence

When ready to build, execute in this order:

1. `npm create tauri-app@latest desktop -- --template vite-react-ts` from `axon-jarvis/`
2. Install additional deps: `zustand`, `@tanstack/react-router`, `react-markdown`, `remark-gfm`, `rehype-highlight`, `gray-matter`, `yaml`, `date-fns`, `fuse.js`, `@tailwindcss/typography`
3. Set up Tailwind with the custom palette
4. Create the `src/lib/types.ts` type definitions
5. Create the `DataProvider` + `Backend` interface
6. Create the mock backend with fixture data
7. Build the Shell layout (Sidebar + content area)
8. Build the Timeline view (rollup cards from fixture data)
9. Wire up TanStack Router with the route structure
10. Build remaining views against mock data
11. Write the Rust commands (`filesystem.rs` first, then `watcher.rs`, then `shell.rs`)
12. Create the Tauri backend implementation
13. Test with real `~/.axon/` data via `npm run tauri:dev`
14. Style pass: fonts, colours, spacing to match Editorial Neural aesthetic
15. Build `.dmg`: `npm run tauri:build`

---

*This document is the build specification. Each section maps to a concrete implementation task.*
