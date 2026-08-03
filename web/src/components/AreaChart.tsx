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
import { useSize } from '../lib/useSize.js'

interface Props {
  points: HistoryPoint[]
  showLegend?: boolean
}

/** Layout constants for the plot box inside the SVG. */
const PAD_L = 14
const PAD_R = 92
const PAD_T = 12
const PAD_B = 34

// Legacy's exact strokes: solid amber for Used, translucent dashed amber for the
// scan result, translucent dashed slate for Total. The amber is a CSS var so it
// deepens to amber-600 on the light theme instead of glaring.
const SERIES = [
  {
    key: 'usedSize',
    label: 'Used Capacity',
    color: 'var(--amber-400)',
    dash: '',
    width: 1.5,
    fill: true,
  },
  {
    key: 'scannedSize',
    label: 'Scan Result',
    color: 'color-mix(in srgb, var(--amber-400) 55%, transparent)',
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

export function AreaChart({ points, showLegend }: Props): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const [cursorY, setCursorY] = useState<number | null>(null)
  const [box, size] = useSize<HTMLDivElement>()
  const gradId = `used-fill-${useId().replace(/:/g, '')}`
  const light = document.documentElement.dataset.theme === 'light'

  const measured = size && size.width > 0 && size.height > 0

  if (points.length === 0) {
    return (
      <div ref={box} className="chartbox">
        <p className="empty">No history yet — the timeline needs at least one scan.</p>
      </div>
    )
  }

  if (points.length === 1) {
    const only = points[0] as HistoryPoint
    return (
      <div ref={box} className="chartbox">
        <p className="empty">
          Only one snapshot so far ({formatScanDate(only.date)}: {formatSize(only.usedSize)} used,{' '}
          {formatSize(only.scannedSize)} scanned). The trend appears after the next scan.
        </p>
      </div>
    )
  }

  // Wait for useSize measurement so viewBox matches real pixels — no reflow.
  if (!measured) {
    return <div ref={box} className="chartbox h-full min-h-[200px]" />
  }

  const width = size.width
  const height = size.height

  const plotW = width - PAD_L - PAD_R
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

  /**
   * Track the nearest data index and the raw pointer y.
   *
   * The vertical crosshair snaps to a data point, but the horizontal one follows
   * the cursor freely — that is what makes it a readout of "what value is my
   * cursor at", which is how legacy behaves.
   */
  const pick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * width
    const vy = ((e.clientY - rect.top) / rect.height) * height
    const ratio = (vx - PAD_L) / plotW
    const raw = Math.round(ratio * (points.length - 1))
    // Clamp rather than clear: the y-axis gutter on the right is inside the svg,
    // so dropping the crosshair there would make it flicker off whenever the
    // pointer drifts past the last data point.
    setHover(Math.min(points.length - 1, Math.max(0, raw)))
    setCursorY(vy >= PAD_T && vy <= PAD_T + plotH ? vy : null)
  }

  /** Value under the horizontal crosshair, inverting the y scale. */
  const valueAtCursor = cursorY === null ? null : ((PAD_T + plotH - cursorY) / plotH) * maxY

  // Tooltip box placement: flip to the left of the crosshair when it would run
  // past the right edge, so it never leaves the plot.
  const TIP_W = 168
  const tipH = 20 + SERIES.length * 16
  const tipX = hover === null ? 0 : x(hover) + 12 + TIP_W > width - PAD_R ? x(hover) - 12 - TIP_W : x(hover) + 12
  const tipY = Math.min(Math.max(PAD_T, (cursorY ?? PAD_T) - tipH / 2), PAD_T + plotH - tipH)

  return (
    <>
      {/* The measured box holds only the svg — the legend below it is normal flow
          content and must not count toward the plot's height. */}
      <div className="chartbox" ref={box}>
        <svg
          className="chart"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={`Capacity across ${points.length} scans`}
          onMouseMove={pick}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {/* Gradient under the Used line, denser in light mode where a faint
              wash would disappear against the paper background. */}
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--amber-400)" stopOpacity={light ? 0.55 : 0.26} />
              <stop offset="65%" stopColor="var(--amber-400)" stopOpacity={light ? 0.15 : 0.06} />
              <stop offset="100%" stopColor="var(--amber-400)" stopOpacity={light ? 0.03 : 0.02} />
            </linearGradient>
          </defs>

          {ticks.map((t) => {
            const gy = PAD_T + plotH - t * plotH
            return (
              <g key={t}>
                <line className="chart__grid" x1={PAD_L} y1={gy} x2={width - PAD_R} y2={gy} />
                {/* Axis labels on the right, as legacy positioned them. */}
                <text className="chart__axis chart__axis--mono" x={width - PAD_R + 8} y={gy + 3}>
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
          <line className="chart__ref" x1={PAD_L} y1={y(latest.usedSize)} x2={width - PAD_R} y2={y(latest.usedSize)} />

          {hover !== null && active && (
            <g pointerEvents="none">
              {/* Vertical line, snapped to the hovered scan. */}
              <line className="chart__cross-line" x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + plotH} />
              {/* One marker per series, so the crosshair shows where each line sits
                at this scan rather than only the Used value. */}
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(active[s.key])}
                  r={3.5}
                  className="chart__dot"
                  stroke={s.color}
                />
              ))}

              {/* Horizontal line following the cursor, with the value it points at
                on the y axis — this answers "how much is this height?" for any
                position, not just at a data point. */}
              {cursorY !== null && valueAtCursor !== null && (
                <>
                  <line className="chart__cross-line" x1={PAD_L} y1={cursorY} x2={width - PAD_R} y2={cursorY} />
                  <g className="chart__pill">
                    <rect x={width - PAD_R + 4} y={cursorY - 9} width={PAD_R - 8} height={18} rx={4} />
                    <text x={width - PAD_R + 8} y={cursorY + 4}>
                      {formatSize(valueAtCursor)}
                    </text>
                  </g>
                </>
              )}

              {/* Tooltip box listing every series at the hovered scan, as legacy's
                index-mode tooltip did. */}
              <g className="chart__tip">
                <rect x={tipX} y={tipY} width={TIP_W} height={tipH} rx={6} />
                <text className="chart__tip-title" x={tipX + 10} y={tipY + 15}>
                  {formatScanDate(active.date)}
                </text>
                {SERIES.map((s, i) => (
                  <g key={s.key}>
                    <rect x={tipX + 10} y={tipY + 24 + i * 16} width={8} height={8} rx={2} fill={s.color} />
                    <text className="chart__tip-row" x={tipX + 24} y={tipY + 32 + i * 16}>
                      {s.label}
                    </text>
                    <text className="chart__tip-val" x={tipX + TIP_W - 10} y={tipY + 32 + i * 16} textAnchor="end">
                      {formatSize(active[s.key])}
                    </text>
                  </g>
                ))}
              </g>
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
      </div>

      {showLegend !== false && (
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
            </span>
          ))}
        </div>
      )}
    </>
  )
}

export function ChartLegend({ series = SERIES }: { series?: typeof SERIES }) {
  return (
    <div className="chart__legend">
      {series.map((s) => (
        <span className="chart__key" key={s.key}>
          <svg width="16" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="16" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash || undefined} />
          </svg>
          {s.label}
        </span>
      ))}
    </div>
  )
}
