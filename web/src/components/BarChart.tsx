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
import { useSize } from '../lib/useSize.js'

interface Props {
  rows: UsageRow[]
  /** How many bars to draw; the rest are dropped. */
  limit?: number
  logScale?: boolean
}

const ROW_H = 24
/** Legacy caps bars at 32px so labels never collide; rows here are tighter. */
const BAR_H = 13
/** Wide enough for a 16-character username at the 12px chart font. */
const LABEL_W = 122
const VALUE_W = 74

/** Smallest value a log axis can plot; log(0) is -Infinity. */
const LOG_FLOOR = 1

/** Below this a row cannot hold a 12px label without crowding. */
const MIN_ROW_H = 18

/** Height reserved for the size axis labels at the bottom of the chart. */
const AXIS_H = 18

export function BarChart({ rows, limit = 10, logScale = false }: Props): JSX.Element {
  const [box, size] = useSize<HTMLDivElement>()

  const ranked = [...rows].filter((r) => r.used > 0).sort((a, b) => b.used - a.used)

  // Wait for measurement so the viewBox matches real pixels exactly.
  if (!size || size.width === 0 || size.height === 0) {
    return <div ref={box} className="chartbox h-full min-h-[200px]" />
  }

  const width = size.width
  const avail = size.height

  // Height left after reserving AXIS_H for the size axis below the last bar.
  const availRows = Math.max(0, avail - AXIS_H)

  // Drop the smallest consumers rather than shrink the text below legibility:
  // eight readable rows beat ten unreadable ones, and since rows are ranked, the
  // ones cut are the least interesting. Fitting is measured against availRows —
  // not avail — so rows*MIN_ROW_H + AXIS_H never exceeds the box (otherwise the
  // axis would be pushed past the card's bottom edge and clipped).
  const fits = availRows > 0 ? Math.max(3, Math.floor(availRows / MIN_ROW_H)) : limit
  const data = ranked.slice(0, Math.min(limit, fits))

  if (data.length === 0) {
    return (
      <div ref={box} className="chartbox">
        <p className="empty">No users to chart.</p>
      </div>
    )
  }

  const max = data[0]?.used ?? 1
  const trackW = Math.max(60, width - LABEL_W - VALUE_W)
  // Floor the row height so rows*rowH never exceeds the box; otherwise
  // preserveAspectRatio scales the drawing down and shrinks the text with it.
  const rowH = availRows > 0 ? Math.max(MIN_ROW_H, Math.min(ROW_H, Math.floor(availRows / data.length))) : ROW_H
  const barH = Math.max(8, Math.min(BAR_H, rowH - 9))
  const height = data.length * rowH + AXIS_H

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

  /**
   * Value a given fraction of the track represents — the inverse of widthFor.
   * Used to label the size axis ticks on the same scale as the bars.
   */
  const valueAt = (t: number): number => {
    if (!logScale) return t * max
    const lo = Math.log10(LOG_FLOOR)
    const hi = Math.log10(Math.max(max, LOG_FLOOR + 1))
    return Math.pow(10, lo + t * (hi - lo))
  }

  // Size axis ticks: 0/25/50/75/100% of the axis range, matching the y-axis
  // tick pattern used by the capacity timeline.
  const AXIS_TICKS = [0, 0.25, 0.5, 0.75, 1] as const
  // The axis sits just below the last bar, inside the AXIS_H band. Anchoring it
  // to `height` put the labels at y = height + 5, outside the viewBox, so the
  // whole row was clipped away.
  const axisY = data.length * rowH + 6

  return (
    <div className="chartbox" ref={box}>
      <div className="flex h-full min-h-0 items-center justify-center">
        <svg
          className="chart"
          style={{ height }}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={`Top ${data.length} users by disk usage${logScale ? ', logarithmic scale' : ''}`}
        >
        {data.map((r, i) => {
          const y = i * rowH
          const w = Math.max(2, widthFor(r.used))
          const mid = y + barH / 2 + 5
          return (
            <g key={r.name}>
              {/* Every name renders. Chart.js autoSkip would drop every other
                  label when narrow, showing 10 bars but 5 names. */}
              <text className="chart__axis" x={LABEL_W - 8} y={mid} textAnchor="end">
                {r.name.length > 16 ? `${r.name.slice(0, 15)}…` : r.name}
              </text>
              <rect x={LABEL_W} y={y + 2} width={trackW} height={barH} rx={4} fill="var(--bg-hover)" />
              <rect className="chart__bar" x={LABEL_W} y={y + 2} width={w} height={barH} rx={4} fill="var(--sky-400)">
                <title>{`${r.name}: ${formatSize(r.used)}`}</title>
              </rect>
              <text className="chart__axis chart__axis--mono" x={LABEL_W + trackW + 8} y={mid}>
                {formatSize(r.used)}
              </text>
            </g>
          )
        })}

        {/* Size axis at the bottom, aligned to the bar track. */}
        <line className="chart__grid" x1={LABEL_W} y1={axisY} x2={LABEL_W + trackW} y2={axisY} />
        {AXIS_TICKS.map((t) => {
          const x = LABEL_W + t * trackW
          return (
            <text key={t} className="chart__axis chart__axis--mono" x={x} y={axisY + 10} textAnchor="middle">
              {formatSize(valueAt(t))}
            </text>
          )
        })}
        </svg>
      </div>
    </div>
  )
}
