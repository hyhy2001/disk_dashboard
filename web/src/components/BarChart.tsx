// Horizontal bar chart for the top-users leaderboard.
//
// Drawn in a viewBox-scaled SVG so it stays sharp at any column width without a
// resize observer. Bars are sorted descending, so the widest is always first and
// the scale is simply "widest bar = full width".

import type { UsageRow } from '../../../shared/api.js'
import { formatSize } from '../lib/format.js'

interface Props {
  rows: UsageRow[]
  /** How many bars to draw; the rest are dropped. */
  limit?: number
}

const ROW_H = 22
const BAR_H = 11
const LABEL_W = 108
const VALUE_W = 66
const WIDTH = 460

export function BarChart({ rows, limit = 10 }: Props): JSX.Element {
  const data = [...rows]
    .filter((r) => r.used > 0)
    .sort((a, b) => b.used - a.used)
    .slice(0, limit)

  if (data.length === 0) {
    return <p className="empty">No users to chart.</p>
  }

  const max = data[0]?.used ?? 1
  const trackW = WIDTH - LABEL_W - VALUE_W
  const height = data.length * ROW_H

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-label={`Top ${data.length} users by disk usage`}
    >
      {data.map((r, i) => {
        const y = i * ROW_H
        const w = Math.max(2, (r.used / max) * trackW)
        return (
          <g key={r.name}>
            <text
              className="chart__axis"
              x={LABEL_W - 8}
              y={y + BAR_H}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize="11"
            >
              {r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}
            </text>
            <rect
              x={LABEL_W}
              y={y + 2}
              width={trackW}
              height={BAR_H}
              rx={3}
              fill="var(--bg-hover)"
            />
            <rect
              className="chart__bar"
              x={LABEL_W}
              y={y + 2}
              width={w}
              height={BAR_H}
              rx={3}
              fill="var(--accent)"
            >
              <title>{`${r.name}: ${formatSize(r.used)}`}</title>
            </rect>
            <text
              className="chart__axis"
              x={LABEL_W + trackW + 8}
              y={y + BAR_H}
              fill="var(--text-muted)"
              fontSize="11"
            >
              {formatSize(r.used)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
