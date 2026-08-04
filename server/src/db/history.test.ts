// History series.
//
// The pivot from (snapshot, user) rows into per-user arrays is the whole job here,
// and the ordering matters: the client plots the first N users it is given, so a
// wrong sort silently hides the biggest consumer.

import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { readHistorySeries } from './history.js'

let db: BetterSqlite3.Database

afterEach(() => {
  db?.close()
})

describe('readHistorySeries', () => {
  it('returns the whole-target timeline oldest first', () => {
    db = createFixture()
    const { snapshots } = readHistorySeries(db)
    expect(snapshots.map((s) => s.date)).toEqual([20240101, 20240102])
  })

  it('derives scanned size from the per-user rows', () => {
    db = createFixture()
    const { snapshots } = readHistorySeries(db)
    // Only snapshot 2 has user rows in the fixture: 700 + 80.
    expect(snapshots[0]?.scannedSize).toBe(0)
    expect(snapshots[1]?.scannedSize).toBe(780)
  })

  it('pivots user rows into one series per user', () => {
    db = createFixture()
    const { users } = readHistorySeries(db)
    expect(users.map((u) => u.name)).toEqual(['root', 'syslog'])
    expect(users[0]?.points).toEqual([{ date: 20240102, timestamp: 1704153600, used: 700 }])
  })

  it('plots accounts the scanner marked as kind=other', () => {
    db = createFixture()
    const { users } = readHistorySeries(db)
    // syslog is 'other' because it was absent from duscan's config team_map. The
    // dashboard takes teams from admin.db, so that flag must not hide the line —
    // a disk scanned with no teams configured has *only* 'other' rows.
    expect(users.find((u) => u.name === 'syslog')?.points).toEqual([
      { date: 20240102, timestamp: 1704153600, used: 80 },
    ])
  })

  it('ranks users by their most recent size', () => {
    db = createFixture()
    db.exec(`
      INSERT INTO hist_user_usage (snapshot_id, name, team_id, size, kind) VALUES
        (1, 'late', 1, 10, 'user'),
        (2, 'late', 1, 5000, 'user');
    `)
    // 'late' is small in the first snapshot and largest in the newest, so it must
    // lead — ranking on the first point would bury it.
    expect(readHistorySeries(db).users[0]?.name).toBe('late')
  })

  it('keeps points in scan order within a series', () => {
    db = createFixture()
    db.exec(`
      INSERT INTO hist_user_usage (snapshot_id, name, team_id, size, kind) VALUES
        (1, 'root', 1, 400, 'user');
    `)
    const root = readHistorySeries(db).users.find((u) => u.name === 'root')
    expect(root?.points.map((p) => p.date)).toEqual([20240101, 20240102])
  })

  it('returns empty arrays for a report with no history', () => {
    db = createFixture({ withHistory: false })
    const series = readHistorySeries(db)
    expect(series.snapshots).toEqual([])
    expect(series.users).toEqual([])
  })

  it('does not fail on a report with no hist tables at all', () => {
    // A report from a duscan old enough to predate history would throw on the
    // query; guard by only running it where the tables exist.
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE hist_snapshots (
        id INTEGER PRIMARY KEY, scan_date INTEGER, scanned_at INTEGER,
        path TEXT, total INTEGER, used INTEGER, available INTEGER);
      CREATE TABLE hist_user_usage (
        snapshot_id INTEGER, name TEXT, team_id INTEGER, size INTEGER, kind TEXT);
    `)
    expect(readHistorySeries(db).snapshots).toEqual([])
  })
})
