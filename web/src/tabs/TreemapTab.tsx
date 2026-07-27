// Treemap tab: two ways to read the same level.
//
//   list    — the legacy table (Folder / Owner / Size · % / Type), shows files
//             too, pages with "Load more". This is the default because it is
//             what anyone coming from the old dashboard already knows.
//   treemap — squarified rectangles, for seeing proportions at a glance.
//
// Navigation state lives here so switching the top-level tab and coming back
// keeps your position in the tree. One fetch per level; the server query is
// O(children), so drilling stays flat regardless of tree size.

import { useCallback, useEffect, useState } from 'react'
import type { TreemapLevel, TreemapNode } from '../../../shared/api.js'
import { Breadcrumbs } from '../components/Breadcrumbs.js'
import { EntryList } from '../components/EntryList.js'
import { Treemap } from '../components/Treemap.js'
import { fetchTreemap } from '../lib/api.js'
import { formatCount, formatSize } from '../lib/format.js'

type View = 'list' | 'treemap'

const VIEW_KEY = 'duscan-treemap-view'

interface Props {
  target: string
  /** Total scanned size, used as the denominator for the percentage column. */
  totalSize: number
}

export function TreemapTab({ target, totalSize }: Props): JSX.Element {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY)
    return saved === 'treemap' ? 'treemap' : 'list'
  })
  const [openId, setOpenId] = useState<number | null>(null)
  const [level, setLevel] = useState<TreemapLevel | null>(null)
  /** Rows accumulated across "Load more" presses for the current directory. */
  const [extraDirs, setExtraDirs] = useState<TreemapNode[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    localStorage.setItem(VIEW_KEY, view)
  }, [view])

  // Ids are per-report, so a target switch must reset to the scan root rather
  // than open an unrelated directory that happens to share the id.
  useEffect(() => {
    setOpenId(null)
  }, [target])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    setExtraDirs([])
    fetchTreemap(target, { parent: openId, withFiles: view === 'list' })
      .then((data) => {
        if (!live) return
        setLevel(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(err instanceof Error ? err.message : String(err))
        setLevel(null)
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [target, openId, view])

  const loadMore = useCallback(() => {
    if (!level) return
    setLoadingMore(true)
    const offset = level.childOffset + extraDirs.length
    fetchTreemap(target, { parent: openId, childOffset: offset })
      .then((page) => {
        setExtraDirs((prev) => [...prev, ...page.children])
        // The tail page tells us whether anything is still left.
        setLevel((cur) => (cur ? { ...cur, truncated: page.truncated } : cur))
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoadingMore(false))
  }, [level, extraDirs.length, target, openId])

  const open = useCallback((node: TreemapNode) => setOpenId(node.id), [])
  const navigate = useCallback((id: number) => setOpenId(id), [])

  if (error) {
    return (
      <div className="state state--error">
        <p className="state__title">Could not load this directory</p>
        <p>{error}</p>
        {openId !== null && (
          <button type="button" className="btn" onClick={() => setOpenId(null)}>
            Back to root
          </button>
        )}
      </div>
    )
  }

  // Keep the previous level on screen while the next loads; swapping in a
  // skeleton on every drill makes the whole panel flash.
  if (!level) {
    return <div className="skeleton" style={{ height: '460px' }} />
  }

  const { node, path } = level
  const parent = path.length > 1 ? path[path.length - 2] : undefined
  const dirs = [...level.children, ...extraDirs]

  return (
    <>
      <div className="tm__toolbar">
        <div className="tm__nav">
          <button
            type="button"
            className="btn"
            onClick={() => parent && navigate(parent.id)}
            disabled={!parent}
            title="Back to parent directory"
          >
            ← Back
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setOpenId(null)}
            disabled={path.length <= 1}
            title="Jump to the scan root"
          >
            ⌂ Root
          </button>
        </div>

        <span className="tm__meta">
          {formatCount(node.dirCount)} dirs · {formatCount(node.fileCount)} files ·{' '}
          {formatSize(node.size)}
        </span>

        <div className="tm__views" role="group" aria-label="View mode">
          <button
            type="button"
            className="tm__view"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className="tm__view"
            aria-pressed={view === 'treemap'}
            onClick={() => setView('treemap')}
          >
            Treemap
          </button>
        </div>
      </div>

      <div className="panel">
        <Breadcrumbs path={path} onNavigate={navigate} />
      </div>

      <div className={`panel${loading ? ' panel--loading' : ''}`}>
        {view === 'list' ? (
          <EntryList
            dirs={dirs}
            files={level.files}
            totalSize={totalSize}
            onOpen={open}
            onLoadMore={level.truncated ? loadMore : undefined}
            loadingMore={loadingMore}
            shownCount={dirs.length}
            totalCount={level.childTotal}
          />
        ) : (
          <>
            <Treemap level={level} onOpen={open} />
            <p className="treemap__hint">
              Click a tile to drill in. Tiles without subdirectories are not clickable.
              {level.truncated && ' Smaller entries are grouped — switch to List to page through them.'}
            </p>
          </>
        )}
      </div>
    </>
  )
}
