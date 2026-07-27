// Horizontal bar chart for the top-users leaderboard.
//
// Drawn in a viewBox-scaled SVG so it stays sharp at any column width without a
// resize observer. Bars are sorted descending, so the widest is always first.
//
// Log scale exists because usage is usually dominated by one or two accounts: on
// a linear axis everyone else collapses to an invisible sliver. The tradeoff is
// that bar *area* stops being comparable, so linear stays the default.

import type { UsageRow } from '../../../shared/api.js'
import { formatSize } from '../lib/format.js'

interface Props {
  rows: UsageRow[]
  /** How many bars to draw; the rest are dropped. */
  limit?: number
  logScale?: boolean
}

const ROW_H = 22
/** Legacy caps bars at 32px so labels never collide; rows here are tighter. */
const BAR_H = 12
const LABEL_W = 108
const VALUE_W = 66
const WIDTH = 460

/** Smallest value a log axis can plot; log(0) is -Infinity. */
const LOG_FLOOR = 1

export function BarChart({ rows, limit = 10, logScale = false }: Props): JSX.Element {
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

  /**
   * Bar width as a fraction of the track. On a log axis a zero would vanish
   * along with its label, so values are clamped to 1 byte; the printed value
   * still shows the real number.
   */
  const widthFor = (v: number): number => {
    if (!logScale) return (v / max) * trackW
    const lo = Math.log10(LOG_FLOOR)
    const hi = Math.log10(Math.max(max, LOG_FLOOR + 1))
    const cur = Math.log10(Math.max(v, LOG_FLOOR))
    return ((cur - lo) / (hi - lo)) * trackW
  }

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      // Fit inside the canvas box rather than overflowing it: the chart is
      // allowed to shrink so all three panels stay within one screen.
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Top ${data.length} users by disk usage${logScale ? ', logarithmic scale' : ''}`}
    >
      {data.map((r, i) => {
        const y = i * ROW_H
        const w = Math.max(2, widthFor(r.used))
        const mid = y + BAR_H / 2 + 4
        return (
          <g key={r.name}>
            {/* Every name renders. Chart.js autoSkip would drop every other
                label when narrow, showing 10 bars but 5 names. */}
            <text
              className="chart__axis"
              x={LABEL_W - 8}
              y={mid}
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
              rx={4}
              fill="var(--bg-hover)"
            />
            <rect
              className="chart__bar"
              x={LABEL_W}
              y={y + 2}
              width={w}
              height={BAR_H}
              rx={4}
              fill="var(--sky-400)"
            >
              <title>{`${r.name}: ${formatSize(r.used)}`}</title>
            </rect>
            <text
              className="chart__axis"
              x={LABEL_W + trackW + 8}
              y={mid}
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
