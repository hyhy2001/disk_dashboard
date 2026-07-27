// Treemap tab: breadcrumbs, summary of the open directory, and the tile canvas.
//
// Navigation state (which directory is open) lives here rather than in App, so
// switching tabs and coming back keeps the position. One fetch per level — the
// server query is O(children), so drilling stays fast at any tree size.

import { useCallback, useEffect, useState } from 'react'
import type { TreemapLevel, TreemapNode } from '../../../shared/api.js'
import { Breadcrumbs } from '../components/Breadcrumbs.js'
import { Treemap } from '../components/Treemap.js'
import { fetchTreemap } from '../lib/api.js'
import { formatCount, formatSize } from '../lib/format.js'

interface Props {
  target: string
}

export function TreemapTab({ target }: Props): JSX.Element {
  const [openId, setOpenId] = useState<number | null>(null)
  const [level, setLevel] = useState<TreemapLevel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Reset to the scan root when the target changes: ids are per-report, so
  // keeping the old one would open an unrelated directory.
  useEffect(() => {
    setOpenId(null)
  }, [target])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    fetchTreemap(target, openId)
      .then((data) => {
        if (!live) return
        setLevel(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [target, openId])

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

  // Keep the previous level visible while the next one loads: replacing it with
  // a skeleton on every drill makes the whole view flash.
  if (!level) {
    return <div className="skeleton" style={{ height: '460px' }} />
  }

  const { node, path } = level
  const parent = path.length > 1 ? path[path.length - 2] : undefined

  return (
    <>
      <div className="treemap__bar">
        <Breadcrumbs path={path} onNavigate={navigate} />
        {parent && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(parent.id)}
            title="Go up one level"
          >
            ↑ Up
          </button>
        )}
      </div>

      <div className="cards">
        <div className="card">
          <div className="card__label">Directory size</div>
          <div className="card__value">{formatSize(node.size)}</div>
          <div className="card__hint">{node.name}</div>
        </div>
        <div className="card">
          <div className="card__label">Subdirectories</div>
          <div className="card__value">{formatCount(node.dirCount)}</div>
          <div className="card__hint">{formatCount(node.fileCount)} files directly inside</div>
        </div>
        <div className="card">
          <div className="card__label">Owner</div>
          <div className="card__value" style={{ fontSize: '18px' }}>
            {node.owner}
          </div>
          <div className="card__hint">of this directory</div>
        </div>
      </div>

      <div className={`panel${loading ? ' panel--loading' : ''}`}>
        <h2 className="panel__title">
          Contents by size
          {level.truncated && (
            <span className="panel__note"> · showing the largest entries only</span>
          )}
        </h2>
        <Treemap level={level} onOpen={open} />
        <p className="treemap__hint">
          Click a tile to drill in. Tiles without subdirectories are not clickable.
        </p>
      </div>
    </>
  )
}
