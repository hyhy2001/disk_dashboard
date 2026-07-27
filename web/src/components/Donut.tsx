// Donut chart, plain SVG.
//
// Slices are stroke-dasharray arcs on one circle: cheap to draw, no layout
// thrash, and it scales to any size without a canvas resize handler. Chart.js
// would do the same job at ~70 KB, which is not worth it for one ring.

import type { UsageRow } from '../../../shared/api.js'
import { formatPercent, formatSize } from '../lib/format.js'

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
]

/** Slices beyond this are merged into one "others" wedge to keep the ring readable. */
const MAX_SLICES = 6

interface Props {
  rows: UsageRow[]
  size?: number
  /**
   * Called when a slice is clicked, with the team name — or null when the
   * already-selected slice is clicked again, which clears the filter.
   */
  onSelect?: (name: string | null) => void
  /** Currently filtered team, drawn as the highlighted slice. */
  selected?: string | null
}

interface Slice {
  name: string
  used: number
  color: string
  /** False for the synthetic "others" wedge, which has no single team behind it. */
  real: boolean
}

function buildSlices(rows: UsageRow[]): Slice[] {
  const sorted = [...rows].filter((r) => r.used > 0).sort((a, b) => b.used - a.used)
  if (sorted.length <= MAX_SLICES) {
    return sorted.map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] as string, real: true }))
  }

  const head = sorted.slice(0, MAX_SLICES - 1)
  const tail = sorted.slice(MAX_SLICES - 1)
  const rest = tail.reduce((sum, r) => sum + r.used, 0)
  return [
    ...head.map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] as string, real: true })),
    { name: `${tail.length} others`, used: rest, color: 'var(--text-faint)', real: false },
  ]
}

export function Donut({ rows, size = 148, onSelect, selected }: Props): JSX.Element {
  const slices = buildSlices(rows)
  const total = slices.reduce((sum, s) => sum + s.used, 0)

  if (total === 0) {
    return <p className="empty">No usage recorded.</p>
  }

  const stroke = 20
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="donut">
      <svg
        className="donut__svg"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Usage split across ${slices.length} groups, total ${formatSize(total)}`}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((s) => {
            const length = (s.used / total) * circumference
            const dash = `${length} ${circumference - length}`
            // The synthetic "others" wedge is an aggregate, so it has no single
            // team to filter by.
            const clickable = onSelect !== undefined && s.real
            const el = (
              <circle
                key={s.name}
                className={`donut__slice${clickable ? ' donut__slice--click' : ''}${
                  selected === s.name ? ' donut__slice--on' : ''
                }`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={selected === s.name ? stroke + 4 : stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                onClick={
                  clickable
                    ? () => onSelect(selected === s.name ? null : s.name)
                    : undefined
                }
              >
                <title>
                  {`${s.name}: ${formatSize(s.used)} (${formatPercent(s.used, total)})${
                    clickable ? '\nClick to filter users by this team' : ''
                  }`}
                </title>
              </circle>
            )
            offset += length
            return el
          })}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          fill="var(--text)"
          fontSize="15"
          fontFamily="var(--font-mono)"
          fontWeight="600"
        >
          {formatSize(total)}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 12}
          textAnchor="middle"
          fill="var(--text-faint)"
          fontSize="9"
          letterSpacing="0.08em"
        >
          TOTAL
        </text>
      </svg>

      <ul className="legend">
        {slices.map((s) => {
          const clickable = onSelect !== undefined && s.real
          const body = (
            <>
              <span className="legend__swatch" style={{ background: s.color }} />
              <span className="legend__name">{s.name}</span>
              <span className="legend__value">{formatPercent(s.used, total)}</span>
            </>
          )
          return (
            <li key={s.name}>
              {/* Clicking a legend row does the same as clicking its slice —
                  thin slices are hard to hit precisely. */}
              {clickable ? (
                <button
                  type="button"
                  className={`legend__item legend__item--click${
                    selected === s.name ? ' legend__item--on' : ''
                  }`}
                  onClick={() => onSelect(selected === s.name ? null : s.name)}
                  aria-pressed={selected === s.name}
                >
                  {body}
                </button>
              ) : (
                <span className="legend__item">{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
