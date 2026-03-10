import { describe, it, expect } from 'vitest'
import { parseFrontmatter, extractSummary, parseDecisionTraces } from './parser'

describe('parseFrontmatter', () => {
  it('parses valid YAML frontmatter', () => {
    const content = `---
type: rollup
date: 2026-03-10
project: axon
headline: "Desktop app scaffolded"
tags: [architecture, shipping]
energy: high
commits: 14
---

## Summary

Built the desktop app.`

    const result = parseFrontmatter(content)
    expect(result.ok).toBe(true)
    expect(result.data?.frontmatter).toEqual({
      type: 'rollup',
      date: '2026-03-10',
      project: 'axon',
      headline: 'Desktop app scaffolded',
      tags: ['architecture', 'shipping'],
      energy: 'high',
      commits: 14,
    })
    expect(result.data?.body).toContain('## Summary')
    expect(result.data?.body).toContain('Built the desktop app.')
  })

  it('handles content without frontmatter', () => {
    const content = '## Just a heading\n\nSome text.'
    const result = parseFrontmatter(content)
    expect(result.ok).toBe(true)
    expect(result.data?.frontmatter).toEqual({})
    expect(result.data?.body).toBe(content)
  })

  it('handles empty content', () => {
    const result = parseFrontmatter('')
    expect(result.ok).toBe(true)
    expect(result.data?.body).toBe('')
  })

  it('handles malformed YAML', () => {
    const content = `---
: broken: yaml: [
---
Body.`
    const result = parseFrontmatter(content)
    // Should either fail gracefully or return empty frontmatter
    expect(result).toBeDefined()
  })
})

describe('extractSummary', () => {
  it('extracts summary section', () => {
    const body = `## Summary

Built the desktop app with React and Vite. Added neural background.

## Key Decisions

...`
    const summary = extractSummary(body)
    expect(summary).toContain('Built the desktop app')
    expect(summary).not.toContain('Key Decisions')
  })

  it('falls back to first paragraph when no summary heading', () => {
    const body = 'First line of content.\nSecond line.\n\n## Other Section'
    const summary = extractSummary(body)
    expect(summary).toContain('First line')
  })

  it('respects maxLines', () => {
    const body = `## Summary

Line one.
Line two.
Line three.
Line four.
Line five.`
    const summary = extractSummary(body, 2)
    expect(summary.split(' ').length).toBeLessThan(20)
  })

  it('handles empty body', () => {
    expect(extractSummary('')).toBe('')
  })
})

describe('parseDecisionTraces', () => {
  it('parses DT-N format decision traces', () => {
    const body = `## Key Decisions

### DT-1: Use Tailwind v4

**Input:** Need a CSS framework
**Constraint:** Must support dark mode theming
**Tradeoff:** Tailwind v4 has breaking changes vs v3 stability
**Decision:** Use Tailwind v4 with @theme directive for CSS var theming

### DT-2: Filesystem as API

**Input:** Need data persistence
**Constraint:** No server for v1
**Tradeoff:** SQLite would be faster but adds a dependency
**Decision:** Use YAML frontmatter files — zero deps, git-versionable`

    const decisions = parseDecisionTraces(body)
    expect(decisions).toHaveLength(2)

    expect(decisions[0].id).toBe('DT-1')
    expect(decisions[0].title).toBe('Use Tailwind v4')
    expect(decisions[0].input).toContain('CSS framework')
    expect(decisions[0].constraint).toContain('dark mode')
    expect(decisions[0].tradeoff).toContain('breaking changes')
    expect(decisions[0].decision).toContain('@theme directive')

    expect(decisions[1].id).toBe('DT-2')
    expect(decisions[1].title).toBe('Filesystem as API')
  })

  it('parses D-N format', () => {
    const body = `## Decisions

#### D1: Shell scripts for CLI

**Input:** Need a CLI tool
**Decision:** Use shell scripts — zero deps`

    const decisions = parseDecisionTraces(body)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].id).toBe('D1')
    expect(decisions[0].title).toBe('Shell scripts for CLI')
  })

  it('handles missing fields', () => {
    const body = `### DT-1: Quick choice

**Decision:** Just do it`

    const decisions = parseDecisionTraces(body)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].decision).toContain('Just do it')
    expect(decisions[0].input).toBe('')
    expect(decisions[0].constraint).toBe('')
    expect(decisions[0].tradeoff).toBe('')
  })

  it('returns empty array when no decisions', () => {
    const body = '## Summary\n\nJust a normal rollup.'
    expect(parseDecisionTraces(body)).toHaveLength(0)
  })
})
