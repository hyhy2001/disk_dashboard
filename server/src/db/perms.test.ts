// Permission-issue queries.
//
// Two states need distinguishing and both look like "nothing here" from the
// client: a report whose scan found no unreadable paths (normal when duscan runs
// as root), and a report written before perm_issues existed. The first is a real
// answer, the second is a missing capability.

import Database from 'better-sqlite3'
import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { hasPermTable, readPermIssues, UNKNOWN_USER } from './perms.js'

let db: BetterSqlite3.Database

afterEach(() => {
  db?.close()
})

describe('hasPermTable', () => {
  it('is true for a current report', () => {
    db = createFixture()
    expect(hasPermTable(db)).toBe(true)
  })

  it('is false for a report predating the table', () => {
    db = new Database(':memory:')
    expect(hasPermTable(db)).toBe(false)
  })
})

describe('readPermIssues', () => {
  it('returns an empty page instead of throwing on an old report', () => {
    db = new Database(':memory:')
    const page = readPermIssues(db)
    expect(page.total).toBe(0)
    expect(page.rows).toEqual([])
  })

  it('lists every issue in insertion order', () => {
    db = createFixture()
    const page = readPermIssues(db)
    expect(page.total).toBe(5)
    expect(page.rows.map((r) => r.path)).toEqual([
      '/proc/1/fd',
      '/proc/1/mem',
      '/home/alice/.ssh',
      '/mnt/nfs/gone',
      '/srv/orphan',
    ])
  })

  it('buckets an empty username under the unknown sentinel', () => {
    db = createFixture()
    const page = readPermIssues(db)
    expect(page.rows.find((r) => r.path === '/mnt/nfs/gone')?.user).toBe(UNKNOWN_USER)
  })

  it('reports the sentinel duscan itself writes under the same bucket', () => {
    // pipe_permission.rs stores the literal '__unknown__' when the uid has no
    // passwd entry, so the row must not surface as a separate user.
    db = createFixture()
    const page = readPermIssues(db)
    expect(page.rows.find((r) => r.path === '/srv/orphan')?.user).toBe(UNKNOWN_USER)
  })

  it('counts issues per user for the filter chips', () => {
    db = createFixture()
    const counts = readPermIssues(db).userCounts
    expect(counts.find((c) => c.name === 'root')?.count).toBe(2)
    // Both the empty string and duscan's literal collapse into one chip.
    expect(counts.find((c) => c.name === UNKNOWN_USER)?.count).toBe(2)
    expect(counts.filter((c) => c.name === UNKNOWN_USER)).toHaveLength(1)
  })

  it('counts issues per distinct error', () => {
    db = createFixture()
    const errors = readPermIssues(db).errorCounts
    expect(errors[0]).toEqual({ error: 'Permission denied', count: 4 })
  })

  it('filters by user', () => {
    db = createFixture()
    const page = readPermIssues(db, { users: ['root'] })
    expect(page.total).toBe(2)
    expect(page.rows.every((r) => r.user === 'root')).toBe(true)
  })

  it('can select the unknown bucket by its sentinel name', () => {
    db = createFixture()
    const page = readPermIssues(db, { users: [UNKNOWN_USER] })
    // The chip's count and the page it opens have to agree: filtering only on
    // the empty string returned just one of the two rows behind the chip.
    expect(page.total).toBe(2)
    expect(page.rows.map((r) => r.path)).toEqual(['/mnt/nfs/gone', '/srv/orphan'])
  })

  it('combines a named user with the unknown bucket', () => {
    db = createFixture()
    expect(readPermIssues(db, { users: ['alice', UNKNOWN_USER] }).total).toBe(3)
  })

  it('filters by item type', () => {
    db = createFixture()
    expect(readPermIssues(db, { itemType: 'file' }).total).toBe(2)
    expect(readPermIssues(db, { itemType: 'directory' }).total).toBe(3)
  })

  it('filters by path substring', () => {
    db = createFixture()
    expect(readPermIssues(db, { path: '/proc' }).total).toBe(2)
  })

  it('does not treat a wildcard in the path filter as a pattern', () => {
    db = createFixture()
    expect(readPermIssues(db, { path: '%' }).total).toBe(0)
  })

  it('reports the filtered total, not the table total', () => {
    db = createFixture()
    const page = readPermIssues(db, { users: ['alice'] })
    // A viewer paging a filtered list needs the filtered count, or the page
    // numbers would run past the end.
    expect(page.total).toBe(1)
    expect(page.hasMore).toBe(false)
  })

  it('pages by offset and reports whether more remain', () => {
    db = createFixture()
    const first = readPermIssues(db, { limit: 2 })
    expect(first.rows).toHaveLength(2)
    expect(first.hasMore).toBe(true)

    const second = readPermIssues(db, { limit: 2, offset: 2 })
    expect(second.rows.map((r) => r.path)).toEqual(['/home/alice/.ssh', '/mnt/nfs/gone'])
    expect(second.hasMore).toBe(true)
  })

  it('keeps the summaries unfiltered so chip counts stay stable', () => {
    db = createFixture()
    // If the counts followed the filter, selecting one user would zero every
    // other chip and there would be no way back.
    const page = readPermIssues(db, { users: ['root'] })
    expect(page.userCounts).toHaveLength(3)
  })
})
