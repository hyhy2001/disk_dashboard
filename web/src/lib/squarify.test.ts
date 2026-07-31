// Layout invariants for the treemap.
//
// These assert properties rather than exact coordinates: the point of a treemap
// is that area is proportional to size and nothing escapes the box. Pinning
// pixel values would break on any tuning of the row-breaking heuristic while
// telling us nothing about correctness.

import { describe, expect, it } from 'vitest'
import { squarify, type Rect } from './squarify.js'

interface Item {
  v: number
}

const BOX: Rect = { x: 0, y: 0, w: 800, h: 400 }

function layout(values: number[], box: Rect = BOX) {
  return squarify(
    values.map((v) => ({ v })),
    (i: Item) => i.v,
    box,
  )
}

describe('squarify', () => {
  it('makes each area proportional to its value', () => {
    const values = [500, 300, 150, 50]
    const out = layout(values)
    const total = values.reduce((a, b) => a + b, 0)
    const boxArea = BOX.w * BOX.h

    for (const tile of out) {
      const expected = (tile.value / total) * boxArea
      expect(tile.w * tile.h).toBeCloseTo(expected, 4)
    }
  })

  it('covers the box without overlapping or overflowing', () => {
    const out = layout([31_049, 27_340, 14_869, 11_048, 236, 207, 113, 42])
    const covered = out.reduce((sum, t) => sum + t.w * t.h, 0)
    expect(covered).toBeCloseTo(BOX.w * BOX.h, 2)

    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(-0.01)
      expect(t.y).toBeGreaterThanOrEqual(-0.01)
      expect(t.x + t.w).toBeLessThanOrEqual(BOX.w + 0.01)
      expect(t.y + t.h).toBeLessThanOrEqual(BOX.h + 0.01)
    }
  })

  it('keeps tiles reasonably square for evenly sized input', () => {
    const out = layout(
      Array.from({ length: 24 }, () => 100),
      { x: 0, y: 0, w: 900, h: 500 },
    )
    const worst = Math.max(...out.map((t) => Math.max(t.w / t.h, t.h / t.w)))
    // Slice-and-dice would give ~37 here; squarified stays near square.
    expect(worst).toBeLessThan(3)
  })

  it('sorts descending so the largest tile comes first', () => {
    const out = layout([10, 900, 250, 40])
    const sizes = out.map((t) => t.value)
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a))
  })

  it('drops zero and negative values instead of emitting empty tiles', () => {
    const out = layout([500, 0, 300, -100, 200])
    expect(out).toHaveLength(3)
    expect(out.every((t) => t.w > 0 && t.h > 0)).toBe(true)
  })

  it('handles a single item by filling the box', () => {
    const out = layout([42])
    expect(out).toHaveLength(1)
    expect(out[0]?.w).toBeCloseTo(BOX.w, 4)
    expect(out[0]?.h).toBeCloseTo(BOX.h, 4)
  })

  it('returns nothing for empty input or a degenerate box', () => {
    expect(layout([])).toEqual([])
    expect(layout([100], { x: 0, y: 0, w: 0, h: 400 })).toEqual([])
    expect(layout([100], { x: 0, y: 0, w: 800, h: -5 })).toEqual([])
  })

  it('respects a non-zero origin', () => {
    const out = layout([300, 200, 100], { x: 40, y: 25, w: 400, h: 300 })
    for (const t of out) {
      expect(t.x).toBeGreaterThanOrEqual(39.99)
      expect(t.y).toBeGreaterThanOrEqual(24.99)
      expect(t.x + t.w).toBeLessThanOrEqual(440.01)
      expect(t.y + t.h).toBeLessThanOrEqual(325.01)
    }
  })

  it('terminates on a value spread wide enough to produce sub-pixel tiles', () => {
    // One item 11 orders of magnitude larger than the rest: the tail rounds to
    // nothing, which must break the row loop rather than spin.
    const out = layout([1e12, 100, 50, 25, 10])
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.length).toBeLessThanOrEqual(5)
    expect(out[0]?.value).toBe(1e12)
  })
})
