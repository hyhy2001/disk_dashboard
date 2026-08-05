import { describe, expect, it } from 'vitest'
import { HOT_USAGE, usageTone, WARM_USAGE } from './usage.js'

describe('usage thresholds', () => {
  it('warns before it turns critical', () => {
    expect(WARM_USAGE).toBe(70)
    expect(HOT_USAGE).toBe(85)
    expect(WARM_USAGE).toBeLessThan(HOT_USAGE)
  })

  it('grades healthy under the warning threshold', () => {
    expect(usageTone(0)).toBe('healthy')
    expect(usageTone(50)).toBe('healthy')
    expect(usageTone(WARM_USAGE - 0.1)).toBe('healthy')
  })

  it('grades warning from the warning threshold up to critical', () => {
    expect(usageTone(WARM_USAGE)).toBe('warning')
    expect(usageTone(HOT_USAGE - 0.1)).toBe('warning')
  })

  it('grades critical at and above the critical threshold', () => {
    expect(usageTone(HOT_USAGE)).toBe('critical')
    expect(usageTone(120)).toBe('critical')
  })
})
