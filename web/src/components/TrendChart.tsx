// Per-user usage over time: one line per selected account.
//
// Shares the timeline conventions of AreaChart (viewBox in real pixels so declared
// font sizes render 1:1, y axis on the right, crosshair snapped to a scan) but
// differs in two ways that matter:
//
//   - N series instead of 3, so colours come from a palette and the legend is the
//     only thing identifying them.
//   - an optional log scale. Accounts differ by orders of magnitude; on a linear
//     axis every line but the largest collapses onto the baseline.
//
// Log of zero is undefined, and a user with no data in a snapshot legitimately
// reads 0, so the log transform floors at 1 byte rather than dropping the point —
// dropping it would break the line and imply the account vanished.

import { useState } from 'react'
import type { UserTrend } from '../../../shared/api.js'
import { formatScanDate, formatSize } from '../lib/format.js'
import { useSize } from '../lib/useSize.js'

const PAD_L = 14
const PAD_R = 92
const PAD_T = 12
const PAD_B = 34

/**
 * Line colours. Twelve distinct hues; beyond that the palette repeats, which is
 * why the picker caps how many users can be plotted at once.
 *
 * The dark palette is tuned for a dark background; light mode uses the 600/700
 * step of each hue so the lines stay readable without glaring on a light base.
 */
export const PALETTE = [
  '#38bdf8',
  '#fbbf24',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#4ade80',
  '#f87171',
  '#22d3ee',
  '#e879f9',
  '#facc15',
  '#94a3b8',
] as const

const LIGHT_PALETTE = [
  '#0284c7',
  '#d97706',
  '#059669',
  '#db2777',
  '#7c3aed',
  '#ea580c',
  '#16a34a',
  '#dc2626',
  '#0891b2',
  '#c026d3',
  '#ca8a04',
  '#64748b',
] as const

interface Props {
  /** Series to draw, in the order they were selected. */
  trends: UserTrend[]
  /** Every scan date, so all series share one x axis even with gaps. */
  dates: number[]
  logScale: boolean
}

export function TrendChart({ trends, dates, logScale }: Props): JSX.Element {
  const [hover, setHover] = useState<number | null>(null)
  const [box, size] = useSize<HTMLDivElement>()
  const palette = document.documentElement.dataset.theme === 'light' ? LIGHT_PALETTE : PALETTE

  const measured = size && size.width > 0 && size.height > 0

  if (trends.length === 0) {
    return (
      <div ref={box} className="chartbox">
        <p className="empty">Select one or more users to plot their usage over time.</p>
      </div>
    )
  }
  if (dates.length < 2) {
    return (
      <div ref={box} className="chartbox">
        <p className="empty">A trend needs at least two scans. Only one snapshot exists.</p>
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

  // Index by date so a user missing from a snapshot renders as a gap rather than
  // shifting their remaining points left onto the wrong dates.
  const byUser = trends.map((t) => {
    const map = new Map<number, number>()
    for (const p of t.points) map.set(p.date, p.used)
    return { name: t.name, values: dates.map((d) => map.get(d)) }
  })

  const maxY = Math.max(...byUser.flatMap((u) => u.values.map((v) => v ?? 0)), 1)

  const x = (i: number): number => PAD_L + (i / (dates.length - 1)) * plotW

  /** Map a byte value to a y coordinate, honouring the scale mode. */
  const y = (v: number): number => {
    if (!logScale) return PAD_T + plotH - (v / maxY) * plotH
    // Floor at 1: log10(0) is -Infinity, and a real 0 must still land on the axis.
    const lv = Math.log10(Math.max(1, v))
    const lmax = Math.log10(Math.max(10, maxY))
    return PAD_T + plotH - (lv / lmax) * plotH
  }

  /** Path for one series, breaking the line where the user has no data. */
  const pathFor = (values: (number | undefined)[]): string => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === undefined) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(i)},${y(v)} `
      pen = true
    })
    return d.trim()
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const labelEvery = Math.max(1, Math.ceil(dates.length / 8))

  /** Axis label for a fractional height, inverting whichever scale is active. */
  const tickLabel = (t: number): string => {
    if (!logScale) return formatSize(maxY * t)
    const lmax = Math.log10(Math.max(10, maxY))
    return formatSize(10 ** (lmax * t))
  }

  const pick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const vx = ((e.clientX - rect.left) / rect.width) * width
    const ratio = (vx - PAD_L) / plotW
    const raw = Math.round(ratio * (dates.length - 1))
    setHover(Math.min(dates.length - 1, Math.max(0, raw)))
  }

  // Rows in the tooltip, biggest first at the hovered scan — the ordering a viewer
  // needs to read "who is largest here" without matching colours to the legend.
  const rows =
    hover === null
      ? []
      : byUser
          .map((u, i) => ({
            name: u.name,
            value: u.values[hover],
            color: palette[i % palette.length] as string,
          }))
          .filter((r): r is { name: string; value: number; color: string } => r.value !== undefined)
          .sort((a, b) => b.value - a.value)

  const TIP_W = 190
  const tipH = 20 + rows.length * 16
  const tipX = hover === null ? 0 : x(hover) + 12 + TIP_W > width - PAD_R ? x(hover) - 12 - TIP_W : x(hover) + 12
  const tipY = Math.min(PAD_T, PAD_T + plotH - tipH)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="chartbox min-h-0 flex-1" ref={box}>
        <svg
          className="chart"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          role="img"
          aria-label={`Usage over time for ${trends.length} users`}
          onMouseMove={pick}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => {
            const gy = PAD_T + plotH - t * plotH
            return (
              <g key={t}>
                <line className="chart__grid" x1={PAD_L} y1={gy} x2={width - PAD_R} y2={gy} />
                <text className="chart__axis chart__axis--mono" x={width - PAD_R + 8} y={gy + 3}>
                  {tickLabel(t)}
                </text>
              </g>
            )
          })}

          {byUser.map((u, i) => (
            <path
              key={u.name}
              className="chart__line"
              d={pathFor(u.values)}
              stroke={palette[i % palette.length]}
              strokeWidth={1.5}
              fill="none"
            />
          ))}

          {hover !== null && (
            <g pointerEvents="none">
              <line className="chart__cross-line" x1={x(hover)} y1={PAD_T} x2={x(hover)} y2={PAD_T + plotH} />
              {rows.map((r) => (
                <circle key={r.name} cx={x(hover)} cy={y(r.value)} r={3} className="chart__dot" stroke={r.color} />
              ))}

              <g className="chart__pill">
                <rect x={x(hover) - 34} y={PAD_T + plotH + 4} width={68} height={17} rx={4} />
                <text x={x(hover)} y={PAD_T + plotH + 16} textAnchor="middle">
                  {formatScanDate(dates[hover] ?? 0)}
                </text>
              </g>

              {rows.length > 0 && (
                <g className="chart__tip">
                  <rect x={tipX} y={tipY} width={TIP_W} height={tipH} rx={6} />
                  <text className="chart__tip-title" x={tipX + 10} y={tipY + 15}>
                    {formatScanDate(dates[hover] ?? 0)}
                  </text>
                  {rows.map((r, i) => (
                    <g key={r.name}>
                      <rect x={tipX + 10} y={tipY + 24 + i * 16} width={8} height={8} rx={2} fill={r.color} />
                      <text className="chart__tip-row" x={tipX + 24} y={tipY + 32 + i * 16}>
                        {r.name}
                      </text>
                      <text className="chart__tip-val" x={tipX + TIP_W - 10} y={tipY + 32 + i * 16} textAnchor="end">
                        {formatSize(r.value)}
                      </text>
                    </g>
                  ))}
                </g>
              )}
            </g>
          )}

          {dates.map((d, i) =>
            i % labelEvery === 0 ? (
              <text className="chart__axis" key={`${d}-${i}`} x={x(i)} y={height - 8} textAnchor="middle">
                {formatScanDate(d)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      <div className="chart__legend shrink-0">
        {trends.map((t, i) => (
          <span className="chart__key" key={t.name}>
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="16" y2="3" stroke={palette[i % palette.length]} strokeWidth="2" />
            </svg>
            {t.name}
          </span>
        ))}
      </div>
    </div>
  )
}
