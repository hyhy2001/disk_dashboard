import { beforeEach, describe, expect, it } from 'vitest'
import {
  KEYS,
  clearUserGroups,
  listUserGroupSlugs,
  loadFilters,
  loadUserGroups,
  readNumber,
  saveUserGroups,
} from './prefs.js'

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
      JSON.stringify({
        rangeDays: -1,
        dateStart: '',
        dateEnd: '',
        selectedUsers: [],
        logScale: false,
        detailUser: null,
      }),
    )
    expect(loadFilters().rangeDays).toBe(30)
  })

  it('rejects a malformed dateStart', () => {
    localStorage.setItem(
      KEYS.filters,
      JSON.stringify({
        rangeDays: 30,
        dateStart: 'x',
        dateEnd: '',
        selectedUsers: [],
        logScale: false,
        detailUser: null,
      }),
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

describe('viewer group overrides', () => {
  it('round-trips a set and keeps disks independent', () => {
    saveUserGroups('disk-a', { groups: [{ name: 'infra', users: ['root'] }], officialFingerprint: 'abcd1234' })
    saveUserGroups('disk-b', { groups: [{ name: 'devs', users: ['alice'] }], officialFingerprint: 'ffff0000' })

    expect(loadUserGroups('disk-a')).toEqual({
      groups: [{ name: 'infra', users: ['root'] }],
      officialFingerprint: 'abcd1234',
    })
    // A grouping only means something against one report's user list, so saving
    // for one disk must not touch another.
    expect(loadUserGroups('disk-b')?.groups[0]?.name).toBe('devs')
    expect(loadUserGroups('never-grouped')).toBeNull()
  })

  it('clears one disk without disturbing the others', () => {
    saveUserGroups('disk-a', { groups: [{ name: 'a', users: ['x'] }], officialFingerprint: '1' })
    saveUserGroups('disk-b', { groups: [{ name: 'b', users: ['y'] }], officialFingerprint: '2' })

    clearUserGroups('disk-a')
    expect(loadUserGroups('disk-a')).toBeNull()
    expect(loadUserGroups('disk-b')).not.toBeNull()
    // Cleared means gone, not present-but-undefined.
    expect(listUserGroupSlugs()).toEqual(['disk-b'])
  })

  it('treats a corrupt or hand-edited entry as absent', () => {
    localStorage.setItem(KEYS.userGroups, '{ not json')
    expect(loadUserGroups('disk-a')).toBeNull()

    // Right shape at the top level, wrong shape inside.
    localStorage.setItem(KEYS.userGroups, JSON.stringify({ 'disk-a': { groups: [{ name: 5 }] } }))
    expect(loadUserGroups('disk-a')).toBeNull()

    localStorage.setItem(KEYS.userGroups, JSON.stringify({ 'disk-a': { groups: [], officialFingerprint: 7 } }))
    expect(loadUserGroups('disk-a')).toBeNull()

    // An array where an object belongs.
    localStorage.setItem(KEYS.userGroups, JSON.stringify([{ groups: [], officialFingerprint: 'x' }]))
    expect(loadUserGroups('disk-a')).toBeNull()
  })

  it('lists nothing before anything is saved', () => {
    expect(listUserGroupSlugs()).toEqual([])
  })
})
