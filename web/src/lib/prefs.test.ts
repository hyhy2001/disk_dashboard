import { beforeEach, describe, expect, it } from 'vitest'
import { KEYS, loadFilters, readNumber } from './prefs.js'

beforeEach(() => {
  localStorage.clear()
})

describe('readNumber', () => {
  it('returns the fallback for an empty stored value instead of 0', () => {
    localStorage.setItem(KEYS.diskColumnWidth, '')
    expect(readNumber(KEYS.diskColumnWidth, 260)).toBe(260)
  })

  it('returns the stored number when it is valid', () => {
    localStorage.setItem(KEYS.diskColumnWidth, '320')
    expect(readNumber(KEYS.diskColumnWidth, 260)).toBe(320)
  })

  it('returns the fallback for non-numeric text', () => {
    localStorage.setItem(KEYS.diskColumnWidth, 'abc')
    expect(readNumber(KEYS.diskColumnWidth, 260)).toBe(260)
  })
})

describe('loadFilters validation', () => {
  it('rejects a negative rangeDays', () => {
    localStorage.setItem(
      KEYS.filters,
      JSON.stringify({ rangeDays: -1, dateStart: '', dateEnd: '', selectedUsers: [], logScale: false, detailUser: null }),
    )
    expect(loadFilters().rangeDays).toBe(30)
  })

  it('rejects a malformed dateStart', () => {
    localStorage.setItem(
      KEYS.filters,
      JSON.stringify({ rangeDays: 30, dateStart: 'x', dateEnd: '', selectedUsers: [], logScale: false, detailUser: null }),
    )
    expect(loadFilters().dateStart).toBe('')
  })

  it('accepts a valid filter state unchanged', () => {
    const ok = {
      rangeDays: 90,
      dateStart: '2026-07-01',
      dateEnd: '2026-08-05',
      selectedUsers: ['root'],
      logScale: true,
      detailUser: 'root',
    }
    localStorage.setItem(KEYS.filters, JSON.stringify(ok))
    expect(loadFilters()).toEqual(ok)
  })
})
