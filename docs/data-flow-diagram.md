# Axon Claude History Tracker — Data Flow Diagram

## Overview

All data stays local by default. The **only outbound call** is the `claude` CLI during nightly rollups, which sends only redacted session summaries to the Anthropic API.

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LOCAL MACHINE                                │
│                                                                     │
│  ┌─────────────────────────────────────┐                           │
│  │   Claude Code Data (read-only)      │                           │
│  │                                     │                           │
│  │  ~/.claude/projects/*/              │                           │
│  │    sessions-index.json              │──┐                        │
│  │    {sessionId}.jsonl ◄──────────────│──┤ Full transcripts:      │
│  │                                     │  │ user prompts,          │
│  │  ~/.claude/history.jsonl            │──┤ assistant responses,   │
│  │    (user prompts only)              │  │ tool calls, errors     │
│  │                                     │  │                        │
│  │  ~/.claude/session-manager-meta.json│  │ User metadata:         │
│  │    (tags, pins, nicknames)          │  │ tags, pins, nicknames  │
│  └─────────────────────────────────────┘  │                        │
│                                           │                        │
│                   ┌───────────────────────┘                        │
│                   ▼                                                 │
│  ┌─────────────────────────────────────┐                           │
│  │   Session Indexer (TypeScript)       │                           │
│  │   desktop/src/lib/sessionIndexer.ts  │                           │
│  │                                     │                           │
│  │   Phase 1: Fast scan (index.json)   │                           │
│  │   Phase 2: Analytics (JSONL parse)  │                           │
│  │   Phase 3: FTS index (search)       │                           │
│  └──────────────┬──────────────────────┘                           │
│                 │                                                   │
│                 ▼                                                   │
│  ┌─────────────────────────────────────┐                           │
│  │   Sessions SQLite DB                │                           │
│  │   ~/.axon/sessions.db               │ NEVER LEAVES MACHINE      │
│  │                                     │                           │
│  │   Tables:                           │                           │
│  │   - sessions (metadata, analytics)  │                           │
│  │   - files_touched (per session)     │                           │
│  │   - session_fts (full-text search)  │                           │
│  └──────────┬──────────┬──────────────┘                           │
│             │          │                                           │
│     ┌───────┘          └────────┐                                  │
│     ▼                           ▼                                  │
│  ┌──────────────────┐  ┌──────────────────────────┐               │
│  │ Electron UI       │  │ Session Dendrite          │               │
│  │ (localhost only)  │  │ sessionDendrite.ts         │               │
│  │                   │  │                            │               │
│  │ Day View          │  │ 1. Query SQLite (since)    │               │
│  │ Session View      │  │ 2. Load history.jsonl      │               │
│  │ Project View      │  │ 3. ┌─────────────────┐    │               │
│  │                   │  │    │ REDACTION LAYER  │    │               │
│  │ Prompt Timeline ◄─┤  │    │ redact.ts        │    │               │
│  │ (from history.jsonl│  │    │                  │    │               │
│  │  via redact.ts)   │  │    │ Scrubs:          │    │               │
│  │                   │  │    │ - API keys       │    │               │
│  │ Detail Panel      │  │    │ - GitHub tokens  │    │               │
│  │ Related Sessions  │  │    │ - Slack tokens   │    │               │
│  │                   │  │    │ - JWTs           │    │               │
│  │ NO NETWORK CALLS  │  │    │ - AWS keys       │    │               │
│  └──────────────────┘  │    │ - Conn strings   │    │               │
│                         │    │ - Private keys   │    │               │
│                         │    │ - .env secrets   │    │               │
│                         │    │ - Custom patterns│    │               │
│                         │    └─────────────────┘    │               │
│                         │ 4. pastedContents STRIPPED │               │
│                         │ 5. Write markdown dendrite │               │
│                         └──────────┬─────────────────┘               │
│                                    │                                 │
│                                    ▼                                 │
│  ┌─────────────────────────────────────┐                           │
│  │   ~/.axon/workspaces/claude-sessions│ NEVER LEAVES MACHINE      │
│  │                                     │                           │
│  │   dendrites/                        │                           │
│  │     {timestamp}_claude-sessions.md  │ ◄── Redacted summaries   │
│  │                                     │                           │
│  │   episodes/                         │                           │
│  │     {date}_rollup.md               │ ◄── AI-generated rollups  │
│  │                                     │                           │
│  │   state.md                          │ ◄── Current context       │
│  │   config.yaml                       │                           │
│  │   stream.md                         │                           │
│  └──────────────┬──────────────────────┘                           │
│                 │                                                   │
│                 │  axon-rollup reads redacted                       │
│                 │  dendrites + state.md                             │
│                 ▼                                                   │
│  ┌─────────────────────────────────────┐                           │
│  │   axon-rollup (bash + claude CLI)   │                           │
│  │                                     │                           │
│  │   Assembles prompt from:            │                           │
│  │   - Redacted dendrites              │                           │
│  │   - state.md                        │                           │
│  │   - Recent episodes                 │                           │
│  │                                     │                           │
│  │   Rollup agent has NO tool access   │                           │
│  │   (allowed_tools: [] in config)     │                           │
│  └──────────────┬──────────────────────┘                           │
│                 │                                                   │
└─────────────────┼───────────────────────────────────────────────────┘
                  │
══════════════════╪═══════════════════════ NETWORK BOUNDARY ═══════════
                  │
                  │  ONLY redacted text crosses this line:
                  │  - Session summaries (heuristic, not raw transcripts)
                  │  - Redacted prompt text (secrets scrubbed)
                  │  - NO pastedContents
                  │  - NO file contents from sessions
                  │  - NO raw JSONL data
                  │  - NO SQLite data
                  │
                  ▼
┌─────────────────────────────────────────┐
│   Anthropic API                         │
│   (via claude CLI)                      │
│                                         │
│   Receives: redacted rollup prompt      │
│   Returns: synthesized rollup text      │
│                                         │
│   Subject to Anthropic data policies    │
│   (same as normal Claude Code usage)    │
└─────────────────────────────────────────┘
```

## What Leaves Your Machine

| Data | Destination | When | Content |
|------|------------|------|---------|
| Redacted session summaries | Anthropic API | During rollup only | Heuristic summaries, tool counts, file names (no file contents) |
| Redacted prompt text | Anthropic API | During rollup only | User prompts with secrets scrubbed |

## What NEVER Leaves Your Machine

| Data | Storage Location |
|------|-----------------|
| Raw session JSONL files | `~/.claude/projects/*/` |
| `history.jsonl` | `~/.claude/history.jsonl` |
| Full prompt text (unredacted) | Only in memory during redaction, never persisted outside `~/.claude/` |
| `pastedContents` | Stripped at parse time, never written to `~/.axon/` |
| Session metadata (tags, pins) | `~/.claude/session-manager-meta.json` |
| SQLite database | `~/.axon/sessions.db` |
| All `~/.axon/` files | `~/.axon/workspaces/claude-sessions/` |
| Assistant responses | `~/.claude/projects/*/*.jsonl` (never read by dendrite) |
| File contents from tool calls | `~/.claude/projects/*/*.jsonl` (never extracted) |

## Electron Security

- Express server binds to `127.0.0.1` only — not accessible from network
- No remote URLs loaded — all content is local files
- No `nodeIntegration` in renderer process
- No auto-update mechanism (no phoning home)
- Rollup agent has no tool access (cannot read arbitrary files)
