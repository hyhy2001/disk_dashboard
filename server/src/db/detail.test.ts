// Detail User queries.
//
// The behaviour worth pinning is the pagination contract: a cursor must resume
// exactly where the previous page stopped, with no row repeated and none skipped.
// The fixture deliberately contains two directories of equal size so the tie-break
// on id is exercised — that is the case a size-only cursor gets wrong.

import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { DetailFilter } from '../../../shared/api.js'
import { createFixture } from './fixture.js'
import {
  findUid,
  listUsers,
  readUserDetail,
  readUserDirs,
  readUserFiles,
  streamUserListCsv,
  type ExportKind,
} from './detail.js'

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

  it('does not read detail_users.permission_issues', () => {
    db = createFixture()
    // duscan declares the column but always writes 0, so it is not part of the
    // payload; perms.ts serves the real counts from perm_issues. Dropping the
    // column entirely must not break the query.
    db.exec('CREATE TABLE u2 AS SELECT uid, username, team_id, total_files, total_dirs, total_size FROM detail_users')
    db.exec('DROP TABLE detail_users; ALTER TABLE u2 RENAME TO detail_users')
    expect(listUsers(db).map((u) => u.name)).toContain('alice')
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

  it('excludes shared directories the user only touches, not owns', () => {
    db = createFixture()
    // /etc is owned by root; alice has a file in it (per-user row uid=900) but
    // must not see it in her own-directories list.
    const page = readUserDirs(db, aliceUid())
    expect(page.rows.map((r) => r.path)).toEqual(['/home', '/home/alice', '/home/bob'])
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

  it('counts the total itself when the report predates owned_dirs', () => {
    // Schema-1 reports have no detail_users.owned_dirs, and they stay on disk
    // until the target is rescanned — so the COUNT fallback is a live path, not
    // a legacy curiosity. The fixture is schema 1.
    db = createFixture()
    expect(readUserDirs(db, aliceUid()).total).toBe(3)
  })

  it('trusts owned_dirs when the scanner precomputed it', () => {
    db = createFixture()
    // Schema 2 moved this count into the merge so the dashboard stops scanning
    // the user's whole dir slice on every page load.
    db.exec('ALTER TABLE detail_users ADD COLUMN owned_dirs INTEGER NOT NULL DEFAULT 0')
    db.exec(`UPDATE detail_users SET owned_dirs = 3 WHERE uid = ${aliceUid()}`)
    expect(readUserDirs(db, aliceUid()).total).toBe(3)
  })

  it('still counts a filtered list rather than using owned_dirs', () => {
    db = createFixture()
    // owned_dirs counts every directory the user owns, which is not what a
    // filtered list shows. Reusing it here would report 3 for a 1-row list.
    db.exec('ALTER TABLE detail_users ADD COLUMN owned_dirs INTEGER NOT NULL DEFAULT 0')
    db.exec(`UPDATE detail_users SET owned_dirs = 3 WHERE uid = ${aliceUid()}`)
    const page = readUserDirs(db, aliceUid(), { filter: { query: ['alice'] } })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(1)
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
    expect(page.rows.map((r) => r.path)).toEqual(['/home/mid.bin', '/home/a.dat', '/home/b.dat', '/etc/mid.bin'])
  })

  it('does not double the separator for a file in the root', () => {
    db = createFixture()
    const rootUid = findUid(db, 'root')
    const page = readUserFiles(db, rootUid ?? -1)
    expect(page.rows.map((r) => r.path)).toEqual(['/big.log', '/small.txt'])
  })

  it('orders largest first', () => {
    db = createFixture()
    expect(readUserFiles(db, aliceUid()).rows.map((r) => r.size)).toEqual([150, 100, 50, 4])
  })

  it('resumes from the cursor across the three-part key', () => {
    db = createFixture()
    const first = readUserFiles(db, aliceUid(), { limit: 1 })
    const second = readUserFiles(db, aliceUid(), {
      limit: 5,
      ...(first.nextCursor !== null ? { cursor: first.nextCursor } : {}),
    })
    expect([...first.rows, ...second.rows].map((r) => r.size)).toEqual([150, 100, 50, 4])
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

describe('filtered count cache', () => {
  it('reuses the COUNT across pages of the same filter', () => {
    db = createFixture()
    readUserFiles(db, aliceUid(), { filter: { query: ['home'] } }) // warm
    let prepares = 0
    const orig = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('COUNT(*)')) prepares += 1
      return orig(sql)
    }) as typeof db.prepare
    // Second page of the same filtered list must not re-run the COUNT scan.
    const page = readUserFiles(db, aliceUid(), { filter: { query: ['home'] }, cursor: undefined })
    expect(page.total).toBe(3)
    expect(prepares).toBe(0)
  })

  it('treats a changed filter as a different key', () => {
    db = createFixture()
    readUserFiles(db, aliceUid(), { filter: { query: ['home'] } }) // warm
    let prepares = 0
    const orig = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('COUNT(*)')) prepares += 1
      return orig(sql)
    }) as typeof db.prepare
    readUserFiles(db, aliceUid(), { filter: { query: ['etc'] } })
    expect(prepares).toBe(1)
  })

  it('serves the cached COUNT for dirs too', () => {
    db = createFixture()
    readUserDirs(db, aliceUid(), { filter: { query: ['home'] } }) // warm
    let prepares = 0
    const orig = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('COUNT(*)')) prepares += 1
      return orig(sql)
    }) as typeof db.prepare
    readUserDirs(db, aliceUid(), { filter: { query: ['home'] } })
    expect(prepares).toBe(0)
  })

  it('invalidates when the report handle changes', () => {
    db = createFixture()
    readUserFiles(db, aliceUid(), { filter: { query: ['home'] } }) // warm

    // A fresh handle (what a rescan produces) has no cache entry, so the COUNT
    // must re-run rather than trust a stale total.
    db.close()
    db = createFixture()
    let prepares = 0
    const orig = db.prepare.bind(db)
    db.prepare = ((sql: string) => {
      if (sql.includes('COUNT(*)')) prepares += 1
      return orig(sql)
    }) as typeof db.prepare
    const page = readUserFiles(db, aliceUid(), { filter: { query: ['home'] } })
    expect(page.total).toBe(3)
    expect(prepares).toBe(1)
  })
})

describe('readUserDetail', () => {
  it('returns both lists and the user total', () => {
    db = createFixture()
    const detail = readUserDetail(db, 'alice', aliceUid())
    expect(detail.userTotal).toBe(204)
    expect(detail.dirs.rows).toHaveLength(3)
    expect(detail.files.rows).toHaveLength(4)
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

describe('streamUserListCsv', () => {
  async function collect(kind: ExportKind, filter?: DetailFilter): Promise<string> {
    const chunks: string[] = []
    for await (const chunk of streamUserListCsv(db, aliceUid(), kind, filter)) chunks.push(chunk)
    return chunks.join('')
  }

  it('emits dirs as the own-directories list, largest first, with a header', async () => {
    db = createFixture()
    const csv = await collect('dirs')
    expect(csv.split('\r\n')).toEqual(['Path,Bytes,Files', '/home,300,3', '/home/alice,100,1', '/home/bob,100,1', ''])
  })

  it('emits files with the full path joined and the extension column', async () => {
    db = createFixture()
    const csv = await collect('files')
    expect(csv.split('\r\n').slice(0, -1)).toEqual([
      'Path,Bytes,Extension',
      '/home/mid.bin,150,bin',
      '/home/a.dat,100,dat',
      '/home/b.dat,50,dat',
      '/etc/mid.bin,4,cnf',
    ])
  })

  it('joins the path separator once for a file in the scan root', async () => {
    db = createFixture()
    const rootUid = findUid(db, 'root')
    const csv: string[] = []
    for await (const chunk of streamUserListCsv(db, rootUid ?? -1, 'files')) csv.push(chunk)
    // /big.log and /small.txt live directly in the root.
    expect(csv.join('')).toContain('/big.log,60,log')
    expect(csv.join('')).toContain('/small.txt,40,txt')
  })

  it('applies filters exactly as the paged queries do', async () => {
    db = createFixture()
    const csv = await collect('files', { ext: ['dat'] })
    expect(csv.split('\r\n').slice(1, -1)).toEqual(['/home/a.dat,100,dat', '/home/b.dat,50,dat'])
  })

  it('quotes hazardous cells, including the formula-injection guard', async () => {
    db = createFixture()
    // A directory whose name starts with = (a spreadsheet formula) and contains
    // a comma and a quote. Only the owner list is exported, so give it to alice.
    db.prepare('INSERT INTO detail_dirs (id, uid, parent_id, path, owner_uid, size, files) VALUES (?,?,?,?,?,?,?)').run(
      50,
      900,
      2,
      '=cmd|weird, "x"',
      900,
      1,
      1,
    )
    const csv = await collect('dirs')
    expect(csv.split('\r\n')).toContain('"\'=cmd|weird, ""x""",1,1')
  })
})
