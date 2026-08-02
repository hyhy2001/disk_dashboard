// History tab: how usage moved over the scans on record.
//
// Two things are being answered and they need different charts. "Is the disk
// filling up" is the whole-target timeline, which the Overview already shows, so
// here it is the user breakdown that leads: which accounts grew, and by how much.
//
// The range picker filters which snapshots are in view. Filtering client-side is
// deliberate — the whole series is one row per scan per user, already in memory, so
// a round trip per range change would add latency for no benefit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HistorySeries } from '../../../shared/api.js'
import { fetchHistory } from '../lib/api.js'
import { formatCount, formatSize } from '../lib/format.js'
import { loadFilters, saveFilters, KEYS } from '../lib/prefs.js'
import { TrendChart } from '../components/TrendChart.js'

interface Props {
  target: string
}

/** Preset windows, matching legacy's buttons. 0 means every snapshot. */
const PRESETS: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 0 },
]

/** Most series the chart can distinguish; the palette has 12 colours. */
const MAX_SELECTED = 12

/** duscan stores dates as yyyymmdd; compare them as dates, not integers. */
function toDate(yyyymmdd: number): Date {
  const s = String(yyyymmdd)
  return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)))
}

/** yyyy-mm-dd from an <input type="date"> to the yyyymmdd integer form. */
function fromInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return Number(`${m[1]}${m[2]}${m[3]}`)
}

export function HistoryTab({ target }: Props): JSX.Element {
  const [series, setSeries] = useState<HistorySeries | null>(null)
  const [error, setError] = useState<string | null>(null)

  const saved = loadFilters()
  const [rangeDays, setRangeDays] = useState(saved.rangeDays)
  const [dateStart, setDateStart] = useState(saved.dateStart)
  const [dateEnd, setDateEnd] = useState(saved.dateEnd)
  const [selected, setSelected] = useState<string[]>(saved.selectedUsers)
  const [logScale, setLogScale] = useState(saved.logScale)
  const [userQuery, setUserQuery] = useState('')
  const seededRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    fetchHistory(target, controller.signal)
      .then(setSeries)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setSeries(null)
      })
    return () => controller.abort()
  }, [target])

  // Persist so a reload lands on the same window and selection.
  useEffect(() => {
    saveFilters({ rangeDays, dateStart, dateEnd, selectedUsers: selected, logScale })
  }, [rangeDays, dateStart, dateEnd, selected, logScale])

  /** Snapshot dates inside the active window, oldest first. */
  const dates = useMemo(() => {
    if (!series) return []
    const all = series.snapshots.map((s) => s.date)

    const from = fromInput(dateStart)
    const to = fromInput(dateEnd)
    if (from !== null || to !== null) {
      // An explicit range wins over the preset: the user typed it.
      return all.filter((d) => (from === null || d >= from) && (to === null || d <= to))
    }
    if (rangeDays <= 0) return all

    const newest = all[all.length - 1]
    if (newest === undefined) return all
    const cutoff = toDate(newest)
    cutoff.setDate(cutoff.getDate() - rangeDays)
    return all.filter((d) => toDate(d) >= cutoff)
  }, [series, rangeDays, dateStart, dateEnd])

  const dateSet = useMemo(() => new Set(dates), [dates])

  /** Users ranked by growth across the window — the tab's actual question. */
  const ranked = useMemo(() => {
    if (!series) return []
    return series.users
      .map((u) => {
        const inWindow = u.points.filter((p) => dateSet.has(p.date))
        const first = inWindow[0]?.used ?? 0
        const last = inWindow[inWindow.length - 1]?.used ?? 0
        return { name: u.name, current: last, delta: last - first }
      })
      .sort((a, b) => b.current - a.current)
  }, [series, dateSet])

  // Seed the selection once on very first data load. Skip if user has saved prefs
  // (even empty — they explicitly cleared), so a reload respects their choice.
  useEffect(() => {
    if (seededRef.current) return
    if (!series) return
    seededRef.current = true
    const hasSaved = localStorage.getItem(KEYS.filters) !== null
    if (hasSaved) return
    const top = ranked.slice(0, 3).map((r) => r.name)
    if (top.length > 0) setSelected(top)
  }, [series, ranked])

  const toggle = useCallback((name: string) => {
    setSelected((cur) => {
      if (cur.includes(name)) return cur.filter((n) => n !== name)
      // Silently dropping the oldest would be surprising; refusing is clearer, and
      // the count beside the header says why.
      if (cur.length >= MAX_SELECTED) return cur
      return [...cur, name]
    })
  }, [])

  const shownUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    if (!q) return ranked
    return ranked.filter((r) => r.name.toLowerCase().includes(q))
  }, [ranked, userQuery])

  /** Trends for the selected users, trimmed to the window. */
  const trends = useMemo(() => {
    if (!series) return []
    return selected
      .map((name) => series.users.find((u) => u.name === name))
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map((u) => ({ name: u.name, points: u.points.filter((p) => dateSet.has(p.date)) }))
  }, [series, selected, dateSet])

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">Could not load history</p>
        <p>{error}</p>
      </div>
    )
  }

  if (!series) {
    return (
      <>
        <div className="flex items-center gap-2 border-b border-border/30 bg-surface/30 px-3 py-2 shrink-0">
          <div className="h-7 w-[208px] rounded-sm bg-muted/60 animate-pulse" />
          <div className="h-7 w-[240px] rounded-sm bg-muted/60 animate-pulse" />
          <div className="h-4 w-16 rounded-sm bg-muted/60 animate-pulse" />
        </div>
        <div className="flex-1 min-h-0 w-full rounded-lg border border-border/50 bg-surface/50 animate-pulse" />
      </>
    )
  }

  if (series.snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">No history yet</p>
        <p>History appears once this target has been scanned at least twice.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/30 bg-surface/30 px-3 py-2 shrink-0">
        <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label="Time range">
          {PRESETS.map((p) => (
            <button
              type="button"
              className={`px-2 py-1 text-[13px] font-medium transition-colors ${rangeDays === p.days && dateStart === '' && dateEnd === '' ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'}`}
              key={p.label}
              aria-pressed={rangeDays === p.days && dateStart === '' && dateEnd === ''}
              onClick={() => {
                setRangeDays(p.days)
                setDateStart('')
                setDateEnd('')
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <input
            type="date"
            className="h-7 rounded-sm border border-border bg-transparent px-2 text-[13px] w-28"
            aria-label="Range start"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
          />
          <span aria-hidden="true">→</span>
          <input
            type="date"
            className="h-7 rounded-sm border border-border bg-transparent px-2 text-[13px] w-28"
            aria-label="Range end"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
        </div>

        <span className="text-[12px] text-muted-foreground tabular-nums">
          {formatCount(dates.length)} of {formatCount(series.snapshots.length)} scans
        </span>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 h-full overflow-y-auto lg:overflow-hidden relative">
        <aside className="lg:w-56 lg:shrink-0 lg:min-h-0 lg:border-r lg:border-border border-b lg:border-b-0 border-border/40 bg-surface/30 flex flex-col">
          <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2 shrink-0">
            <h2 className="text-sm font-semibold flex-1">Users</h2>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[12px] font-semibold text-amber-400 tabular-nums">
              {selected.length} / {MAX_SELECTED}
            </span>
          </header>

          <input
            type="search"
            className="h-7 w-full rounded-sm border border-border bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search user…"
            aria-label="Search users"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />

          <ul className="overflow-auto max-h-[200px] lg:max-h-none lg:min-h-0 space-y-0.5 lg:space-y-1 lg:flex-1">
            {shownUsers.length === 0 && (
              <li className="text-xs text-muted-foreground p-4 text-center">No user matches.</li>
            )}
            {shownUsers.map((r) => {
              const on = selected.includes(r.name)
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    className={`flex items-center gap-1 w-full px-2 py-1 text-[13px] rounded-sm transition-colors text-left border ${
                      on
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-400'
                        : 'border-transparent hover:border-border/60 hover:bg-muted/50 text-muted-foreground hover:text-foreground'
                    }`}
                    aria-pressed={on}
                    onClick={() => toggle(r.name)}
                    disabled={!on && selected.length >= MAX_SELECTED}
                    data-tooltip={`${formatSize(r.current)} now · ${r.delta >= 0 ? '+' : ''}${formatSize(Math.abs(r.delta))} over the window`}
                  >
                    <span className="w-4 text-[12px] shrink-0 flex items-center justify-center" aria-hidden="true">
                      {on ? (
                        <span className="flex size-3 items-center justify-center rounded-[3px] bg-amber-500 text-[10px] font-bold text-black">
                          ✓
                        </span>
                      ) : (
                        <span className="size-3 rounded-[3px] border border-border/60" />
                      )}
                    </span>
                    <span className="flex-1 truncate">{r.name}</span>
                    <span
                      className={`tabular-nums text-[12px] ${
                        r.delta > 0 ? 'text-rose-400' : r.delta < 0 ? 'text-emerald-400' : 'text-muted-foreground'
                      }`}
                    >
                      {r.delta === 0 ? '—' : `${r.delta > 0 ? '+' : '−'}${formatSize(Math.abs(r.delta))}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="flex gap-1 pt-1.5">
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center rounded-sm border border-border bg-transparent px-2 py-1.5 text-[13px] hover:bg-muted transition-colors"
              onClick={() => setSelected(ranked.slice(0, MAX_SELECTED).map((r) => r.name))}
            >
              Top {MAX_SELECTED}
            </button>
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center rounded-sm border border-border bg-transparent px-2 py-1.5 text-[13px] hover:bg-muted transition-colors"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
          </div>
        </aside>

        <section className="flex flex-1 flex-col min-w-0 min-h-[300px] lg:min-h-0">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
            <h2 className="text-sm font-semibold flex-1">Usage over time</h2>
            <button
              type="button"
              className="inline-flex items-center rounded-sm border border-border bg-transparent px-2 py-1 text-[12px] hover:bg-muted transition-colors"
              aria-pressed={logScale}
              onClick={() => setLogScale((v) => !v)}
              data-tooltip="Log scale keeps small accounts readable beside large ones"
            >
              {logScale ? 'Log' : 'Linear'}
            </button>
          </header>

          <div className="p-3 flex-1 min-h-[200px] flex flex-col">
            <TrendChart trends={trends} dates={dates} logScale={logScale} />
          </div>
        </section>
      </div>
    </>
  )
}
