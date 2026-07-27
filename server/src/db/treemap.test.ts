import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { readTreemapLevel } from './treemap.js'

let db: Database.Database

afterEach(() => {
  db?.close()
})

describe('readTreemapLevel', () => {
  it('starts at the scan root when no parent is given', () => {
    db = createFixture()
    const level = readTreemapLevel(db, null)

    expect(level?.node.id).toBe(0)
    expect(level?.node.name).toBe('/')
    expect(level?.node.size).toBe(1000)
    expect(level?.path).toEqual([{ id: 0, name: '/' }])
  })

  it('returns children largest first', () => {
    db = createFixture()
    const level = readTreemapLevel(db, null)

    expect(level?.children.map((c) => c.name)).toEqual(['var', 'home'])
    expect(level?.children.map((c) => c.size)).toEqual([600, 300])
  })

  it('reports the size not covered by children as remainder', () => {
    db = createFixture()
    const level = readTreemapLevel(db, null)

    // Root is 1000, children are 600 + 300, so 100 lives in root's own files.
    expect(level?.remainder).toBe(100)
    expect(level?.truncated).toBe(false)
  })

  it('builds the full path when drilling down', () => {
    db = createFixture()
    const level = readTreemapLevel(db, 3)

    expect(level?.node.name).toBe('log')
    expect(level?.path).toEqual([
      { id: 0, name: '/' },
      { id: 1, name: 'var' },
      { id: 3, name: 'log' },
    ])
  })

  it('resolves owner names and falls back to uid-N when unknown', () => {
    db = createFixture()
    const root = readTreemapLevel(db, null)
    const byName = new Map(root?.children.map((c) => [c.name, c]))

    // uid 0 is in treemap_owners; uid 900 is not.
    expect(byName.get('var')?.owner).toBe('root')
    expect(byName.get('home')?.owner).toBe('uid-900')
  })

  it('marks leaves as having no children so the UI can disable them', () => {
    db = createFixture()
    const root = readTreemapLevel(db, null)
    const byName = new Map(root?.children.map((c) => [c.name, c]))

    expect(byName.get('var')?.hasChildren).toBe(true)
    expect(byName.get('home')?.hasChildren).toBe(false)
    expect(byName.get('home')?.hasFiles).toBe(true)
  })

  it('returns an empty child list for a leaf directory', () => {
    db = createFixture()
    const level = readTreemapLevel(db, 2)

    expect(level?.children).toEqual([])
    expect(level?.node.name).toBe('home')
  })

  it('caps children and flags truncation, keeping remainder honest', () => {
    // 70 extra children exceeds the 60 page size.
    db = createFixture({ extraChildren: 70 })
    const level = readTreemapLevel(db, null)

    expect(level?.truncated).toBe(true)
    expect(level?.children.length).toBe(60)

    // Whatever was cut off must still be accounted for.
    const shown = level?.children.reduce((s, c) => s + c.size, 0) ?? 0
    expect(shown + (level?.remainder ?? 0)).toBe(level?.node.size)
  })

  it('returns null for an id that does not exist', () => {
    db = createFixture()
    expect(readTreemapLevel(db, 99_999)).toBeNull()
  })

  describe('paging', () => {
    it('reports childTotal and an offset cursor', () => {
      db = createFixture()
      const level = readTreemapLevel(db, null)

      expect(level?.childTotal).toBe(2)
      expect(level?.childOffset).toBe(2)
      expect(level?.truncated).toBe(false)
    })

    it('continues from childOffset without repeating rows', () => {
      db = createFixture({ extraChildren: 70 })
      const first = readTreemapLevel(db, null)
      const second = readTreemapLevel(db, null, { childOffset: first?.childOffset })

      expect(first?.childOffset).toBe(60)
      expect(second?.children.length).toBe(12) // 2 named + 70 extra - 60
      expect(second?.truncated).toBe(false)

      const firstIds = new Set(first?.children.map((c) => c.id))
      expect(second?.children.some((c) => firstIds.has(c.id))).toBe(false)
    })

    it('keeps remainder correct on later pages by discounting skipped children', () => {
      db = createFixture({ extraChildren: 70 })
      const page2 = readTreemapLevel(db, null, { childOffset: 60 })

      // Page 2's own children plus its remainder must not exceed the parent.
      const shown = page2?.children.reduce((s, c) => s + c.size, 0) ?? 0
      expect(shown + (page2?.remainder ?? 0)).toBeLessThanOrEqual(page2?.node.size ?? 0)
      // And it must not re-claim the 900 bytes already shown on page 1.
      expect(page2?.remainder).toBeLessThan(900)
    })
  })

  describe('files', () => {
    it('omits files unless asked', () => {
      db = createFixture()
      const level = readTreemapLevel(db, null)

      expect(level?.files).toEqual([])
      // fileTotal is always reported so the UI can show a count without fetching.
      expect(level?.fileTotal).toBe(2)
    })

    it('returns files largest first with resolved owners', () => {
      db = createFixture()
      const level = readTreemapLevel(db, 2, { withFiles: true })

      expect(level?.files).toEqual([
        { name: 'mid.bin', size: 150, owner: 'uid-900' },
        { name: 'a.dat', size: 100, owner: 'uid-900' },
        { name: 'b.dat', size: 50, owner: 'uid-900' },
      ])
    })

    it('resolves owner names when the uid is known', () => {
      db = createFixture()
      const level = readTreemapLevel(db, null, { withFiles: true })

      expect(level?.files.map((f) => f.owner)).toEqual(['root', 'root'])
      expect(level?.files.map((f) => f.name)).toEqual(['big.log', 'small.txt'])
    })

    it('returns no files for a directory whose has_files is 0', () => {
      // var (id 1) is a pure container: the query must be skipped entirely.
      db = createFixture()
      const level = readTreemapLevel(db, 1, { withFiles: true })

      expect(level?.files).toEqual([])
      expect(level?.fileTotal).toBe(0)
    })

    it('pages files from fileOffset', () => {
      db = createFixture()
      const level = readTreemapLevel(db, 2, { withFiles: true, fileOffset: 1 })

      expect(level?.files.map((f) => f.name)).toEqual(['a.dat', 'b.dat'])
    })
  })
})
