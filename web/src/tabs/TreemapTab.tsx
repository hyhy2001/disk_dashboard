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
import { TreeSearch } from '../components/TreeSearch.js'
import { EntryList } from '../components/EntryList.js'
import { Treemap } from '../components/Treemap.js'
import { fetchTreemap } from '../lib/api.js'
import { formatCount, formatSize } from '../lib/format.js'
import { KEYS, readString, writeString } from '../lib/prefs.js'
import { useFitRows } from '../lib/useFitRows.js'

type View = 'list' | 'treemap'

const VIEW_KEY = KEYS.treemapView

interface Props {
  target: string
  /** Total scanned size, used as the denominator for the percentage column. */
  totalSize: number
}

/** One table row's height including its bottom border, measured in the browser. */
const ROW_HEIGHT = 38

/** The column header (24px) plus the "Load more" footer (42px). */
const CHROME = 66

export function TreemapTab({ target, totalSize }: Props): JSX.Element {
  const [view, setView] = useState<View>(() =>
    readString(VIEW_KEY) === 'treemap' ? 'treemap' : 'list',
  )
  const [openId, setOpenId] = useState<number | null>(null)
  const [level, setLevel] = useState<TreemapLevel | null>(null)
  /** Rows accumulated across "Load more" presses for the current directory. */
  const [extraDirs, setExtraDirs] = useState<TreemapNode[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    writeString(VIEW_KEY, view)
  }, [view])

  // Ids are per-report, so a target switch must reset to the scan root rather
  // than open an unrelated directory that happens to share the id.
  useEffect(() => {
    setOpenId(null)
  }, [target])

  // Page size follows the measured list height so a level fits without scrolling
  // the page. The treemap view is not a list — its tiles scale to whatever box they
  // get — so it keeps the server default.
  // reserve covers the column header and the "Load more" footer, which live inside
  // the measured panel but are not rows.
  const fit = useFitRows({ rowHeight: ROW_HEIGHT, min: 6, max: 60, reserve: CHROME })
  /*
   * The limit applies to children *and* files separately, so the list renders up to
   * twice it. Halving keeps the two together inside one screen, less one row of
   * slack: a directory with files also gets a synthetic row for them, which is not
   * part of either page.
   */
  const pageSize = view === 'list' ? Math.max(3, Math.floor((fit.rows - 1) / 2)) : undefined

  useEffect(() => {
    // In list view, wait for the measurement rather than fetching twice.
    if (view === 'list' && !fit.measured) return

    let live = true
    setLoading(true)
    setError(null)
    setExtraDirs([])
    fetchTreemap(target, {
      parent: openId,
      ...(pageSize !== undefined ? { limit: pageSize } : {}),
    })
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
  }, [target, openId, view, pageSize, fit.measured])

  const loadMore = useCallback(() => {
    if (!level) return
    setLoadingMore(true)
    const offset = level.childOffset + extraDirs.length
    fetchTreemap(target, {
      parent: openId,
      childOffset: offset,
      ...(pageSize !== undefined ? { limit: pageSize } : {}),
    })
      .then((page) => {
        setExtraDirs((prev) => [...prev, ...page.children])
        // The tail page tells us whether anything is still left.
        setLevel((cur) => (cur ? { ...cur, truncated: page.truncated } : cur))
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => setLoadingMore(false))
  }, [level, extraDirs.length, target, openId, pageSize])

  const open = useCallback((node: TreemapNode) => setOpenId(node.id), [])
  const navigate = useCallback((id: number) => setOpenId(id), [])

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">Could not load this directory</p>
        <p>{error}</p>
        {openId !== null && (
          <button type="button" className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors" onClick={() => setOpenId(null)}>
            Back to root
          </button>
        )}
      </div>
    )
  }

  /*
   * Keep the previous level on screen while the next loads; swapping in a skeleton
   * on every drill makes the whole panel flash.
   *
   * The placeholders above the panel are deliberate. The skeleton carries the
   * measuring ref, and the measurement is taken from the list's top edge — so if
   * this branch omitted the toolbar and breadcrumb rows, the list would sit ~90px
   * higher here than once loaded, measure three rows too many, and refetch. Holding
   * the same vertical space keeps one measurement valid for both states.
   */
  if (!level) {
    return (
      <>
        <div aria-hidden="true" className="flex items-center gap-2 px-3 py-2 opacity-0" />
        <div aria-hidden="true" className="flex items-center gap-2 px-3 py-1.5 opacity-0" />
        <div className="flex flex-1 flex-col min-h-0">
          <div className="h-32 w-full rounded-lg border border-border/50 bg-surface/50 animate-pulse" ref={fit.ref} />
        </div>
      </>
    )
  }

  const { node, path } = level
  const parent = path.length > 1 ? path[path.length - 2] : undefined
  const dirs = [...level.children, ...extraDirs]

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-surface/30 shrink-0">
        <div className="flex gap-1">
          <button
            type="button"
            className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            onClick={() => parent && navigate(parent.id)}
            disabled={!parent}
            title="Back to parent directory"
          >
            ← Back
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            onClick={() => setOpenId(null)}
            disabled={path.length <= 1}
            title="Jump to the scan root"
          >
            ⌂ Root
          </button>
        </div>

        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatCount(node.dirCount)} dirs · {formatCount(node.fileCount)} files ·{' '}
          {formatSize(node.size)}
        </span>

        <div className="flex-1" />

        <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label="View mode">
          <button
            type="button"
            className={`px-2.5 py-1 text-[11px] transition-colors ${view === 'list' ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`px-2.5 py-1 text-[11px] transition-colors ${view === 'treemap' ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
            aria-pressed={view === 'treemap'}
            onClick={() => setView('treemap')}
          >
            Treemap
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/20 bg-surface/20 shrink-0">
        <Breadcrumbs path={path} onNavigate={navigate} />
        <TreeSearch target={target} onOpen={setOpenId} />
      </div>

      <div className={`flex flex-1 flex-col min-h-0${loading ? ' opacity-50 pointer-events-none' : ''}`} ref={fit.ref}>
        {view === 'list' ? (
          <EntryList
            dirs={dirs}
            totalSize={totalSize}
            onOpen={open}
            onLoadMore={level.truncated ? loadMore : undefined}
            loadingMore={loadingMore}
            shownCount={dirs.length}
            totalCount={level.childTotal}
            fileCount={level.fileTotal}
            filesRemainder={level.remainder}
          />
        ) : (
          <>
            <Treemap level={level} onOpen={open} />
            <p className="text-center text-[10px] text-muted-foreground p-2">
              Click a tile to drill in. Tiles without subdirectories are not clickable.
              {level.truncated && ' Smaller entries are grouped — switch to List to page through them.'}
            </p>
          </>
        )}
      </div>
    </>
  )
}
