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
  onSelect: (slug: string) => void
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
  const rows = useMemo(() => [...targets].sort((a, b) => (usedPercent(b) ?? -1) - (usedPercent(a) ?? -1)), [targets])

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
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">No disks in {spaceName}</p>
        <p>Add targets to this space in teams.json, or scan one to make it appear.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border/30">
        {bands.map((b) => (
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] ${
              b.id === 'critical'
                ? 'bg-rose-500/10 text-rose-400'
                : b.id === 'warning'
                  ? 'bg-amber-500/10 text-amber-400'
                  : b.id === 'healthy'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-muted/50 text-muted-foreground'
            }`}
            key={b.id}
            data-tooltip={b.hint}
          >
            <span className="font-bold tabular-nums">{b.count}</span>
            <span>{b.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] bg-muted/50 text-muted-foreground">
          <span className="font-bold tabular-nums">{formatCount(targets.length)}</span>
          <span>Disks</span>
        </div>
      </div>

      <section className="m-3 rounded-lg border border-border bg-surface/50 shadow-sm">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
          <h2 className="text-sm font-semibold flex-1 min-w-0">{spaceName} — capacity by disk</h2>
          <span className="text-[12px] text-muted-foreground tabular-nums truncate hidden sm:inline">
            {formatSize(spaceUsed)} of {formatSize(spaceTotal)} used · {formatSize(spaceScanned)} attributed
          </span>
          <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label="Chart mode">
            {MODES.map((m) => (
              <button
                type="button"
                className={`px-2 py-1 text-[12px] font-medium transition-colors ${
                  mode === m.id
                    ? 'bg-muted text-foreground'
                    : 'bg-transparent text-muted-foreground hover:text-foreground'
                }`}
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

        <ul className="divide-y divide-border/30">
          {rows.map((t) => {
            const cap = t.capacity
            const pct = usedPercent(t)
            const scannedW = cap ? widthFor(t, cap.scanned) : 0
            const usedW = cap ? widthFor(t, cap.used) : 0
            const totalW = cap ? widthFor(t, cap.total) : 0

            return (
              <li
                className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors"
                key={t.name}
              >
                <button
                  type="button"
                  className="text-sm font-semibold truncate hover:text-emerald-400 transition-colors min-w-[100px]"
                  onClick={() => onSelect(t.slug)}
                >
                  {t.name}
                </button>

                <div className="flex-1 h-4 relative rounded-full overflow-hidden bg-muted/50 min-w-[80px]">
                  {cap ? (
                    <>
                      <span className="absolute inset-0 rounded-full border border-border/40" style={{}} />
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-border/30"
                        style={{ width: `${totalW}%` }}
                      />
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-amber-400/40"
                        style={{ width: `${usedW}%` }}
                        data-tooltip={`${formatSize(cap.used - cap.scanned)} used but not attributed to any user`}
                      />
                      <span
                        className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/60"
                        style={{ width: `${scannedW}%` }}
                        data-tooltip={`${formatSize(cap.scanned)} attributed by the scan`}
                      />
                    </>
                  ) : (
                    <span className="text-[12px] text-muted-foreground px-2 leading-4">capacity unknown</span>
                  )}
                </div>

                <span className="text-xs tabular-nums font-medium w-12 text-right">
                  {pct === null ? '—' : `${pct.toFixed(0)}%`}
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums w-32 text-right shrink-0">
                  {cap ? `${formatSize(cap.used)} / ${formatSize(cap.total)}` : formatSize(t.totalSize)}
                </span>
              </li>
            )
          })}
        </ul>

        {unknown > 0 && (
          <p className="text-[12px] text-muted-foreground px-4 py-2 border-t border-border/20">
            {unknown} disk{unknown === 1 ? '' : 's'} report no filesystem capacity and are shown without a bar.
          </p>
        )}

        <div className="flex items-center gap-3 px-4 py-2 border-t border-border/30 text-[12px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-emerald-500/60" /> Attributed to users
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-amber-400/40" /> Used, unattributed
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-border/30" /> Capacity
          </span>
        </div>
      </section>
    </>
  )
}
