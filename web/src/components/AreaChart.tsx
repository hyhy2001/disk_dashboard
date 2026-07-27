// Used-space timeline, one point per scan snapshot.
//
// The y-axis is anchored at 0 rather than at min(used): a trend line that starts
// mid-axis exaggerates small changes, and "how full is the disk" is only
// meaningful against total capacity.

import type { HistoryPoint } from '../../../shared/api.js'
import { formatScanDate, formatSize } from '../lib/format.js'

interface Props {
  points: HistoryPoint[]
}

const WIDTH = 520
const HEIGHT = 170
const PAD_L = 52
const PAD_R = 12
const PAD_T = 12
const PAD_B = 24

export function AreaChart({ points }: Props): JSX.Element {
  if (points.length === 0) {
    return <p className="empty">No history yet — the timeline needs at least one scan.</p>
  }

  // A single snapshot has no slope to draw; show the value instead of a dot
  // floating in an empty grid.
  if (points.length === 1) {
    const only = points[0] as HistoryPoint
    return (
      <p className="empty">
        Only one snapshot so far ({formatScanDate(only.date)}: {formatSize(only.usedSize)} used).
        The trend appears after the next scan.
      </p>
    )
  }

  const plotW = WIDTH - PAD_L - PAD_R
  const plotH = HEIGHT - PAD_T - PAD_B
  const maxY = Math.max(...points.map((p) => p.totalSize || p.usedSize), 1)

  const x = (i: number): number => PAD_L + (i / (points.length - 1)) * plotW
  const y = (v: number): number => PAD_T + plotH - (v / maxY) * plotH

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.usedSize)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${PAD_T + plotH} L${PAD_L},${PAD_T + plotH} Z`

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  // With many snapshots the x labels would overlap, so thin them to ~8.
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Used space across ${points.length} scans`}
    >
      {ticks.map((t) => {
        const gy = PAD_T + plotH - t * plotH
        return (
          <g key={t}>
            <line className="chart__grid" x1={PAD_L} y1={gy} x2={WIDTH - PAD_R} y2={gy} />
            <text className="chart__axis" x={PAD_L - 7} y={gy + 3} textAnchor="end">
              {formatSize(maxY * t)}
            </text>
          </g>
        )
      })}

      <path className="chart__area" d={area} />
      <path className="chart__line" d={line} />

      {points.map((p, i) => (
        <g key={`${p.date}-${i}`}>
          <circle className="chart__dot" cx={x(i)} cy={y(p.usedSize)} r={3}>
            <title>{`${formatScanDate(p.date)}: ${formatSize(p.usedSize)} used of ${formatSize(p.totalSize)}`}</title>
          </circle>
          {i % labelEvery === 0 && (
            <text
              className="chart__axis"
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
            >
              {formatScanDate(p.date)}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}
