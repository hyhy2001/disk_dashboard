// History tab: how usage moved over the scans on record.
//
// Two things are being answered and they need different charts. "Is the disk
// filling up" is the whole-target timeline, which the Overview already shows, so
// here it is the user breakdown that leads: which accounts grew, and by how much.
//
// The range picker filters which snapshots are in view. Filtering client-side is
// deliberate — the whole series is one row per scan per user, already in memory, so
// a round trip per range change would add latency for no benefit.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HistorySeries } from '../../../shared/api.js'
import { fetchHistory } from '../lib/api.js'
import { formatCount, formatSize } from '../lib/format.js'
import { loadFilters, saveFilters } from '../lib/prefs.js'
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
  return new Date(
    Number(s.slice(0, 4)),
    Number(s.slice(4, 6)) - 1,
    Number(s.slice(6, 8)),
  )
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
  const [filtersOpen, setFiltersOpen] = useState(false)

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

  // Seed the selection once data arrives, so the chart is never empty on arrival.
  useEffect(() => {
    if (!series || selected.length > 0) return
    const top = ranked.slice(0, 3).map((r) => r.name)
    if (top.length > 0) setSelected(top)
  }, [series, ranked, selected.length])

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
      <div className="state state--error">
        <p className="state__title">Could not load history</p>
        <p>{error}</p>
      </div>
    )
  }

  if (!series) {
    return <div className="skeleton" style={{ height: '420px' }} />
  }

  if (series.snapshots.length === 0) {
    return (
      <div className="state">
        <p className="state__title">No history yet</p>
        <p>History appears once this target has been scanned at least twice.</p>
      </div>
    )
  }

  return (
    <>
      <div className="hist__range panel">
        <div className="hist__presets" role="group" aria-label="Time range">
          {PRESETS.map((p) => (
            <button
              type="button"
              className="hist__preset"
              key={p.label}
              aria-pressed={rangeDays === p.days && dateStart === '' && dateEnd === ''}
              onClick={() => {
                setRangeDays(p.days)
                // A preset replaces an explicit range rather than combining with it.
                setDateStart('')
                setDateEnd('')
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="hist__dates">
          <input
            type="date"
            className="hist__date"
            aria-label="Range start"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
          />
          <span aria-hidden="true">→</span>
          <input
            type="date"
            className="hist__date"
            aria-label="Range end"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
          />
        </div>

        <span className="hist__count">
          {formatCount(dates.length)} of {formatCount(series.snapshots.length)} scans
        </span>
      </div>

      <div className="hist__main">
        <button
          type="button"
          className="filter-badge"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Users ({selected.length})
        </button>

        <aside className={`hist__users panel${filtersOpen ? ' hist__users--open' : ''}`}>
          <header className="panel__head">
            <h2 className="panel__title">Users</h2>
            <span className="panel__note">
              {selected.length} / {MAX_SELECTED}
            </span>
          </header>

          <input
            type="search"
            className="sidebar__search"
            placeholder="Search user…"
            aria-label="Search users"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
          />

          <ul className="hist__chips">
            {shownUsers.length === 0 && <li className="empty">No user matches.</li>}
            {shownUsers.map((r) => {
              const on = selected.includes(r.name)
              return (
                <li key={r.name}>
                  <button
                    type="button"
                    className={`hist__chip${on ? ' hist__chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(r.name)}
                    disabled={!on && selected.length >= MAX_SELECTED}
                    data-tooltip={`${formatSize(r.current)} now · ${r.delta >= 0 ? '+' : ''}${formatSize(Math.abs(r.delta))} over the window`}
                  >
                    <span className="hist__mark" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    <span className="hist__name">{r.name}</span>
                    {/* Growth is the signal, so it is shown even unselected. */}
                    <span
                      className={`hist__delta${r.delta > 0 ? ' hist__delta--up' : r.delta < 0 ? ' hist__delta--down' : ''}`}
                    >
                      {r.delta === 0
                        ? '—'
                        : `${r.delta > 0 ? '+' : '−'}${formatSize(Math.abs(r.delta))}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hist__actions">
            <button
              type="button"
              className="btn"
              onClick={() => setSelected(ranked.slice(0, MAX_SELECTED).map((r) => r.name))}
            >
              Top {MAX_SELECTED}
            </button>
            <button type="button" className="btn" onClick={() => setSelected([])}>
              Clear
            </button>
          </div>
        </aside>

        <section className="panel hist__chart">
          <header className="panel__head">
            <h2 className="panel__title">Usage over time</h2>
            <button
              type="button"
              className="btn btn--sm"
              aria-pressed={logScale}
              onClick={() => setLogScale((v) => !v)}
              data-tooltip="Log scale keeps small accounts readable beside large ones"
            >
              {logScale ? 'Log' : 'Linear'}
            </button>
          </header>

          <div className="canvas canvas--tall">
            <TrendChart trends={trends} dates={dates} logScale={logScale} />
          </div>
        </section>
      </div>
    </>
  )
}
