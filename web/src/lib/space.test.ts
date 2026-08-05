import { describe, expect, it } from 'vitest'
import type { Target } from '../../../shared/api.js'
import { spaceTotals } from './space.js'

function target(
  scanRoot: string,
  cap: { total: number; used: number; available: number; scanned: number } | null,
): Target {
  return {
    name: scanRoot,
    slug: scanRoot,
    scanRoot,
    scanTimestamp: 1,
    totalFiles: 0,
    totalDirs: 0,
    totalSize: 0,
    dbSizeBytes: 0,
    capacity: cap,
  }
}

/** Two readings of one 118 GB device, as `/` and `/usr` produce today. */
const DEV_A = { total: 118_238_294_016, used: 40_000_000_000, available: 78_238_294_016, scanned: 30_000_000_000 }
const DEV_A_CHILD = { ...DEV_A, scanned: 9_000_000_000 }

describe('spaceTotals', () => {
  it('sums independent filesystems', () => {
    const t = spaceTotals([
      target('/', { total: 100, used: 40, available: 60, scanned: 30 }),
      target('/data', { total: 200, used: 50, available: 150, scanned: 45 }),
    ])
    expect(t).toEqual({ total: 300, used: 90, scanned: 75, sharedFilesystems: 0 })
  })

  it('counts a shared filesystem once instead of claiming more than the hardware', () => {
    const t = spaceTotals([target('/', DEV_A), target('/usr', DEV_A_CHILD)])

    expect(t.total).toBe(DEV_A.total)
    expect(t.used).toBe(DEV_A.used)
    expect(t.sharedFilesystems).toBe(1)
  })

  it('drops a nested root from attributed bytes because the parent walked it', () => {
    // `/` already counted everything under `/usr`; adding both would overstate.
    const t = spaceTotals([target('/', DEV_A), target('/usr', DEV_A_CHILD)])
    expect(t.scanned).toBe(DEV_A.scanned)
  })

  it('keeps sibling roots on one filesystem, which walk disjoint trees', () => {
    const t = spaceTotals([target('/home', { ...DEV_A, scanned: 10 }), target('/var', { ...DEV_A, scanned: 25 })])
    expect(t.scanned).toBe(35)
    expect(t.total).toBe(DEV_A.total)
  })

  it('does not treat a same-named root on another device as nested', () => {
    // Two containers each scanning `/`: different hardware, so both count.
    const t = spaceTotals([
      target('/', { total: 100, used: 40, available: 60, scanned: 30 }),
      target('/', { total: 200, used: 50, available: 150, scanned: 45 }),
    ])
    expect(t.total).toBe(300)
    expect(t.scanned).toBe(75)
  })

  it('keeps one copy when two targets are the same root on the same device', () => {
    // Both would mark the other as covered; dropping both would report zero.
    const t = spaceTotals([target('/', DEV_A), target('/', DEV_A)])
    expect(t.scanned).toBe(DEV_A.scanned)
    expect(t.sharedFilesystems).toBe(1)
  })

  it('does not confuse a prefix match with containment', () => {
    // `/varlib` is not inside `/var`.
    const t = spaceTotals([target('/var', { ...DEV_A, scanned: 10 }), target('/varlib', { ...DEV_A, scanned: 5 })])
    expect(t.scanned).toBe(15)
  })

  it('ignores targets with no capacity reading', () => {
    const t = spaceTotals([target('/', { total: 100, used: 40, available: 60, scanned: 30 }), target('/x', null)])
    expect(t).toEqual({ total: 100, used: 40, scanned: 30, sharedFilesystems: 0 })
  })

  it('is zero for an empty space', () => {
    expect(spaceTotals([])).toEqual({ total: 0, used: 0, scanned: 0, sharedFilesystems: 0 })
  })
})
