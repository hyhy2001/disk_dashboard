import { describe, expect, it } from 'vitest'
import { effectiveScale, resolveVarsIn } from './exportPng.js'

describe('effectiveScale', () => {
  it('keeps the requested scale when the rasterised image fits', () => {
    expect(effectiveScale(2000, 1000, 2)).toBe(2)
  })

  it('shrinks the scale so the largest side stays within the canvas limit', () => {
    expect(effectiveScale(3000, 2000, 2)).toBeCloseTo(4096 / 3000, 6)
  })

  it('never divides by zero for a degenerate box', () => {
    expect(effectiveScale(0, 0, 2)).toBe(2)
  })
})

describe('resolveVarsIn', () => {
  const NS = 'http://www.w3.org/2000/svg'

  it('resolves var(--…) in fill and stroke attributes', () => {
    const svg = document.createElementNS(NS, 'svg')
    const path = document.createElementNS(NS, 'path')
    path.setAttribute('stroke', 'var(--amber-400)')
    path.setAttribute('fill', 'var(--accent)')
    svg.appendChild(path)

    resolveVarsIn(
      svg,
      new Map([
        ['--amber-400', '#fbbf24'],
        ['--accent', '#10b981'],
      ]),
    )

    expect(path.getAttribute('stroke')).toBe('#fbbf24')
    expect(path.getAttribute('fill')).toBe('#10b981')
  })

  it('resolves var(--…) in gradient stop-color so the area fill is not black', () => {
    const svg = document.createElementNS(NS, 'svg')
    const stop = document.createElementNS(NS, 'stop')
    stop.setAttribute('stop-color', 'var(--amber-400)')
    svg.appendChild(stop)

    resolveVarsIn(svg, new Map([['--amber-400', '#fbbf24']]))

    expect(stop.getAttribute('stop-color')).toBe('#fbbf24')
  })
})
