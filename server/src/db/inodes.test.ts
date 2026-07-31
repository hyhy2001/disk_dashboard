// Inode stats.
//
// Two things here are worth guarding. First, the inode columns arrived after
// hist_snapshots shipped, so the query has to work against a report that does not
// have them — that is not a hypothetical, it is every report scanned before the
// change. Second, a filesystem with no fixed inode table reports 0, and treating
// that as a real total would render a full disk.

import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { hasInodeColumns, readInodeStats } from './inodes.js'

let db: BetterSqlite3.Database

afterEach(() => {
  db?.close()
})

describe('readInodeStats', () => {
  it('reads the newest snapshot figures', () => {
    db = createFixture({ withInodes: true })
    const stats = readInodeStats(db)
    expect(stats.systemAvailable).toBe(true)
    expect(stats.total).toBe(8000)
    expect(stats.used).toBe(3000)
    expect(stats.free).toBe(5000)
    expect(stats.scanned).toBe(31)
    expect(stats.timestamp).toBe(1704153600)
  })

  it('lists users by inode count, largest first', () => {
    db = createFixture({ withInodes: true })
    const stats = readInodeStats(db)
    // Fixture: root 20, alice 5, syslog 3, nobody 1, empty 0.
    expect(stats.users.map((u) => u.name)).toEqual(['root', 'alice', 'syslog', 'nobody'])
    expect(stats.users[0]).toEqual({ name: 'root', inodes: 20, dirs: 2 })
  })

  it('drops accounts that own nothing', () => {
    db = createFixture({ withInodes: true })
    const stats = readInodeStats(db)
    // 'empty' has 0 files and 0 dirs: a card for it says nothing.
    expect(stats.users.map((u) => u.name)).not.toContain('empty')
  })

  it('keeps a directory-only account', () => {
    db = createFixture({ withInodes: true })
    db.exec(
      `INSERT INTO detail_users (uid, username, team_id, total_files, total_dirs, total_size)
       VALUES (200, 'dironly', NULL, 0, 7, 0)`,
    )
    const stats = readInodeStats(db)
    // Directories consume inodes, so owning only directories is still a footprint.
    expect(stats.users.find((u) => u.name === 'dironly')).toEqual({
      name: 'dironly',
      inodes: 0,
      dirs: 7,
    })
  })

  it('reports no system figures on a report that predates the columns', () => {
    db = createFixture()
    expect(hasInodeColumns(db)).toBe(false)
    const stats = readInodeStats(db)
    expect(stats.systemAvailable).toBe(false)
    expect(stats.total).toBeNull()
    expect(stats.used).toBeNull()
    expect(stats.free).toBeNull()
    // The per-user breakdown survives — detail_users is unaffected by the
    // migration, so the tab still has something to show.
    expect(stats.users.length).toBeGreaterThan(0)
  })

  it('still dates a report that predates the columns', () => {
    db = createFixture()
    // The report has snapshots, so claiming "no snapshot" would be wrong: the
    // per-user figures it does have came from the newest one.
    expect(readInodeStats(db).timestamp).toBe(1704153600)
  })

  it('falls back to the attributed count when the snapshot has none', () => {
    db = createFixture()
    const stats = readInodeStats(db)
    // Files + dirs across the fixture's users: (20+2) + (5+0) + (3+0) + (1+0).
    expect(stats.scanned).toBe(32)
  })

  it('treats a snapshot with NULL inodes as unavailable', () => {
    db = createFixture({ withInodes: true })
    db.exec('UPDATE hist_snapshots SET inodes_total = NULL')
    const stats = readInodeStats(db)
    // The columns exist but this scan ran before they did.
    expect(stats.systemAvailable).toBe(false)
    expect(stats.total).toBeNull()
  })

  it('reports a zero inode table as not reported rather than full', () => {
    db = createFixture({ withInodes: true })
    // btrfs, dynamic-inode XFS and most NFS mounts report f_files = 0.
    db.exec('UPDATE hist_snapshots SET inodes_total = 0, inodes_used = 0, inodes_free = 0')
    const stats = readInodeStats(db)
    expect(stats.total).toBeNull()
    expect(stats.used).toBeNull()
    // The walk's own count does not come from statvfs, so it survives.
    expect(stats.scanned).toBe(31)
  })

  it('survives a report with no history at all', () => {
    db = createFixture({ withHistory: false })
    const stats = readInodeStats(db)
    expect(stats.systemAvailable).toBe(false)
    expect(stats.timestamp).toBe(0)
    expect(stats.scanned).toBe(32)
  })
})
