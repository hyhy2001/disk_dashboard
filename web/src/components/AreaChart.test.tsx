// Timeline crosshair and tooltip.
//
// Legacy reads out values through a moving crosshair with a tooltip box and two
// axis pills, not through static text beside the legend. These tests pin that
// behaviour: what appears on hover, and that the tooltip stays inside the plot.
//
// jsdom does not lay out SVG, so getBoundingClientRect returns zeros. The chart
// falls back to its default viewBox in that case, which is enough to assert
// structure and geometry arithmetic.

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../../../shared/api.js'
import { AreaChart } from './AreaChart.js'

// jsdom has no layout, so useSize never reports a size. Mock it to return
// a fixed box so the SVG renders predictably.
vi.mock('../lib/useSize.js', () => ({
  useSize: () => [{ current: document.createElement('div') }, { width: 560, height: 200 }],
}))

const DAY = 86_400

function series(n: number): HistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1_700_000_000 + i * DAY,
    date: 20_260_101 + i,
    totalSize: 1000,
    usedSize: 600 + i * 10,
    availableSize: 400 - i * 10,
    scannedSize: 500 + i * 10,
  }))
}

/** jsdom gives every element a zero-size rect; fake one so pick() can map x/y. */
function stubRect(svg: Element, width = 560, height = 200): void {
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0 }) as DOMRect
}

function hoverAt(container: HTMLElement, fx: number, fy: number): SVGSVGElement {
  const svg = container.querySelector('svg.chart') as SVGSVGElement
  stubRect(svg)
  fireEvent.mouseMove(svg, { clientX: 560 * fx, clientY: 200 * fy })
  return svg
}

describe('AreaChart crosshair', () => {
  it('shows nothing before the pointer enters', () => {
    const { container } = render(<AreaChart points={series(5)} />)

    expect(container.querySelector('.chart__tip')).toBeNull()
    expect(container.querySelector('.chart__cross-line')).toBeNull()
  })

  it('draws both crosshair lines on hover', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.5, 0.5)

    // One snapped to the scan, one following the cursor.
    expect(container.querySelectorAll('.chart__cross-line')).toHaveLength(2)
  })

  it('lists every series in the tooltip box', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.5, 0.5)

    const rows = [...container.querySelectorAll('.chart__tip-row')].map((e) => e.textContent)
    expect(rows).toEqual(['Used Capacity', 'Scan Result', 'Total Capacity'])
    expect(container.querySelectorAll('.chart__tip-val')).toHaveLength(3)
  })

  it('marks each series line at the hovered scan', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.5, 0.5)

    expect(container.querySelectorAll('.chart__dot')).toHaveLength(3)
  })

  it('shows a date pill and a value pill', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.5, 0.5)

    // Date under the x axis, cursor value against the y axis.
    expect(container.querySelectorAll('.chart__pill')).toHaveLength(2)
  })

  it('omits the value pill when the cursor is outside the plot band', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    // Well below the plot area, in the x-axis label strip.
    hoverAt(container, 0.5, 0.995)

    expect(container.querySelectorAll('.chart__pill')).toHaveLength(1)
  })

  it('keeps the tooltip inside the plot near the right edge', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.98, 0.5)

    const rect = container.querySelector('.chart__tip > rect') as SVGRectElement
    const x = Number(rect.getAttribute('x'))
    const w = Number(rect.getAttribute('width'))
    // Flipped to the left of the crosshair rather than overflowing.
    expect(x + w).toBeLessThanOrEqual(560)
    expect(x).toBeGreaterThanOrEqual(0)
  })

  it('holds the crosshair at the last scan over the y-axis gutter', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    // The right-hand axis gutter is inside the svg but past the last data point.
    hoverAt(container, 0.99, 0.5)

    // Clamped, not cleared — otherwise it flickers off at the plot's edge.
    expect(container.querySelector('.chart__tip')).not.toBeNull()
  })

  it('clears the crosshair when the pointer leaves', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    const svg = hoverAt(container, 0.5, 0.5)
    expect(container.querySelector('.chart__tip')).not.toBeNull()

    fireEvent.mouseLeave(svg)
    expect(container.querySelector('.chart__tip')).toBeNull()
  })

  it('does not put per-series values beside the legend any more', () => {
    const { container } = render(<AreaChart points={series(5)} />)
    hoverAt(container, 0.5, 0.5)

    // Readout lives in the tooltip; the legend stays a static key.
    expect(container.querySelector('.chart__key-val')).toBeNull()
    expect(container.querySelectorAll('.chart__key')).toHaveLength(3)
  })
})
