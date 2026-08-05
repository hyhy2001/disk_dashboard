import { describe, expect, it } from 'vitest'
import { formatPercent } from './format.js'

describe('formatPercent', () => {
  it('returns 0% for a non-positive whole', () => {
    expect(formatPercent(10, 0)).toBe('0%')
    expect(formatPercent(10, -5)).toBe('0%')
  })

  it('guards NaN and Infinity instead of printing them', () => {
    expect(formatPercent(NaN, 100)).toBe('0%')
    expect(formatPercent(Infinity, 100)).toBe('0%')
    expect(formatPercent(10, NaN)).toBe('0%')
    expect(formatPercent(10, Infinity)).toBe('0%')
  })

  it('formats a normal fraction to one decimal place', () => {
    expect(formatPercent(25, 200)).toBe('12.5%')
  })
})
