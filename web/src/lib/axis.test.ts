import { describe, expect, it } from 'vitest'
import { clampLabelCentre, estimateLabelWidth, labelStride, quarterTicks, widestLabel } from './axis.js'

describe('estimateLabelWidth', () => {
  it('scales with the character count', () => {
    expect(estimateLabelWidth('07/29')).toBe(35)
    expect(estimateLabelWidth('')).toBe(0)
  })
})

describe('widestLabel', () => {
  it('returns the widest of the set', () => {
    expect(widestLabel(['0 B', '27.5 GB', '110 GB'])).toBe(estimateLabelWidth('27.5 GB'))
  })

  it('is zero for an empty set', () => {
    expect(widestLabel([])).toBe(0)
  })
})

describe('labelStride', () => {
  // The bug: six dates were drawn on a 234px plot however narrow it got, because
  // the stride came from the point count rather than from the pitch in pixels.
  it('thins labels out when the pitch is smaller than a label', () => {
    // 6 points across 234px is a 46.8px pitch; a 35px label plus its 8px gap
    // needs 43px, which fits, so every label is drawn.
    expect(labelStride(6, 234, 35)).toBe(1)
    // The same six points across a 150px plot only give a 30px pitch.
    expect(labelStride(6, 150, 35)).toBe(2)
    expect(labelStride(6, 80, 35)).toBe(3)
  })

  it('never returns less than one', () => {
    expect(labelStride(6, 0, 35)).toBeGreaterThanOrEqual(1)
    expect(labelStride(6, -10, 35)).toBeGreaterThanOrEqual(1)
    expect(labelStride(1, 100, 35)).toBe(1)
    expect(labelStride(0, 100, 35)).toBe(1)
  })

  it('keeps neighbouring labels from touching at the stride it picks', () => {
    for (const count of [3, 6, 12, 30]) {
      for (const span of [80, 150, 234, 600, 1200]) {
        const stride = labelStride(count, span, 35)
        const pitch = span / (count - 1)
        // Labels are drawn every `stride` points, so the gap between two drawn
        // labels is stride × pitch. It must clear the label width.
        expect(stride * pitch, `count=${count} span=${span}`).toBeGreaterThanOrEqual(35)
      }
    }
  })
})

describe('clampLabelCentre', () => {
  // The bug: the first date sat centred on the plot's left edge, so half of it
  // fell at a negative x and the svg's overflow:hidden shaved it off.
  it('pulls a label at the left edge fully inside', () => {
    expect(clampLabelCentre(14, 35, 0, 340)).toBe(17.5)
  })

  it('pulls a label at the right edge fully inside', () => {
    expect(clampLabelCentre(340, 35, 0, 340)).toBe(322.5)
  })

  it('leaves a label with room on both sides alone', () => {
    expect(clampLabelCentre(170, 35, 0, 340)).toBe(170)
  })

  it('centres when the box is narrower than the label', () => {
    expect(clampLabelCentre(5, 35, 0, 20)).toBe(10)
  })
})

describe('quarterTicks', () => {
  // The bug: five size ticks were always drawn, and at 320px they overlapped by
  // 30px of their 48px width.
  it('drops to the ends when the span cannot hold five', () => {
    expect(quarterTicks(400, 48)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(quarterTicks(150, 48)).toEqual([0, 0.5, 1])
    expect(quarterTicks(60, 48)).toEqual([0, 1])
  })

  it('always keeps both ends, so the axis maximum is never hidden', () => {
    for (const span of [0, 30, 60, 120, 150, 300, 400, 900]) {
      const ticks = quarterTicks(span, 48)
      expect(ticks[0], `span=${span}`).toBe(0)
      expect(ticks[ticks.length - 1], `span=${span}`).toBe(1)
    }
  })

  it('never returns ticks that would overlap', () => {
    for (const span of [60, 120, 150, 300, 400, 900]) {
      const ticks = quarterTicks(span, 48)
      for (let i = 1; i < ticks.length; i += 1) {
        const gap = ((ticks[i] as number) - (ticks[i - 1] as number)) * span
        expect(gap, `span=${span}`).toBeGreaterThanOrEqual(48)
      }
    }
  })
})
