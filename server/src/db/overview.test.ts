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

    // scanned is the sum of snapshot 2's user rows: 700 + 80 = 780.
    expect(out.capacity).toEqual({ total: 10_000, used: 6500, available: 3500, scanned: 780 })
  })

  it('derives scanned size per snapshot from its user rows', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    // Snapshot 1 has no hist_user_usage rows, snapshot 2 has 700 + 80.
    expect(out.history.map((h) => h.scannedSize)).toEqual([0, 780])
  })

  it('keeps scanned below used, exposing unattributed space', () => {
    db = createFixture()
    const cap = readOverview(db, TARGET).capacity

    // The gap is the point of tracking both: 6500 used, only 780 attributed.
    expect(cap?.scanned).toBeLessThan(cap?.used ?? 0)
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

  it('resolves each mapped user to its team display name', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    // detail_users.team_id is text '1'; hist_team_usage.team_id is integer 1.
    // They must still join, or the donut filter would match nothing.
    expect(out.users.map((u) => u.team)).toEqual(['ALPHA', 'ALPHA'])
  })

  it('leaves team undefined for unmapped users', () => {
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.otherUsers.every((u) => u.team === undefined)).toBe(true)
  })

  it('does not duplicate users when several snapshots exist', () => {
    // The team-name join must be scoped to one snapshot; without that scoping,
    // ALPHA appearing in both snapshots would double every mapped user.
    db = createFixture()
    const out = readOverview(db, TARGET)

    expect(out.users).toHaveLength(2)
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
    // With no snapshot there is no name to resolve, but the user must still list.
    expect(out.users[0]?.team).toBeUndefined()
  })

  it('passes the target row through unchanged', () => {
    db = createFixture()
    expect(readOverview(db, TARGET).target).toEqual(TARGET)
  })
})
