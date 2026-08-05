import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreemapLevel, TreemapNode } from '../../../shared/api.js'
import { TreemapTab } from './TreemapTab.js'

afterEach(cleanup)

interface Deferred {
  promise: Promise<TreemapLevel>
  resolve: (v: TreemapLevel) => void
}
const deferreds = vi.hoisted(() => [] as Deferred[])

vi.mock('../lib/api.js', () => ({
  fetchTreemap: vi.fn(() => {
    let resolve!: (v: TreemapLevel) => void
    const promise = new Promise<TreemapLevel>((res) => {
      resolve = res
    })
    const d = { promise, resolve }
    deferreds.push(d)
    return d.promise
  }),
}))

// The list never measures in jsdom; report a measured box so the tab fetches.
vi.mock('../lib/useFitRows.js', () => ({
  useFitRows: () => ({ ref: () => {}, rows: 20, measured: true }),
}))

const dir = (id: number, name: string): TreemapNode => ({
  id,
  name,
  size: 100,
  fileCount: 0,
  dirCount: 0,
  owner: 'root',
  hasChildren: true,
  hasFiles: false,
})

function level(nodeId: number, name: string, children: TreemapNode[], extra: Partial<TreemapLevel> = {}): TreemapLevel {
  return {
    node: {
      id: nodeId,
      name,
      size: 1000,
      fileCount: 0,
      dirCount: children.length,
      owner: 'root',
      hasChildren: children.length > 0,
      hasFiles: false,
    },
    path: [{ id: nodeId, name }],
    children,
    files: [],
    fileTotal: 0,
    remainder: 0,
    filesSize: 0,
    truncated: true,
    childTotal: 50,
    ...extra,
  }
}

describe('TreemapTab load more', () => {
  it('drops a stale load-more page that resolves after navigating elsewhere', async () => {
    render(<TreemapTab target="t" totalSize={1000} />)

    await act(async () => {
      deferreds[0]!.resolve(level(0, '/', [dir(5, 'dirA')]))
    })
    await screen.findByText('dirA')

    // Load more for the root level, and drill into dirA while it is in flight.
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    const stale = deferreds[1]!
    expect(stale).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /dirA/ }))
    const nav = deferreds[2]!
    expect(nav).toBeTruthy()

    // The stale root page resolves after the navigation has started; its rows
    // must not be appended to dirA's list.
    await act(async () => {
      stale.resolve(level(0, '/', [dir(99, 'staleDir')]))
    })
    await act(async () => {
      nav.resolve(level(5, 'dirA', []))
    })

    await screen.findByText('This directory is empty.')
    expect(screen.queryByText('staleDir')).toBeNull()
  })
})
