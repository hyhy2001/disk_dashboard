// Donut slice construction.
//
// The arithmetic here decides whether a team looks like it owns 34% or 100% of a
// disk, so it is worth pinning. Three totals are in play and must not be conflated:
//
//   teams      — usage attributed to a configured team
//   Other      — scanned users with no team mapping (real owners, ungrouped)
//   Unknown    — used bytes the scan never walked (no owner to name)
//
// Legacy keeps Other and Unknown as separate slices on purpose; folding either into
// the other overstates whichever absorbs it.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UsageRow } from '../../../shared/api.js'
import { Donut, OTHER_SLICE, UNKNOWN_SLICE } from './Donut.js'

/** Slice names and values, read back off the rendered legend. */
function slices(ui: ReturnType<typeof render>): { name: string; clickable: boolean }[] {
  return [...ui.container.querySelectorAll('.legend__item')].map((el) => ({
    name: el.querySelector('.legend__name')?.textContent ?? '',
    clickable: el.classList.contains('legend__item--click'),
  }))
}

const teams: UsageRow[] = [
  { name: 'ALPHA', used: 600 },
  { name: 'BETA', used: 300 },
]

describe('Donut slices', () => {
  it('shows only the team rows when no totals are given', () => {
    const ui = render(<Donut rows={teams} />)
    expect(slices(ui).map((s) => s.name)).toEqual(['ALPHA', 'BETA'])
  })

  it('adds an Other slice for unmapped users', () => {
    const ui = render(<Donut rows={teams} otherUsed={200} />)
    expect(slices(ui).map((s) => s.name)).toEqual(['ALPHA', 'BETA', OTHER_SLICE])
  })

  it('keeps Other and Unknown as separate slices', () => {
    // used 1200 = teams 900 + other 200 + unknown 100
    const ui = render(<Donut rows={teams} totalUsed={1200} otherUsed={200} />)
    expect(slices(ui).map((s) => s.name)).toEqual([
      'ALPHA',
      'BETA',
      OTHER_SLICE,
      UNKNOWN_SLICE,
    ])
  })

  it('does not count Other toward Unknown', () => {
    // Unknown must be used - teams - other = 100, not used - teams = 300.
    const ui = render(<Donut rows={teams} totalUsed={1200} otherUsed={200} />)
    const title = ui.container.querySelector('circle:last-of-type title')?.textContent ?? ''

    expect(title).toContain(UNKNOWN_SLICE)
    expect(title).toContain('100 B')
  })

  it('omits Unknown when teams and Other already account for everything', () => {
    const ui = render(<Donut rows={teams} totalUsed={1100} otherUsed={200} />)
    expect(slices(ui).map((s) => s.name)).not.toContain(UNKNOWN_SLICE)
  })

  it('omits Other when there are no unmapped users', () => {
    const ui = render(<Donut rows={teams} totalUsed={1000} otherUsed={0} />)
    expect(slices(ui).map((s) => s.name)).not.toContain(OTHER_SLICE)
  })

  it('makes Other clickable but not Unknown', () => {
    const ui = render(
      <Donut rows={teams} totalUsed={1200} otherUsed={200} onSelect={() => {}} />,
    )
    const found = slices(ui)

    // Other has a concrete user list behind it; Unknown has nobody to list.
    expect(found.find((s) => s.name === OTHER_SLICE)?.clickable).toBe(true)
    expect(found.find((s) => s.name === UNKNOWN_SLICE)?.clickable).toBe(false)
  })

  it('totals the ring to the real used figure', () => {
    const ui = render(<Donut rows={teams} totalUsed={1200} otherUsed={200} />)
    // Centre label is the sum of every slice, which must be the disk's usage.
    expect(ui.container.querySelector('.donut__total')?.textContent).toBe('1.17 KB')
  })
})
