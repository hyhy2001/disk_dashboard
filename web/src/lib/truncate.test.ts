import { describe, expect, it } from 'vitest'
import { labelUnits, truncateLabel } from './truncate.js'

describe('truncateLabel', () => {
  it('leaves a name that fits untouched', () => {
    expect(truncateLabel('short', 8)).toBe('short')
  })

  it('clips a long name and appends an ellipsis', () => {
    expect(truncateLabel('hello world', 8)).toBe('hello w…')
  })

  it('counts wide glyphs as two units so CJK does not overflow the tile', () => {
    expect(truncateLabel('日本語テスト', 8)).toBe('日本語…')
    expect(labelUnits('日本語')).toBe(6)
  })

  it('mixes narrow and wide glyphs by width', () => {
    expect(truncateLabel('a日b', 5)).toBe('a日b')
  })

  it('fits wide text at a larger budget', () => {
    expect(truncateLabel('日本語テスト', 12)).toBe('日本語テスト')
  })
})
