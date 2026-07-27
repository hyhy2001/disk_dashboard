// Treemap canvas: one level of the tree as squarified rectangles.
//
// Rendered as SVG rather than <canvas> so each tile is a real DOM node — that
// gives keyboard focus, hover tooltips and accessible labels for free, which a
// canvas would need reimplementing. At the server's 60-child cap the node count
// stays trivial for the browser.
//
// Clicking a tile drills in; only directories that have children are clickable,
// so a leaf does not produce an empty level.

import { useMemo } from 'react'
import type { TreemapLevel, TreemapNode } from '../../../shared/api.js'
import { formatCount, formatPercent, formatSize } from '../lib/format.js'
import { squarify } from '../lib/squarify.js'

interface Props {
  level: TreemapLevel
  onOpen: (node: TreemapNode) => void
}

const WIDTH = 900
const HEIGHT = 460

/** Tile must be at least this big before it gets a text label. */
const LABEL_MIN_W = 54
const LABEL_MIN_H = 26

/** Synthetic tile standing in for the truncated tail plus this dir's own files. */
interface Cell {
  node: TreemapNode | null
  name: string
  size: number
}

/**
 * Colour by depth-independent hash of the name so a directory keeps its colour
 * as the user drills around, instead of shifting with sort order.
 */
function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function fillFor(cell: Cell): string {
  if (!cell.node) return 'var(--bg-hover)'
  // Anchor around the emerald accent: a narrow band keeps it on-brand while
  // still separating neighbours.
  const h = 120 + (hue(cell.name) % 140)
  return `hsl(${h} 42% 38%)`
}

export function Treemap({ level, onOpen }: Props): JSX.Element {
  const cells = useMemo<Cell[]>(() => {
    const list: Cell[] = level.children.map((n) => ({ node: n, name: n.name, size: n.size }))
    if (level.remainder > 0) {
      list.push({
        node: null,
        name: level.truncated ? 'other (smaller items)' : 'files here',
        size: level.remainder,
      })
    }
    return list
  }, [level])

  const layout = useMemo(
    () => squarify(cells, (c) => c.size, { x: 0, y: 0, w: WIDTH, h: HEIGHT }),
    [cells],
  )

  if (cells.length === 0) {
    return (
      <p className="empty">
        {level.node.name} holds no subdirectories{level.node.hasFiles ? ' — only files' : ''}.
      </p>
    )
  }

  // Sub-pixel tiles are dropped by the layout; say so instead of silently
  // showing fewer items than the directory contains.
  const hidden = cells.length - layout.length

  return (
    <div className="treemap">
      <svg
        className="treemap__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Contents of ${level.node.name}, ${layout.length} tiles`}
      >
        {layout.map(({ item, x, y, w, h }) => {
          const clickable = item.node !== null && item.node.hasChildren
          const label = `${item.name} — ${formatSize(item.size)} (${formatPercent(
            item.size,
            level.node.size,
          )})`

          return (
            <g
              key={item.node ? `n${item.node.id}` : 'remainder'}
              className={`tile${clickable ? ' tile--open' : ''}`}
              transform={`translate(${x} ${y})`}
              onClick={clickable && item.node ? () => onOpen(item.node as TreemapNode) : undefined}
              onKeyDown={
                clickable && item.node
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onOpen(item.node as TreemapNode)
                      }
                    }
                  : undefined
              }
              tabIndex={clickable ? 0 : -1}
              role={clickable ? 'button' : undefined}
              aria-label={clickable ? `Open ${label}` : label}
            >
              <title>
                {label}
                {item.node ? `\n${formatCount(item.node.fileCount)} files · owner ${item.node.owner}` : ''}
              </title>
              <rect
                className="tile__rect"
                width={Math.max(0, w - 1.5)}
                height={Math.max(0, h - 1.5)}
                rx={3}
                fill={fillFor(item)}
              />
              {w >= LABEL_MIN_W && h >= LABEL_MIN_H && (
                <>
                  <text className="tile__name" x={6} y={15}>
                    {item.name.length > Math.floor(w / 7)
                      ? `${item.name.slice(0, Math.max(1, Math.floor(w / 7) - 1))}…`
                      : item.name}
                  </text>
                  {h >= 40 && (
                    <text className="tile__size" x={6} y={29}>
                      {formatSize(item.size)}
                    </text>
                  )}
                </>
              )}
            </g>
          )
        })}
      </svg>

      {hidden > 0 && (
        <p className="treemap__note">
          {hidden} item{hidden === 1 ? '' : 's'} too small to draw at this size.
        </p>
      )}
    </div>
  )
}
