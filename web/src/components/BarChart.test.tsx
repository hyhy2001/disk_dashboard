// Size-axis layout: the bottom tick labels must render inside the SVG viewBox.
//
// The axis used to be anchored to `height` (labels at y = height + 5), which put
// every tick outside the viewBox and clipped the whole row away. The container
// height is fixed here so the numbers are exact.

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UsageRow } from '../../../shared/api.js'
import { BarChart } from './BarChart.js'

vi.mock('../lib/useSize.js', () => ({
  useSize: () => [null, { width: 600, height: 300 }],
}))

const rows: UsageRow[] = Array.from({ length: 10 }, (_, i) => ({
  name: `user${i}`,
  used: 1_000_000 * (10 - i),
}))

describe('BarChart size axis', () => {
  it('keeps every axis label inside the viewBox', () => {
    const ui = render(<BarChart rows={rows} limit={10} />)
    const svg = ui.container.querySelector('svg')
    expect(svg).not.toBeNull()

    const [, , , heightRaw] = (svg?.getAttribute('viewBox') ?? '').split(' ').map(Number)
    const height = heightRaw ?? 0

    // With width 600 / height 300 and 10 rows: rowH = 24, height = 10*24 + 18.
    expect(height).toBe(258)

    // Every <text> (row labels, value labels, and the 5 size-axis ticks) must
    // land strictly inside the viewBox, or it is clipped away by the SVG edge.
    const texts = [...(svg?.querySelectorAll('text') ?? [])]
    expect(texts.length).toBeGreaterThan(0)
    for (const t of texts) {
      const y = Number(t.getAttribute('y'))
      expect(y).toBeLessThan(height)
    }

    // The axis row is the 5 tick labels at the bottom; their baselines sit
    // inside the reserved AXIS_H band rather than past `height`.
    const tickYs = texts.map((t) => Number(t.getAttribute('y'))).sort((a, b) => a - b)
    expect(tickYs[tickYs.length - 1] ?? 0).toBeLessThan(height)
  })
})
