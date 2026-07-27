// Name search.
//
// The path reconstruction is the fragile part: names are interned, so a hit only
// knows its own basename and has to walk parents to become useful. The root's name
// is '/', which is exactly the case a naive join gets wrong ('//var').

import { afterEach, describe, expect, it } from 'vitest'
import type BetterSqlite3 from 'better-sqlite3'
import { createFixture } from './fixture.js'
import { MIN_QUERY, searchNames } from './search.js'

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
})
