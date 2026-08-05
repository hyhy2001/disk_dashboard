import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserTab } from './UserTab.js'

afterEach(cleanup)

vi.mock('../lib/api.js', () => ({
  fetchUsers: vi.fn(async () => [
    { name: 'root', used: 100, files: 2, hasDetail: true },
    { name: 'www', used: 50, files: 1, hasDetail: true },
  ]),
  fetchUserDetail: vi.fn(async () => ({
    userTotal: 100,
    dirs: { rows: [], hasMore: false, nextCursor: null, total: 0 },
    files: { rows: [], hasMore: false, nextCursor: null, total: 0, pageTotal: 0 },
    dirsSuppressed: false,
  })),
}))

vi.mock('../lib/exports.js', () => ({ exportUserList: vi.fn(async () => {}) }))

// The list never measures in jsdom; the toolbar under test renders regardless.
vi.mock('../lib/useFitRows.js', () => ({
  useFitRows: () => ({ ref: () => {}, rows: 20, measured: false }),
}))

describe('UserTab filters popover', () => {
  it('closes on Escape and returns focus to the Filters button', async () => {
    render(<UserTab target="disk-1" initialUser={null} />)
    const button = await screen.findByRole('button', { name: /Filters/ })

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button)
  })

  it('moves focus into the popover when it opens', async () => {
    render(<UserTab target="disk-1" initialUser={null} />)
    const button = await screen.findByRole('button', { name: /Filters/ })

    fireEvent.click(button)
    const firstField = await screen.findByPlaceholderText('e.g. csv, log')
    expect(document.activeElement).toBe(firstField)
  })
})
