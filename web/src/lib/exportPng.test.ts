import { describe, expect, it } from 'vitest'
import { effectiveScale } from './exportPng.js'

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
