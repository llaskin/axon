import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  startJob, finishJob, getJob, listJobs, jobSummary,
  cleanStaleJobs, closeJobsDb,
} from './jobsDb'

let testDir: string
const PROJECT = 'test-project'

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'axon-jobs-test-'))
  process.env.AXON_HOME = testDir
  mkdirSync(join(testDir, 'workspaces', PROJECT), { recursive: true })
})

afterEach(() => {
  closeJobsDb(PROJECT)
  rmSync(testDir, { recursive: true, force: true })
  delete process.env.AXON_HOME
})

describe('startJob', () => {
  it('creates a running job', () => {
    const job = startJob(PROJECT, 'rollup')
    expect(job.id).toBe(1)
    expect(job.type).toBe('rollup')
    expect(job.status).toBe('running')
    expect(job.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('assigns sequential IDs', () => {
    startJob(PROJECT, 'rollup')
    startJob(PROJECT, 'collect')
    const third = startJob(PROJECT, 'bridge')
    expect(third.id).toBe(3)
  })

  it('accepts different job types', () => {
    const rollup = startJob(PROJECT, 'rollup')
    const collect = startJob(PROJECT, 'collect')
    const bridge = startJob(PROJECT, 'bridge')
    expect(rollup.type).toBe('rollup')
    expect(collect.type).toBe('collect')
    expect(bridge.type).toBe('bridge')
  })
})

describe('finishJob', () => {
  it('marks job as success', () => {
    const job = startJob(PROJECT, 'rollup')
    const finished = finishJob(PROJECT, job.id, {
      status: 'success',
      cost: 2.16,
      episode: '2026-03-16_rollup.md',
    })
    expect(finished.status).toBe('success')
    expect(finished.cost).toBe(2.16)
    expect(finished.episode).toBe('2026-03-16_rollup.md')
    expect(finished.finished_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(finished.duration_s).toBeGreaterThanOrEqual(0)
  })

  it('marks job as failed with error', () => {
    const job = startJob(PROJECT, 'rollup')
    const finished = finishJob(PROJECT, job.id, {
      status: 'failed',
      error: 'no_frontmatter',
    })
    expect(finished.status).toBe('failed')
    expect(finished.error).toBe('no_frontmatter')
  })

  it('stores meta as JSON', () => {
    const job = startJob(PROJECT, 'rollup')
    const meta = { steps: { collect: 12, generate: 480 }, dendrites: 5 }
    const finished = finishJob(PROJECT, job.id, { status: 'success', meta })
    expect(finished.meta).toEqual(meta)
  })

  it('handles finish without optional fields', () => {
    const job = startJob(PROJECT, 'rollup')
    const finished = finishJob(PROJECT, job.id, { status: 'success' })
    expect(finished.cost).toBeUndefined()
    expect(finished.episode).toBeUndefined()
    expect(finished.error).toBeUndefined()
    expect(finished.meta).toBeUndefined()
  })
})

describe('getJob', () => {
  it('retrieves a job by ID', () => {
    startJob(PROJECT, 'rollup')
    const found = getJob(PROJECT, 1)
    expect(found).not.toBeNull()
    expect(found!.type).toBe('rollup')
  })

  it('returns null for nonexistent ID', () => {
    expect(getJob(PROJECT, 999)).toBeNull()
  })
})

describe('listJobs', () => {
  it('lists all jobs newest first', () => {
    startJob(PROJECT, 'rollup')
    startJob(PROJECT, 'collect')
    startJob(PROJECT, 'rollup')
    const jobs = listJobs(PROJECT)
    expect(jobs).toHaveLength(3)
    expect(jobs[0].id).toBe(3) // newest first
    expect(jobs[2].id).toBe(1)
  })

  it('filters by type', () => {
    startJob(PROJECT, 'rollup')
    startJob(PROJECT, 'collect')
    startJob(PROJECT, 'rollup')
    const rollups = listJobs(PROJECT, { type: 'rollup' })
    expect(rollups).toHaveLength(2)
    expect(rollups.every(j => j.type === 'rollup')).toBe(true)
  })

  it('filters by status', () => {
    const j1 = startJob(PROJECT, 'rollup')
    startJob(PROJECT, 'rollup')
    finishJob(PROJECT, j1.id, { status: 'success' })
    const running = listJobs(PROJECT, { status: 'running' })
    expect(running).toHaveLength(1)
    const success = listJobs(PROJECT, { status: 'success' })
    expect(success).toHaveLength(1)
  })

  it('respects limit and offset', () => {
    for (let i = 0; i < 10; i++) startJob(PROJECT, 'rollup')
    const page1 = listJobs(PROJECT, { limit: 3 })
    expect(page1).toHaveLength(3)
    expect(page1[0].id).toBe(10)
    const page2 = listJobs(PROJECT, { limit: 3, offset: 3 })
    expect(page2).toHaveLength(3)
    expect(page2[0].id).toBe(7)
  })
})

describe('jobSummary', () => {
  it('returns correct aggregate stats', () => {
    const j1 = startJob(PROJECT, 'rollup')
    const j2 = startJob(PROJECT, 'rollup')
    const j3 = startJob(PROJECT, 'rollup')
    finishJob(PROJECT, j1.id, { status: 'success', cost: 2.00 })
    finishJob(PROJECT, j2.id, { status: 'success', cost: 3.00 })
    finishJob(PROJECT, j3.id, { status: 'failed', error: 'no_dendrites' })

    const summary = jobSummary(PROJECT)
    expect(summary.total).toBe(3)
    expect(summary.success).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.running).toBe(0)
    expect(summary.total_cost).toBe(5.00)
  })

  it('filters summary by type', () => {
    const r = startJob(PROJECT, 'rollup')
    const c = startJob(PROJECT, 'collect')
    finishJob(PROJECT, r.id, { status: 'success', cost: 2.00 })
    finishJob(PROJECT, c.id, { status: 'success', cost: 0.10 })

    const rollupSummary = jobSummary(PROJECT, 'rollup')
    expect(rollupSummary.total).toBe(1)
    expect(rollupSummary.total_cost).toBe(2.00)
  })

  it('tracks last_run, last_success, last_failure', () => {
    const j1 = startJob(PROJECT, 'rollup')
    finishJob(PROJECT, j1.id, { status: 'success', episode: 'ep1.md' })
    const j2 = startJob(PROJECT, 'rollup')
    finishJob(PROJECT, j2.id, { status: 'failed', error: 'oops' })

    const summary = jobSummary(PROJECT)
    expect(summary.last_run!.id).toBe(j2.id)
    expect(summary.last_success!.episode).toBe('ep1.md')
    expect(summary.last_failure!.error).toBe('oops')
  })

  it('returns zeroes for empty project', () => {
    const summary = jobSummary(PROJECT)
    expect(summary.total).toBe(0)
    expect(summary.success).toBe(0)
    expect(summary.total_cost).toBe(0)
    expect(summary.avg_duration_s).toBe(0)
    expect(summary.last_run).toBeUndefined()
  })
})

describe('cleanStaleJobs', () => {
  it('marks old running jobs as failed', async () => {
    // Manually insert a job with an old started_at
    const { getJobsDb } = await import('./jobsDb')
    const jobsDb = getJobsDb(PROJECT)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    jobsDb.prepare(`
      INSERT INTO jobs (type, status, started_at) VALUES ('rollup', 'running', ?)
    `).run(twoHoursAgo)

    const cleaned = cleanStaleJobs(PROJECT, 60)
    expect(cleaned).toBe(1)

    const job = getJob(PROJECT, 1)!
    expect(job.status).toBe('failed')
    expect(job.error).toBe('stale_timeout')
  })

  it('does not touch recent running jobs', () => {
    startJob(PROJECT, 'rollup') // just started
    const cleaned = cleanStaleJobs(PROJECT, 60)
    expect(cleaned).toBe(0)
  })

  it('does not touch completed jobs', () => {
    const j = startJob(PROJECT, 'rollup')
    finishJob(PROJECT, j.id, { status: 'success' })
    const cleaned = cleanStaleJobs(PROJECT, 0) // even with 0 threshold
    expect(cleaned).toBe(0)
  })
})
