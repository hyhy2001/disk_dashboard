// Path route parsing.
//
// Routes come from the address bar, so every input is untrusted: hand-edited
// paths, links from an older build, names containing slashes. None of those may
// throw, because a bad path on boot would mean a blank page.

import { describe, expect, it } from 'vitest'
import { buildPath, DEFAULT_ROUTE, DETAIL_TABS, parsePath } from './route.js'

describe('parsePath', () => {
  it('treats an empty path as the default route', () => {
    expect(parsePath('')).toEqual(DEFAULT_ROUTE)
    expect(parsePath('/')).toEqual(DEFAULT_ROUTE)
  })

  it('reads a space on its own', () => {
    expect(parsePath('/Production')).toMatchObject({ space: 'Production', disk: null })
  })

  it('reads a space with a leading double slash gracefully', () => {
    expect(parsePath('//Production')).toMatchObject({ space: 'Production', disk: null })
  })

  it('reads a space and disk', () => {
    expect(parsePath('/Production/server-01')).toMatchObject({
      space: 'Production',
      disk: 'server-01',
    })
  })

  it('defaults page to overview when absent', () => {
    const r = parsePath('/Team/disk')
    expect(r.page).toBe('overview')
  })

  it('reads the overview page explicitly', () => {
    expect(parsePath('/Team/disk/overview').page).toBe('overview')
  })

  it('reads a detail sub-tab', () => {
    const r = parsePath('/Team/disk/detail/treemap')
    expect(r.page).toBe('detail')
    expect(r.tab).toBe('treemap')
  })

  it('falls back to default tab for unknown detail tab', () => {
    const r = parsePath('/Team/disk/detail/unknown')
    expect(r.page).toBe('detail')
    expect(r.tab).toBe(DEFAULT_ROUTE.tab)
  })

  it('treats "overview" as the overview page even when followed by more', () => {
    expect(parsePath('/Team/disk/overview/treemap').page).toBe('overview')
  })

  it('decodes percent-encoded segments', () => {
    const r = parsePath('/my%20space/my%2Fdisk/detail/history')
    expect(r.space).toBe('my space')
    expect(r.disk).toBe('my/disk')
  })

  it('handles malformed percent encoding gracefully', () => {
    const r = parsePath('/Team/%ZZ')
    expect(r.space).toBe('Team')
  })

  it('trims trailing slash', () => {
    expect(parsePath('/Team/disk/')).toMatchObject({ space: 'Team', disk: 'disk' })
  })
})

describe('buildPath', () => {
  it('returns / for the default route', () => {
    expect(buildPath(DEFAULT_ROUTE)).toBe('/')
  })

  it('builds a space-only path', () => {
    expect(buildPath({ ...DEFAULT_ROUTE, space: 'Dev' })).toBe('/Dev')
  })

  it('builds a space+disk+overview path', () => {
    expect(buildPath({ ...DEFAULT_ROUTE, space: 'Dev', disk: 'api' })).toBe('/Dev/api/overview')
  })

  it('builds a full detail path', () => {
    expect(
      buildPath({ space: 'Dev', disk: 'api', page: 'detail', tab: 'inodes' }),
    ).toBe('/Dev/api/detail/inodes')
  })

  it('encodes characters that are not valid in a URL segment', () => {
    const r = buildPath({ ...DEFAULT_ROUTE, space: 'my space', disk: 'my/disk' })
    expect(r).toBe('/my%20space/my%2Fdisk/overview')
  })

  it('is the inverse of parsePath for every reachable route', () => {
    for (const tab of DETAIL_TABS) {
      const route1 = { space: 'Backend', disk: 'primary', page: 'detail' as const, tab }
      expect(parsePath(buildPath(route1))).toEqual(route1)

      const route2 = { space: 'Backend', disk: 'primary', page: 'overview' as const, tab: 'treemap' as const }
      expect(parsePath(buildPath(route2))).toEqual(route2)
    }
  })
})
