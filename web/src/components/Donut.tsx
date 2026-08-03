// Donut chart, plain SVG.
//
// Slices are stroke-dasharray arcs on one circle: cheap to draw, no layout
// thrash, and it scales to any size without a canvas resize handler. Chart.js
// would do the same job at ~70 KB, which is not worth it for one ring.

import type { UsageRow } from '../../../shared/api.js'
import { formatPercent, formatSize } from '../lib/format.js'

// Legacy's palette, in its order: sky, emerald, amber, rose, violet, slate,
// cyan, light violet. Adjacent slices stay distinguishable.
const SERIES = [
  'var(--sky-400)',
  'var(--emerald-500)',
  'var(--amber-400)',
  'var(--rose-400)',
  '#8b5cf6',
  'var(--text-faint)',
  '#06b6d4',
  'var(--violet-400)',
]

/** Colour of the synthetic "Unknown" wedge — legacy's slate #334155. */
const UNKNOWN_COLOR = '#334155'

/**
 * "Other" is real, attributable usage, so it gets a live palette colour rather
 * than Unknown's dead slate — and one distinct from the "N others" merge wedge,
 * which means something different again.
 */
const OTHER_COLOR = '#64748b'

/** Slice names the client treats specially rather than as a team. */
export const OTHER_SLICE = 'Other'
export const UNKNOWN_SLICE = 'Unknown'

/** Slices beyond this are merged into one "others" wedge to keep the ring readable. */
const MAX_SLICES = 8

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
  /**
   * Total used bytes on the filesystem. Anything beyond the sum of the team rows
   * and `otherUsed` becomes an "Unknown" slice, as legacy did — without it the
   * ring silently rescales and every team looks like a larger share than it is.
   */
  totalUsed?: number
  /**
   * Bytes belonging to scanned users with no team mapping, shown as a separate
   * "Other" slice.
   *
   * Legacy keeps this distinct from "Unknown" on purpose: Other is real,
   * attributable usage whose owners are known but ungrouped, so clicking it lists
   * those users. Unknown is space the scan never walked, so there is nobody to
   * list. Folding one into the other overstates whichever absorbs it.
   */
  otherUsed?: number
}

interface Slice {
  name: string
  used: number
  color: string
  /**
   * Whether clicking this slice can filter the user chart. True for teams and for
   * "Other" (which maps to the unmapped users); false for the "N others" merge
   * wedge and for "Unknown", neither of which has a user list behind it.
   */
  selectable: boolean
}

function buildSlices(rows: UsageRow[], totalUsed?: number, otherUsed?: number): Slice[] {
  const sorted = [...rows].filter((r) => r.used > 0).sort((a, b) => b.used - a.used)

  let out: Slice[]
  if (sorted.length <= MAX_SLICES) {
    out = sorted.map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] as string, selectable: true }))
  } else {
    const head = sorted.slice(0, MAX_SLICES - 1)
    const tail = sorted.slice(MAX_SLICES - 1)
    const rest = tail.reduce((sum, r) => sum + r.used, 0)
    out = [
      ...head.map((r, i) => ({ ...r, color: SERIES[i % SERIES.length] as string, selectable: true })),
      { name: `${tail.length} others`, used: rest, color: 'var(--text-faint)', selectable: false },
    ]
  }

  const teamTotal = sorted.reduce((sum, r) => sum + r.used, 0)

  // Scanned users with no team. Real usage with known owners, so it is its own
  // slice and stays clickable.
  if (otherUsed !== undefined && otherUsed > 0) {
    // Clickable: it has a concrete user list behind it, unlike Unknown.
    out.push({ name: OTHER_SLICE, used: otherUsed, color: OTHER_COLOR, selectable: true })
  }

  // Whatever `used` is left after teams and Other: space the scan never walked.
  // Shown so the ring totals the disk's real usage rather than just the walked
  // part.
  if (totalUsed !== undefined) {
    const unknown = totalUsed - teamTotal - (otherUsed ?? 0)
    if (unknown > 0) {
      out.push({ name: UNKNOWN_SLICE, used: unknown, color: UNKNOWN_COLOR, selectable: false })
    }
  }

  return out
}

export function Donut({ rows, size = 148, onSelect, selected, totalUsed, otherUsed }: Props): JSX.Element {
  const slices = buildSlices(rows, totalUsed, otherUsed)
  const total = slices.reduce((sum, s) => sum + s.used, 0)

  if (total === 0) {
    return <p className="empty">No usage recorded.</p>
  }

  // Legacy uses cutout 72%, i.e. the ring occupies 14% of the diameter per side.
  const stroke = size * 0.14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div className="donut">
      <svg
        className="donut__svg"
        style={{ width: size, maxWidth: '100%', maxHeight: size }}
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
            const clickable = onSelect !== undefined && s.selectable
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
                onClick={clickable ? () => onSelect(selected === s.name ? null : s.name) : undefined}
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
        {/* Legacy's two-line centre: bold 22px figure, 12px caption. Sizes are in
            viewBox units and `size` is the viewBox, so they scale with the ring
            and stay proportionate at any rendered size. */}
        <text className="donut__total" x={size / 2} y={size / 2 - 5} textAnchor="middle" fontSize={size * 0.15}>
          {formatSize(total)}
        </text>
        <text className="donut__caption" x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={size * 0.082}>
          used
        </text>
      </svg>

      <ul className="legend">
        {slices.map((s) => {
          const clickable = onSelect !== undefined && s.selectable
          const body = (
            <>
              <span className="legend__swatch" style={{ background: s.color }} />
              <span className="legend__label">
                <span className="legend__name">{s.name}</span>
                <span className="legend__value">{formatPercent(s.used, total)}</span>
              </span>
            </>
          )
          return (
            <li key={s.name}>
              {/* Clicking a legend row does the same as clicking its slice —
                  thin slices are hard to hit precisely. */}
              {clickable ? (
                <button
                  type="button"
                  className={`legend__item legend__item--click${selected === s.name ? ' legend__item--on' : ''}`}
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
