// Hash route parsing.
//
// Routes come from the address bar, so every input is untrusted: hand-edited
// hashes, links from an older build, names containing slashes. None of those may
// throw, because a bad hash on boot would mean a blank page.

import { describe, expect, it } from 'vitest'
import { buildHash, DEFAULT_ROUTE, parseHash } from './route.js'

describe('parseHash', () => {
  it('treats an empty hash as the default route', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE)
    expect(parseHash('#')).toEqual(DEFAULT_ROUTE)
    expect(parseHash('#/')).toEqual(DEFAULT_ROUTE)
  })

  it('reads a space on its own', () => {
    expect(parseHash('#/Production')).toMatchObject({ space: 'Production', disk: null })
  })

  it('reads a space and disk', () => {
    expect(parseHash('#/Production/Test/overview')).toMatchObject({
      space: 'Production',
      disk: 'Test',
      page: 'overview',
    })
  })

  it('reads a detail tab', () => {
    expect(parseHash('#/Production/Test/detail/history')).toMatchObject({
      page: 'detail',
      tab: 'history',
    })
  })

  it('falls back to the default tab for an unknown one', () => {
    // A link from an older build naming a tab that no longer exists must still
    // land on the right disk.
    expect(parseHash('#/P/Test/detail/inodes')).toMatchObject({
      disk: 'Test',
      page: 'detail',
      tab: DEFAULT_ROUTE.tab,
    })
  })

  it('defaults to overview for an unknown page', () => {
    expect(parseHash('#/P/Test/nonsense')).toMatchObject({ page: 'overview' })
  })

  it('decodes percent-encoded segments', () => {
    expect(parseHash('#/My%20Space/Test/overview')).toMatchObject({ space: 'My Space' })
  })

  it('does not throw on a malformed escape', () => {
    // A lone % is invalid UTF-8 for decodeURIComponent.
    expect(() => parseHash('#/100%/Test/overview')).not.toThrow()
    expect(parseHash('#/100%/Test/overview').space).toBe('100%')
  })

  it('ignores empty segments from a doubled slash', () => {
    expect(parseHash('#//Production//Test')).toMatchObject({
      space: 'Production',
      disk: 'Test',
    })
  })
})

describe('buildHash', () => {
  it('renders the empty route', () => {
    expect(buildHash(DEFAULT_ROUTE)).toBe('#/')
  })

  it('renders a space alone', () => {
    expect(buildHash({ ...DEFAULT_ROUTE, space: 'Prod' })).toBe('#/Prod')
  })

  it('renders an overview route', () => {
    expect(buildHash({ space: 'Prod', disk: 'Test', page: 'overview', tab: 'treemap' })).toBe(
      '#/Prod/Test/overview',
    )
  })

  it('renders a detail route with its tab', () => {
    expect(buildHash({ space: 'Prod', disk: 'Test', page: 'detail', tab: 'permissions' })).toBe(
      '#/Prod/Test/detail/permissions',
    )
  })

  it('encodes a segment containing a slash', () => {
    const hash = buildHash({ space: 'a/b', disk: 'Test', page: 'overview', tab: 'treemap' })
    // Without encoding this would parse back as space 'a', disk 'b'.
    expect(hash).toBe('#/a%2Fb/Test/overview')
    expect(parseHash(hash).space).toBe('a/b')
  })

  it('round-trips every reachable route', () => {
    for (const route of [
      { space: null, disk: null, page: 'overview', tab: 'treemap' },
      { space: 'S', disk: null, page: 'overview', tab: 'treemap' },
      { space: 'S', disk: 'D', page: 'overview', tab: 'treemap' },
      { space: 'S', disk: 'D', page: 'detail', tab: 'history' },
      { space: 'S', disk: 'D', page: 'detail', tab: 'detail-user' },
    ] as const) {
      // A space with no disk cannot carry a page, so compare only what the hash
      // is able to express.
      const parsed = parseHash(buildHash(route))
      expect(parsed.space).toBe(route.space)
      expect(parsed.disk).toBe(route.disk)
      if (route.disk) {
        expect(parsed.page).toBe(route.page)
        if (route.page === 'detail') expect(parsed.tab).toBe(route.tab)
      }
    }
  })
})
