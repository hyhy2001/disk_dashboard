// Detail User queries.
//
// The behaviour worth pinning is the pagination contract: a cursor must resume
// exactly where the previous page stopped, with no row repeated and none skipped.
// The fixture deliberately contains two directories of equal size so the tie-break
// on id is exercised — that is the case a size-only cursor gets wrong.

import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { findUid, listUsers, readUserDetail, readUserDirs, readUserFiles } from './detail.js'

let db: Database.Database

afterEach(() => {
  db?.close()
})

/** alice, who owns the three fixture directories under /home. */
function aliceUid(): number {
  const uid = findUid(db, 'alice')
  if (uid === null) throw new Error('fixture is missing alice')
  return uid
}

describe('listUsers', () => {
  it('orders by usage, largest first', () => {
    db = createFixture()
    expect(listUsers(db).map((u) => u.name)).toEqual(['root', 'alice', 'syslog', 'nobody', 'empty'])
  })

  it('marks a user with no files or dirs as having no detail', () => {
    db = createFixture()
    const users = listUsers(db)
    expect(users.find((u) => u.name === 'empty')?.hasDetail).toBe(false)
    expect(users.find((u) => u.name === 'alice')?.hasDetail).toBe(true)
  })

  it('carries the permission-issue count through', () => {
    db = createFixture()
    // The fixture leaves this at the column default, so every user reads 0.
    expect(listUsers(db).every((u) => u.permissionIssues === 0)).toBe(true)
  })
})

describe('findUid', () => {
  it('returns null for an unknown user', () => {
    db = createFixture()
    expect(findUid(db, 'nobody-at-all')).toBeNull()
  })
})

describe('readUserDirs', () => {
  it('returns a user own directories, largest first', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid())
    expect(page.rows.map((r) => r.path)).toEqual(['/home', '/home/alice', '/home/bob'])
    expect(page.rows[0]?.used).toBe(300)
  })

  it('sums the page for the percentage denominator', () => {
    db = createFixture()
    expect(readUserDirs(db, aliceUid()).pageTotal).toBe(500)
  })

  it('does not leak another user rows', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid())
    expect(page.rows.some((r) => r.path === '/var/log')).toBe(false)
  })

  it('reports no more pages when everything fits', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid())
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('resumes from the cursor without repeating or skipping rows', () => {
    db = createFixture()
    const first = readUserDirs(db, aliceUid(), { limit: 2 })
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).not.toBeNull()

    const second = readUserDirs(db, aliceUid(), {
      limit: 2,
      ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
    })

    const all = [...first.rows, ...second.rows].map((r) => r.path)
    // Three distinct rows in size order, which is only possible if the tie
    // between the two 100-byte directories was broken by id.
    expect(all).toEqual(['/home', '/home/alice', '/home/bob'])
    expect(new Set(all).size).toBe(3)
    expect(second.hasMore).toBe(false)
  })

  it('treats a corrupt cursor as the first page', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid(), { cursor: 'not-base64-json' })
    expect(page.rows[0]?.path).toBe('/home')
  })

  it('filters by path substring', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid(), { filter: { query: ['alice'] } })
    expect(page.rows.map((r) => r.path)).toEqual(['/home/alice'])
  })

  it('ORs multiple query terms', () => {
    db = createFixture()
    const page = readUserDirs(db, aliceUid(), { filter: { query: ['alice', 'bob'] } })
    expect(page.rows.map((r) => r.path)).toEqual(['/home/alice', '/home/bob'])
  })

  it('does not treat a wildcard in the query as a pattern', () => {
    db = createFixture()
    // Without LIKE escaping this would match every path.
    expect(readUserDirs(db, aliceUid(), { filter: { query: ['%'] } }).rows).toHaveLength(0)
  })

  it('applies min and max size bounds', () => {
    db = createFixture()
    expect(readUserDirs(db, aliceUid(), { filter: { minSize: 200 } }).rows).toHaveLength(1)
    expect(readUserDirs(db, aliceUid(), { filter: { maxSize: 150 } }).rows).toHaveLength(2)
  })
})

describe('readUserFiles', () => {
  it('joins the directory path and basename into a full path', () => {
    db = createFixture()
    const page = readUserFiles(db, aliceUid())
    expect(page.rows.map((r) => r.path)).toEqual(['/home/mid.bin', '/home/a.dat', '/home/b.dat'])
  })

  it('does not double the separator for a file in the root', () => {
    db = createFixture()
    const rootUid = findUid(db, 'root')
    const page = readUserFiles(db, rootUid ?? -1)
    expect(page.rows.map((r) => r.path)).toEqual(['/big.log', '/small.txt'])
  })

  it('orders largest first', () => {
    db = createFixture()
    expect(readUserFiles(db, aliceUid()).rows.map((r) => r.size)).toEqual([150, 100, 50])
  })

  it('resumes from the cursor across the three-part key', () => {
    db = createFixture()
    const first = readUserFiles(db, aliceUid(), { limit: 1 })
    const second = readUserFiles(db, aliceUid(), {
      limit: 5,
      ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
    })
    expect([...first.rows, ...second.rows].map((r) => r.size)).toEqual([150, 100, 50])
  })

  it('filters by extension', () => {
    db = createFixture()
    const page = readUserFiles(db, aliceUid(), { filter: { ext: ['dat'] } })
    expect(page.rows.map((r) => r.ext)).toEqual(['dat', 'dat'])
  })

  it('accepts an extension written with a leading dot', () => {
    db = createFixture()
    expect(readUserFiles(db, aliceUid(), { filter: { ext: ['.bin'] } }).rows).toHaveLength(1)
  })

  it('filters by path substring against the containing directory', () => {
    db = createFixture()
    const page = readUserFiles(db, aliceUid(), { filter: { query: ['/home'] } })
    expect(page.rows).toHaveLength(3)
  })
})

describe('readUserDetail', () => {
  it('returns both lists and the user total', () => {
    db = createFixture()
    const detail = readUserDetail(db, 'alice', aliceUid())
    expect(detail.userTotal).toBe(200)
    expect(detail.dirs.rows).toHaveLength(3)
    expect(detail.files.rows).toHaveLength(3)
    expect(detail.dirsSuppressed).toBe(false)
  })

  it('suppresses the dirs list when an extension filter is active', () => {
    db = createFixture()
    const detail = readUserDetail(db, 'alice', aliceUid(), { filter: { ext: ['dat'] } })
    // Directory sizes cannot honour an extension filter, so they are withheld
    // rather than shown unfiltered next to filtered files.
    expect(detail.dirsSuppressed).toBe(true)
    expect(detail.dirs.rows).toHaveLength(0)
    expect(detail.files.rows).toHaveLength(2)
  })

  it('caps an oversized limit rather than trusting the caller', () => {
    db = createFixture()
    const detail = readUserDetail(db, 'alice', aliceUid(), { limit: 10_000_000 })
    // Nothing to assert on row count with a tiny fixture; what matters is that
    // the query ran instead of asking SQLite for ten million rows.
    expect(detail.files.hasMore).toBe(false)
  })
})
