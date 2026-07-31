import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.js'

vi.mock('./lib/api.js', () => ({
  fetchHealth: () => Promise.resolve({ live: true, targets: 3, version: '0.1.0' }),
  fetchGroups: () => Promise.resolve([{ name: 'Prod', targets: [{ name: 'web-01', slug: 'web-01', scanRoot: '/data/web', scanTimestamp: 0, totalFiles: 0, totalDirs: 0, totalSize: 0, dbSizeBytes: 0, capacity: null }] }]),
  fetchOverview: () => Promise.resolve(null),
  clearApiCache: () => {},
}))

vi.mock('./lib/adminApi.js', () => ({
  fetchAuthStatus: () => Promise.resolve({ loggedIn: false, user: null, needsSetup: false, rateLimit: { captcha: false, attempts: 0 } }),
}))

afterEach(cleanup)

describe('App shell layout', () => {
  it('renders sidebar brand text', () => {
    const { container } = render(<App />)
    const brand = container.querySelector('aside span')
    expect(brand?.textContent).toBe('Disk Usage')
  })

  it('renders all three column areas', () => {
    const { container } = render(<App />)
    expect(container.querySelector('aside')).toBeTruthy()
    const diskcol = container.querySelector('.diskcol')
    expect(diskcol).toBeTruthy()
    expect(diskcol!.className).toContain('diskcol')
    expect(container.querySelector('main')).toBeTruthy()
  })

  it('has diskcol class for ColumnResizer', () => {
    const { container } = render(<App />)
    expect(container.querySelector('.diskcol')).toBeTruthy()
  })

  it('applies --sidebar-width variable on the root', () => {
    const { container } = render(<App />)
    // App renders Toasts/Tooltip before the layout root, so select the div that
    // actually owns the CSS variable rather than assuming it is the first child.
    const root = container.querySelector('[style*="--sidebar-width"]') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.style.getPropertyValue('--sidebar-width')).toBe('256px')
  })

  it('disk column has margin-left using CSS variable', () => {
    const { container } = render(<App />)
    const diskcol = container.querySelector('.diskcol') as HTMLElement
    expect(diskcol.style.marginLeft).toBe('var(--sidebar-width)')
  })

  it('main area has margin-left using CSS variable', () => {
    const { container } = render(<App />)
    const mainArea = container.querySelector('[style*="margin-left"]')
    expect(mainArea).toBeTruthy()
  })
})
