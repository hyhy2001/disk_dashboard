// Capacity timeline: three series, one point per scan snapshot.
//
//   Used Capacity  — what the filesystem reports (solid, filled)
//   Scan Result    — what duscan actually walked (dashed)
//   Total Capacity — the disk's size (dashed)
//
// Used and Scan Result diverge wherever the scanner could not descend, so
// plotting both makes unattributed usage visible instead of hiding it. Legacy
// drew the same three lines with the same names.
//
// The y-axis is anchored at 0 rather than at min(used): a trend line starting
// mid-axis exaggerates small changes, and "how full is the disk" is only
// meaningful against total capacity.

import { useId, useState } from 'react'
import type { HistoryPoint } from '../../../shared/api.js'
import { formatScanDate, formatSize } from '../lib/format.js'

interface Props {
  points: HistoryPoint[]
  /**
   * Height of the plot in viewBox units. Only affects the internal coordinate
   * system — CSS decides the rendered size — so this is about the aspect ratio,
   * not the pixel height.
   */
  height?: number
}

const WIDTH = 560
const PAD_L = 14
/** Legacy pins the y axis on the right at a fixed 90px. */
const PAD_R = 78
const PAD_T = 12
const PAD_B = 26

// Legacy's exact strokes: solid amber for Used, translucent dashed amber for the
// scan result, translucent dashed slate for Total.
const SERIES = [
  {
    key: 'usedSize',
    label: 'Used Capacity',
    color: '#fbbf24',
    dash: '',
    width: 1.5,
    fill: true,
  },
  {
    key: 'scannedSize',
    label: 'Scan Result',
    color: 'rgba(251,191,36,0.55)',
    dash: '4 3',
    width: 1,
    fill: false,
  },
  {
    key: 'totalSize',
    label: 'Total Capacity',
    color: 'rgba(148,163,184,0.60)',
    dash: '6 4',
    width: 2,
    fill: false,
  },
] as const

export function AreaChart({ points, height = 190 }: Props): JSX.Element {
  // Index of the hovered point, driving the crosshair.
  const [hover, setHover] = useState<number | null>(null)
  // The panel and the fullscreen modal both mount this chart, so the gradient
  // needs an id unique per instance or one would reference the other's def.
  const gradId = `used-fill-${useId().replace(/:/g, '')}`
  const light = document.documentElement.dataset.theme === 'light'

  if (points.length === 0) {
    return <p className="empty">No history yet — the timeline needs at least one scan.</p>
  }

  if (points.length === 1) {
    const only = points[0] as HistoryPoint
    return (
      <p className="empty">
        Only one snapshot so far ({formatScanDate(only.date)}: {formatSize(only.usedSize)} used,{' '}
        {formatSize(only.scannedSize)} scanned). The trend appears after the next scan.
      </p>
    )
  }

  const plotW = WIDTH - PAD_L - PAD_R
  const plotH = height - PAD_T - PAD_B
  const maxY = Math.max(...points.map((p) => Math.max(p.totalSize, p.usedSize)), 1)

  const x = (i: number): number => PAD_L + (i / (points.length - 1)) * plotW
  const y = (v: number): number => PAD_T + plotH - (v / maxY) * plotH

  const pathFor = (key: (typeof SERIES)[number]['key']): string =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p[key])}`).join(' ')

  const usedPath = pathFor('usedSize')
  const area = `${usedPath} L${x(points.length - 1)},${PAD_T + plotH} L${PAD_L},${PAD_T + plotH} Z`

  const latest = points[points.length - 1] as HistoryPoint
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labelEvery = Math.max(1, Math.ceil(points.length / 8))
  const active = hover !== null ? points[hover] : undefined

  /** Nearest data index for a pointer position, in viewBox units. */
  const pick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * WIDTH
    const ratio = (vx - PAD_L) / plotW
    const i = Math.round(ratio * (points.length - 1))
    setHover(i >= 0 && i < points.length ? i : null)
  }

  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Capacity across ${points.length} scans`}
        onMouseMove={pick}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {/* Gradient under the Used line, denser in light mode where a faint
              wash would disappear against the paper background. */}
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity={light ? 0.55 : 0.26} />
            <stop offset="65%" stopColor="#fbbf24" stopOpacity={light ? 0.15 : 0.06} />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity={light ? 0.03 : 0.02} />
          </linearGradient>
        </defs>

        {ticks.map((t) => {
          const gy = PAD_T + plotH - t * plotH
          return (
            <g key={t}>
              <line className="chart__grid" x1={PAD_L} y1={gy} x2={WIDTH - PAD_R} y2={gy} />
              {/* Axis labels on the right, as legacy positioned them. */}
              <text className="chart__axis" x={WIDTH - PAD_R + 8} y={gy + 3}>
                {formatSize(maxY * t)}
              </text>
            </g>
          )
        })}

        <path d={area} fill={`url(#${gradId})`} />

        {SERIES.map((s) => (
          <path
            key={s.key}
            className="chart__line"
            d={pathFor(s.key)}
            stroke={s.color}
            strokeDasharray={s.dash || undefined}
            strokeWidth={s.width}
          />
        ))}

        {/* Reference line at the latest used value, so the current level reads
            off the axis at a glance. */}
        <line
          className="chart__ref"
          x1={PAD_L}
          y1={y(latest.usedSize)}
          x2={WIDTH - PAD_R}
          y2={y(latest.usedSize)}
        />

        {hover !== null && active && (
          <g className="chart__cross" pointerEvents="none">
            <line x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + plotH} />
            <circle cx={x(hover)} cy={y(active.usedSize)} r={3.5} className="chart__dot" />
            <circle cx={x(hover)} cy={y(active.scannedSize)} r={3} className="chart__dot" />
          </g>
        )}

        {points.map((p, i) => (
          <g key={`${p.date}-${i}`}>
            {i % labelEvery === 0 && (
              <text className="chart__axis" x={x(i)} y={height - 8} textAnchor="middle">
                {formatScanDate(p.date)}
              </text>
            )}
          </g>
        ))}
      </svg>

      <div className="chart__legend">
        {SERIES.map((s) => (
          <span className="chart__key" key={s.key}>
            <svg width="16" height="6" aria-hidden="true">
              <line
                x1="0"
                y1="3"
                x2="16"
                y2="3"
                stroke={s.color}
                strokeWidth="2"
                strokeDasharray={s.dash || undefined}
              />
            </svg>
            {s.label}
            {active && <span className="chart__key-val">{formatSize(active[s.key])}</span>}
          </span>
        ))}
        {active && <span className="chart__key-date">{formatScanDate(active.date)}</span>}
      </div>
    </>
  )
}
