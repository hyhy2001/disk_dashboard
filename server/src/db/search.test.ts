// Name search.
//
// The path reconstruction is the fragile part: names are interned, so a hit only
// knows its own basename and has to walk parents to become useful. The root's name
// is '/', which is exactly the case a naive join gets wrong ('//var').

import { afterEach, describe, expect, it } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createFixture } from './fixture.js'
import { MIN_QUERY, SEARCH_CACHE_CAP, searchNames } from './search.js'

let db: BetterSqlite3.Database

afterEach(() => {
  db?.close()
})

describe('searchNames', () => {
  it('refuses a query shorter than the minimum', () => {
    db = createFixture()
    expect(searchNames(db, 'a'.repeat(MIN_QUERY - 1)).hits).toEqual([])
  })

  it('ignores surrounding whitespace', () => {
    db = createFixture()
    expect(searchNames(db, '  log  ').hits.length).toBeGreaterThan(0)
  })

  it('finds a directory by name and builds its full path', () => {
    db = createFixture()
    const hit = searchNames(db, 'log').hits.find((h) => h.kind === 'dir')
    expect(hit?.path).toBe('/var/log')
  })

  it('does not double the root separator', () => {
    db = createFixture()
    const hit = searchNames(db, 'var').hits.find((h) => h.kind === 'dir')
    expect(hit?.path).toBe('/var')
  })

  it('finds files and paths them through their directory', () => {
    db = createFixture()
    const hit = searchNames(db, 'mid.bin').hits.find((h) => h.kind === 'file')
    expect(hit?.path).toBe('/home/mid.bin')
    expect(hit?.kind).toBe('file')
  })

  it('points a file hit at its containing directory for drill-down', () => {
    db = createFixture()
    const hit = searchNames(db, 'mid.bin').hits.find((h) => h.kind === 'file')
    // A file is not a navigable treemap node, so the id must be the parent.
    expect(hit?.id).toBe(2)
  })

  it('matches infix, not just prefix', () => {
    db = createFixture()
    expect(searchNames(db, 'id.bi').hits.length).toBeGreaterThan(0)
  })

  it('sorts merged results by size regardless of source table', () => {
    db = createFixture()
    const sizes = searchNames(db, 'log').hits.map((h) => h.size)
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)
  })

  it('restricts to directories when asked', () => {
    db = createFixture()
    const res = searchNames(db, 'log', { kind: 'dir' })
    expect(res.hits.every((h) => h.kind === 'dir')).toBe(true)
    expect(res.searched).toEqual({ dirs: true, files: false })
  })

  it('restricts to files when asked', () => {
    db = createFixture()
    const res = searchNames(db, 'log', { kind: 'file' })
    expect(res.hits.every((h) => h.kind === 'file')).toBe(true)
  })

  it('resolves owners, falling back to uid-N', () => {
    db = createFixture()
    const home = searchNames(db, 'home', { kind: 'dir' }).hits[0]
    // uid 900 has no treemap_owners row.
    expect(home?.owner).toBe('uid-900')
  })

  it('does not treat a wildcard as a pattern', () => {
    db = createFixture()
    expect(searchNames(db, '%%').hits).toEqual([])
  })

  it('reports when more hits exist than the page holds', () => {
    db = createFixture({ extraChildren: 30 })
    const res = searchNames(db, 'extra', { limit: 5 })
    expect(res.hits).toHaveLength(5)
    expect(res.hasMore).toBe(true)
  })

  it('survives a parent cycle in a corrupt report', () => {
    db = createFixture()
    // Point var at its own child, which would otherwise loop forever.
    db.exec('UPDATE treemap_dirs SET parent_id = 3 WHERE id = 1')
    expect(() => searchNames(db, 'log')).not.toThrow()
  })

  describe('result cache', () => {
    it('serves a repeated query without touching the database again', () => {
      db = createFixture()
      searchNames(db, 'log') // warm
      let prepares = 0
      const orig = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        prepares += 1
        return orig(sql)
      }) as typeof db.prepare
      expect(searchNames(db, 'log').hits).not.toHaveLength(0)
      expect(prepares).toBe(0)
    })

    it('treats kind and limit as part of the key', () => {
      db = createFixture()
      searchNames(db, 'log') // both kinds, default limit
      let prepares = 0
      const orig = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        prepares += 1
        return orig(sql)
      }) as typeof db.prepare
      // A different kind/limit combination must miss the cache and re-query.
      searchNames(db, 'log', { kind: 'dir' })
      searchNames(db, 'log', { limit: 5 })
      expect(prepares).toBeGreaterThan(0)
    })

    it('does not share results across report handles', () => {
      const first = createFixture()
      searchNames(first, 'log')
      db = createFixture()
      // A fresh handle has no cache entry, so this must re-query rather than
      // reuse a result computed against the other report's file. It must still
      // produce a valid result.
      expect(searchNames(db, 'log').hits.length).toBeGreaterThan(0)
      first.close()
    })

    it('evicts the least recently used entry past the cap', () => {
      db = createFixture()
      // Fill past the cap with distinct queries.
      for (let i = 0; i < SEARCH_CACHE_CAP + 1; i += 1) {
        searchNames(db, `missing-${i}`)
      }
      let prepares = 0
      const orig = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        prepares += 1
        return orig(sql)
      }) as typeof db.prepare
      // The first query is the LRU victim and must re-query (4 prepares: dirs,
      // files, and one path-builder statement per kind). The most recent one is
      // still cached, so a second search adds nothing on top.
      searchNames(db, 'missing-0')
      const afterMiss = prepares
      searchNames(db, `missing-${SEARCH_CACHE_CAP}`)
      expect(afterMiss).toBe(4)
      expect(prepares).toBe(afterMiss)
    })
  })

  describe('FTS5 trigram path (report from a modern scanner)', () => {
    /** Run one search against both schemas and assert identical results. */
    function parity(query: string, opts?: Parameters<typeof searchNames>[2]): void {
      const plain = createFixture()
      const fts = createFixture({ withFts: true })
      const a = searchNames(plain, query, opts)
      const b = searchNames(fts, query, opts)
      // The FTS tables add shadow rows to sqlite_master; compare only results.
      expect(b.hits.map((h) => [h.kind, h.name, h.size, h.path, h.owner])).toEqual(
        a.hits.map((h) => [h.kind, h.name, h.size, h.path, h.owner]),
      )
      expect(b.hasMore).toBe(a.hasMore)
      plain.close()
      fts.close()
    }

    it('returns identical results for a dir match', () => parity('var'))
    it('returns identical results for a file match', () => parity('mid.bin'))
    it('returns identical results for an infix match', () => parity('id.bi'))
    it('returns identical results case-insensitively', () => parity('LOG'))
    it('returns identical results for a short two-char query', () => parity('lo'))
    it('returns identical results for a one-char query', () => parity('a'))
    it('returns identical results with a kind filter', () => parity('log', { kind: 'file' }))
    it('returns identical results with a non-default limit', () => parity('a', { limit: 5 }))
    it('returns identical results for a file-only three-char query', () => parity('txt', { kind: 'file' }))
    it('returns identical results for an infix three-char query', () => parity('dat'))
    it('returns identical results for a three-char dir query', () => parity('log', { kind: 'dir' }))

    it('serves a clean alphanumeric query through the MATCH operator', () => {
      db = createFixture({ withFts: true })
      let usedMatch = false
      const orig = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        if (sql.includes('MATCH ?')) usedMatch = true
        return orig(sql)
      }) as typeof db.prepare
      expect(searchNames(db, 'log').hits.length).toBeGreaterThan(0)
      expect(usedMatch).toBe(true)
    })

    it('keeps punctuation and short queries on the LIKE path', () => {
      db = createFixture({ withFts: true })
      let usedMatch = false
      const orig = db.prepare.bind(db)
      db.prepare = ((sql: string) => {
        if (sql.includes('MATCH ?')) usedMatch = true
        return orig(sql)
      }) as typeof db.prepare
      searchNames(db, 'mid.bin')
      searchNames(db, 'lo')
      expect(usedMatch).toBe(false)
    })

    it('falls back to the plain scan when the tables are absent', () => {
      db = createFixture()
      // A report from an older duscan has no FTS tables; the LIKE scan must
      // still work and find the fixture's directory.
      const hit = searchNames(db, 'log').hits.find((h) => h.kind === 'dir')
      expect(hit?.path).toBe('/var/log')
    })
  })
})
