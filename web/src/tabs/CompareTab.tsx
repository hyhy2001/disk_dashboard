// Space comparison: every disk in the selected space, side by side.
//
// Shown when a space is selected but no disk. Answers a question no single-disk view
// can: which of these is in trouble, and is the trouble real usage or unreadable
// data. Legacy showed this as a stacked bar with three chart modes; the modes exist
// because the disks in one space routinely differ by 100x in capacity.
//
//   absolute  — bytes on a shared axis. Honest, but a 2 TB disk beside a 20 GB one
//               makes the small one invisible.
//   log       — same bytes, log axis. Both readable, but the bar lengths no longer
//               compare linearly.
//   percent   — each disk normalised to its own capacity. Comparable fullness, at
//               the cost of hiding absolute scale.
//
// No mode is right for every question, so the choice is the user's and it persists.

import { useMemo, useState } from 'react'
import type { Target } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'
import { KEYS, readString, writeString } from '../lib/prefs.js'
import { usedPercent } from '../components/DiskColumn.js'

type Mode = 'absolute' | 'log' | 'percent'

const MODE_KEY = KEYS.compareMode

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'absolute', label: 'Bytes', hint: 'Shared linear axis — true scale' },
  { id: 'log', label: 'Log', hint: 'Shared log axis — small disks stay readable' },
  { id: 'percent', label: 'Percent', hint: 'Each disk against its own capacity' },
]

/** Health bands, on the same thresholds the disk cards use. */
const BANDS = [
  { id: 'critical', label: 'Critical', hint: '85% or more full', min: 85 },
  { id: 'warning', label: 'Warning', hint: '70–85% full', min: 70 },
  { id: 'healthy', label: 'Healthy', hint: 'Under 70% full', min: 0 },
] as const

interface Props {
  spaceName: string
  targets: Target[]
  onSelect: (name: string) => void
}

export function CompareTab({ spaceName, targets, onSelect }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = readString(MODE_KEY)
    return saved === 'log' || saved === 'percent' ? saved : 'absolute'
  })

  const setAndSave = (next: Mode): void => {
    setMode(next)
    writeString(MODE_KEY, next)
  }

  // Fullest first: the disk that needs attention leads.
  const rows = useMemo(
    () => [...targets].sort((a, b) => (usedPercent(b) ?? -1) - (usedPercent(a) ?? -1)),
    [targets],
  )

  const withCapacity = rows.filter((t) => t.capacity !== null)
  const unknown = rows.length - withCapacity.length

  /** Bar scale denominator: the largest capacity in the space. */
  const maxTotal = Math.max(...withCapacity.map((t) => t.capacity?.total ?? 0), 1)

  /**
   * Width for one segment, in percent of the bar track.
   *
   * Log mode scales the *cumulative* value rather than each segment, because
   * log(a) + log(b) is not log(a+b) — summing per-segment logs would make the
   * stacked bar longer than the total it represents.
   */
  const widthFor = (t: Target, upTo: number): number => {
    const cap = t.capacity
    if (!cap) return 0
    if (mode === 'percent') return cap.total > 0 ? (upTo / cap.total) * 100 : 0
    if (mode === 'absolute') return (upTo / maxTotal) * 100
    const lv = Math.log10(Math.max(1, upTo))
    const lmax = Math.log10(Math.max(10, maxTotal))
    return (lv / lmax) * 100
  }

  const bands = BANDS.map((band, i) => {
    const upper = i === 0 ? Infinity : (BANDS[i - 1]?.min ?? Infinity)
    const members = withCapacity.filter((t) => {
      const pct = usedPercent(t) ?? -1
      return pct >= band.min && pct < upper
    })
    return { ...band, count: members.length }
  })

  const spaceTotal = withCapacity.reduce((sum, t) => sum + (t.capacity?.total ?? 0), 0)
  const spaceUsed = withCapacity.reduce((sum, t) => sum + (t.capacity?.used ?? 0), 0)
  const spaceScanned = withCapacity.reduce((sum, t) => sum + (t.capacity?.scanned ?? 0), 0)

  if (targets.length === 0) {
    return (
      <div className="state">
        <p className="state__title">No disks in {spaceName}</p>
        <p>Add targets to this space in teams.json, or scan one to make it appear.</p>
      </div>
    )
  }

  return (
    <>
      <div className="cmp__bands">
        {bands.map((b) => (
          <div className={`cmp__band cmp__band--${b.id}`} key={b.id} data-tooltip={b.hint}>
            <span className="cmp__band-num">{b.count}</span>
            <span className="cmp__band-label">{b.label}</span>
          </div>
        ))}
        <div className="cmp__band cmp__band--total">
          <span className="cmp__band-num">{formatCount(targets.length)}</span>
          <span className="cmp__band-label">Disks</span>
        </div>
      </div>

      <section className="panel">
        <header className="panel__head">
          <h2 className="panel__title">{spaceName} — capacity by disk</h2>
          <span className="panel__note">
            {formatSize(spaceUsed)} of {formatSize(spaceTotal)} used ·{' '}
            {formatSize(spaceScanned)} attributed
          </span>
          <div className="cmp__modes" role="group" aria-label="Chart mode">
            {MODES.map((m) => (
              <button
                type="button"
                className="cmp__mode"
                key={m.id}
                aria-pressed={mode === m.id}
                onClick={() => setAndSave(m.id)}
                data-tooltip={m.hint}
              >
                {m.label}
              </button>
            ))}
          </div>
        </header>

        <ul className="cmp__rows">
          {rows.map((t) => {
            const cap = t.capacity
            const pct = usedPercent(t)
            const scannedW = cap ? widthFor(t, cap.scanned) : 0
            // Cumulative, then subtract: keeps the stack honest in log mode.
            const usedW = cap ? widthFor(t, cap.used) : 0
            const totalW = cap ? widthFor(t, cap.total) : 0

            return (
              <li className="cmp__row" key={t.name}>
                <button type="button" className="cmp__name" onClick={() => onSelect(t.name)}>
                  {t.name}
                </button>

                <div className="cmp__track">
                  {cap ? (
                    <>
                      {/* Capacity outline, so a small disk on a shared axis still
                          shows how much of *itself* is used. */}
                      <span className="cmp__cap" style={{ width: `${totalW}%` }} />
                      <span
                        className="cmp__seg cmp__seg--unscanned"
                        style={{ width: `${usedW}%` }}
                        data-tooltip={`${formatSize(cap.used - cap.scanned)} used but not attributed to any user`}
                      />
                      <span
                        className="cmp__seg cmp__seg--scanned"
                        style={{ width: `${scannedW}%` }}
                        data-tooltip={`${formatSize(cap.scanned)} attributed by the scan`}
                      />
                    </>
                  ) : (
                    <span className="cmp__unknown">capacity unknown</span>
                  )}
                </div>

                <span className="cmp__pct">{pct === null ? '—' : `${pct.toFixed(0)}%`}</span>
                <span className="cmp__size">
                  {cap ? `${formatSize(cap.used)} / ${formatSize(cap.total)}` : formatSize(t.totalSize)}
                </span>
              </li>
            )
          })}
        </ul>

        {unknown > 0 && (
          <p className="panel__note">
            {unknown} disk{unknown === 1 ? '' : 's'} report no filesystem capacity and are shown
            without a bar.
          </p>
        )}

        <div className="chart__legend">
          <span className="chart__key">
            <span className="legend__swatch legend__swatch--scanned" /> Attributed to users
          </span>
          <span className="chart__key">
            <span className="legend__swatch legend__swatch--unscanned" /> Used, unattributed
          </span>
          <span className="chart__key">
            <span className="legend__swatch legend__swatch--cap" /> Capacity
          </span>
        </div>
      </section>
    </>
  )
}
