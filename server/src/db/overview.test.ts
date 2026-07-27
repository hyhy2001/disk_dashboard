import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { Target } from '../../../shared/api.js'
import { createFixture } from './fixture.js'
import { readOverview } from './overview.js'

let db: Database.Database

const TARGET: Target = {
  name: 'fixture',
  scanRoot: '/',
  scanTimestamp: 1_700_000_000,
  totalFiles: 42,
  totalDirs: 4,
  totalSize: 1000,
  dbSizeBytes: 4096,
}

afterEach(() => {
  db?.close()
})

describe('readOverview', () => {
  it('takes capacity from the newest snapshot', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.capacity).toEqual({ total: 10_000, used: 6500, available: 3500 })
  })

  it('returns history oldest first so the client can plot it directly', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.history.map((h) => h.date)).toEqual([20_240_101, 20_240_102])
    expect(out.history[0]?.usedSize).toBe(6000)
  })

  it('rolls up teams from the newest snapshot only, dropping empty ones', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    // ALPHA 5400 is the snapshot-2 value, not snapshot-1's 5000.
    // GAMMA has size 0 and must not appear.
    expect(out.teams).toEqual([
      { name: 'ALPHA', used: 5400 },
      { name: 'BETA', used: 1100 },
    ])
  })

  it('splits users by team mapping, treating empty string as unmapped', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.users.map((u) => u.name)).toEqual(['root', 'alice'])
    // syslog has NULL team_id, nobody has ''. Both are "other" in legacy terms.
    expect(out.otherUsers.map((u) => u.name)).toEqual(['syslog', 'nobody'])
  })

  it('omits users with zero usage from both lists', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)
    const names = [...out.users, ...out.otherUsers].map((u) => u.name)

    expect(names).not.toContain('empty')
  })

  it('orders users largest first', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.users.map((u) => u.used)).toEqual([700, 200])
  })

  it('reports null capacity and empty teams when no scan history exists', () => {
    db = createFixture({ withHistory: false })
    const out = readOverview(db, TARGET)

    expect(out.capacity).toBeNull()
    expect(out.history).toEqual([])
    expect(out.teams).toEqual([])
    // Current-scan user data does not depend on history.
    expect(out.users.length).toBeGreaterThan(0)
  })

  it('passes the target row through unchanged', () => {
    db = createFixture()
    expect(readOverview(db, TARGET).target).toEqual(TARGET)
  })
})
