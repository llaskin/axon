# CLAUDE.md

## What is Axon?

Axon is a CLI-first context system for developers building with AI. It solves the "Prompt Tax" — the 15+ minutes/day developers lose re-explaining context to AI tools.

**Core loop:** Dendrites (signals) -> Nightly Rollup (AI synthesis) -> Morning Briefing (conversational)

## Architecture

```
~/.axon/
├── workspaces/{project}/
│   ├── state.md           # Current context snapshot (Tier 3)
│   ├── stream.md          # Append-only raw log (Tier 1)
│   ├── episodes/          # Rollups + session captures (Tier 2)
│   ├── dendrites/         # Raw input signals
│   ├── mornings/          # Morning briefing conversations
│   └── config.yaml        # Per-project config
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `axon init` | Genesis rollup for a new project |
| `axon collect` | Gather dendrite signals (git-log, file-tree) |
| `axon rollup` | Collect + Claude headless -> episode + state update |
| `axon morning` | Interactive briefing with full context injection |
| `axon log` | Quick note to stream |
| `axon status` | Project state at a glance |
| `axon sync` | Push/pull memory to remote |
| `axon cron` | Install/remove nightly rollup schedule |

## Key Files

- `cli/` — Shell scripts (the product). Zero dependencies beyond `claude`, `jq`, `git`.
- `protocol.md` — Injected into Claude via `--append-system-prompt`. Defines Axon behavior.
- `docs/PROTOCOL_SPEC.md` — Full system specification.
- `docs/AXON_JARVIS_VISION.md` — Product vision + design direction.

## Key Concepts

- **Dendrites**: Input signals (git-log, file-tree). YAML frontmatter + markdown.
- **Rollups**: AI-synthesized daily summaries with Decision Traces (Input -> Constraint -> Tradeoff -> Decision).
- **State**: Regenerated after each rollup. Under 2000 tokens. The "current context" snapshot.
- **Protocol injection**: `--append-system-prompt` on Claude CLI. No MCP needed for v0.
- **Git versioning**: `~/.axon/` is itself a git repo. Each rollup auto-commits.

## Design Principles

1. **Protocol over Platform** — Markdown files, portable, readable in 20 years
2. **Human-in-the-Loop** — Dendrites are opt-in, rollups are reviewable
3. **Decouple Memory from Compute** — Memory is local files, compute is rented LLMs
4. **Narrative over Metrics** — Rollups tell stories, not just numbers
