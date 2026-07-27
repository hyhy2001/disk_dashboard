// Range filtering for the timeline.
//
// The cutoff is measured from the newest sample rather than wall-clock now, so a
// target that stopped being scanned still shows its final window. These tests
// pin that behaviour, since "now" would make them time-dependent and flaky.

import { describe, expect, it } from 'vitest'
import { filterByRange } from './RangePicker.js'

const DAY = 86_400

/** Points spaced one day apart, newest last, ending at t = 0. */
function series(days: number[]): { timestamp: number }[] {
  return days.map((d) => ({ timestamp: -d * DAY })).sort((a, b) => a.timestamp - b.timestamp)
}

describe('filterByRange', () => {
  it('returns everything for "all"', () => {
    const pts = series([100, 50, 10, 0])
    expect(filterByRange(pts, 'all')).toHaveLength(4)
  })

  it('keeps points within the window, measured from the newest sample', () => {
    const pts = series([100, 40, 20, 5, 0])
    const out = filterByRange(pts, 30)

    // Newest is at t=0, so the cutoff is -30 days: 20, 5 and 0 survive.
    expect(out.map((p) => p.timestamp / DAY)).toEqual([-20, -5, -0])
  })

  it('anchors on the last sample, not on the current time', () => {
    // Every point is a decade old; a wall-clock cutoff would return nothing.
    const old = 4000
    const pts = series([old + 10, old + 3, old])
    const out = filterByRange(pts, 7)

    expect(out).toHaveLength(2)
  })

  it('includes a point sitting exactly on the boundary', () => {
    const pts = series([7, 0])
    expect(filterByRange(pts, 7)).toHaveLength(2)
  })

  it('excludes a point just outside the boundary', () => {
    const pts = series([8, 0])
    expect(filterByRange(pts, 7)).toHaveLength(1)
  })

  it('handles empty input', () => {
    expect(filterByRange([], 30)).toEqual([])
    expect(filterByRange([], 'all')).toEqual([])
  })

  it('keeps a single point regardless of range', () => {
    const pts = series([0])
    expect(filterByRange(pts, 7)).toHaveLength(1)
    expect(filterByRange(pts, 1825)).toHaveLength(1)
  })
})
