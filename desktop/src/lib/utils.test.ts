import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDate, getGreeting } from './utils'

describe('formatDate', () => {
  it('formats a standard YYYY-MM-DD date', () => {
    expect(formatDate('2026-03-10')).toBe('10 Mar 2026')
  })

  it('formats January correctly', () => {
    expect(formatDate('2026-01-05')).toBe('5 Jan 2026')
  })

  it('formats December correctly', () => {
    expect(formatDate('2025-12-25')).toBe('25 Dec 2025')
  })

  it('strips leading zeros from day', () => {
    expect(formatDate('2026-02-03')).toBe('3 Feb 2026')
  })

  it('returns "genesis" unchanged', () => {
    expect(formatDate('genesis')).toBe('genesis')
  })

  it('returns "never" unchanged', () => {
    expect(formatDate('never')).toBe('never')
  })

  it('returns empty string unchanged', () => {
    expect(formatDate('')).toBe('')
  })

  it('handles non-numeric dash-separated strings gracefully', () => {
    // 'not-a-date' has 3 segments so it enters the format branch
    // parseInt('date') = NaN, MONTHS[NaN] = undefined → falls back to 'a'
    expect(formatDate('not-a-date')).toBe('NaN a not')
    // Truly malformed strings without 3 segments are returned as-is
    expect(formatDate('hello')).toBe('hello')
  })

  it('returns a single-segment string unchanged', () => {
    expect(formatDate('2026')).toBe('2026')
  })

  it('returns a two-segment string unchanged', () => {
    expect(formatDate('2026-03')).toBe('2026-03')
  })

  it('handles all 12 months', () => {
    const expected = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0')
      const result = formatDate(`2026-${mm}-15`)
      expect(result).toBe(`15 ${expected[m - 1]} 2026`)
    }
  })

  it('falls back to raw month segment for invalid month number', () => {
    // Month "13" has no entry in the MONTHS array
    expect(formatDate('2026-13-01')).toBe('1 13 2026')
  })
})

describe('getGreeting', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Good morning." before noon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 8, 0, 0))
    expect(getGreeting()).toBe('Good morning.')
  })

  it('returns "Good morning." at midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 0, 0, 0))
    expect(getGreeting()).toBe('Good morning.')
  })

  it('returns "Good afternoon." at noon', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 12, 0, 0))
    expect(getGreeting()).toBe('Good afternoon.')
  })

  it('returns "Good afternoon." at 4pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 16, 59, 59))
    expect(getGreeting()).toBe('Good afternoon.')
  })

  it('returns "Good evening." at 5pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 17, 0, 0))
    expect(getGreeting()).toBe('Good evening.')
  })

  it('returns "Good evening." at 11pm', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 10, 23, 0, 0))
    expect(getGreeting()).toBe('Good evening.')
  })
})
