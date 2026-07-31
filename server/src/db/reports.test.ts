// Target discovery and the path-traversal guard.
//
// isSafeTargetName is the only thing standing between a URL segment and a
// filesystem join, so its rejection cases are tested explicitly.

import type BetterSqlite3 from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createFixture } from './fixture.js'
import { isSafeTargetName, readCapacity, reportPath } from './reports.js'

describe('isSafeTargetName', () => {
  it('accepts ordinary target names', () => {
    for (const name of ['Test', 'usr', 'ABC', 'disk-1', 'node_2', 'v1.2.3']) {
      expect(isSafeTargetName(name)).toBe(true)
    }
  })

  it('rejects traversal and separators', () => {
    for (const name of ['..', '.', '../etc', '../../etc/passwd', 'a/b', 'a\\b', '/abs', './rel']) {
      expect(isSafeTargetName(name)).toBe(false)
    }
  })

  it('rejects names with characters that are not plain identifiers', () => {
    for (const name of ['', ' ', 'a b', 'a;b', 'a\0b', 'a$b', "a'b", 'a\nb', 'tôi']) {
      expect(isSafeTargetName(name)).toBe(false)
    }
  })
})

describe('reportPath', () => {
  it('joins the target directory and report file name', () => {
    expect(reportPath('/reports', 'Test')).toBe('/reports/Test/report.db')
  })
})

describe('readCapacity', () => {
  let db: BetterSqlite3.Database

  afterEach(() => {
    db?.close()
  })

  it('reads the newest snapshot', () => {
    db = createFixture()
    // Snapshot 2 (20240102), not snapshot 1.
    expect(readCapacity(db)).toEqual({
      total: 10_000,
      used: 6500,
      available: 3500,
      scanned: 780,
    })
  })

  it('is null when there is no history', () => {
    db = createFixture({ withHistory: false })
    expect(readCapacity(db)).toBeNull()
  })

  it('is null when the scan could not stat the filesystem', () => {
    db = createFixture()
    // A 0/0/0 snapshot would render as a completely empty disk, which is a
    // different and wrong claim from "capacity unknown".
    db.exec('UPDATE hist_snapshots SET total = 0 WHERE scan_date = 20240102')
    expect(readCapacity(db)).toBeNull()
  })
})
