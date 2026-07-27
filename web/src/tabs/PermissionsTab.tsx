// Permission Issues tab: paths the scan could not read.
//
// The important state to get right is the empty one. A scan run as root produces
// zero rows, which is the healthy outcome, not a failure — so "no issues found"
// has to read as good news and be clearly distinct from "this report predates the
// feature" and from "the request failed".
//
// Unreadable paths matter because they are exactly the bytes the Overview reports
// as unattributed: used minus scanned. This tab is where that gap gets a name.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PermPage } from '../../../shared/api.js'
import { fetchPermissions } from '../lib/api.js'
import { copyPath } from '../lib/clipboard.js'
import { exportPermissions } from '../lib/exports.js'
import { formatCount } from '../lib/format.js'
import { NumberPager } from '../components/Pager.js'
import { useFitRows } from '../lib/useFitRows.js'

interface Props {
  target: string
}

/**
 * One row's height plus its 1px gap, measured in the browser (27 + 1).
 *
 * The page size is derived from the measured list height rather than fixed at
 * legacy's 100: this dashboard holds one screen, and 100 rows is ~2800px of it.
 */
const ROW_HEIGHT = 28

/** The sentinel the server uses for issues with no owning user. */
const UNKNOWN = '__unknown__'

const TYPES: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Files', value: 'file' },
  { label: 'Directories', value: 'directory' },
]

export function PermissionsTab({ target }: Props): JSX.Element {
  const [data, setData] = useState<PermPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [page, setPage] = useState(1)
  const [itemType, setItemType] = useState('')
  const [pathQuery, setPathQuery] = useState('')
  /** Debounced copy of pathQuery — the request follows this, not the keystrokes. */
  const [pathApplied, setPathApplied] = useState('')
  const [users, setUsers] = useState<string[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // Page size follows the measured list height, so a page always fits on screen.
  /*
   * reserve covers what sits *below* the list inside the panel: the pager (35px) and
   * the panel's bottom padding. The measurement runs from the list's top edge to the
   * bottom of the scroll host, so anything underneath has to be subtracted or the
   * page comes back one screenful too tall.
   */
  const fit = useFitRows({ rowHeight: ROW_HEIGHT, min: 8, max: 100, reserve: 64 })
  const pageSize = fit.rows

  // Typing a path filter fires a COUNT plus a page query, so it waits for a pause.
  useEffect(() => {
    const id = setTimeout(() => setPathApplied(pathQuery), 350)
    return () => clearTimeout(id)
  }, [pathQuery])

  // Any filter change invalidates the page number: page 7 of an unfiltered list is
  // usually past the end of a filtered one. A resize does too — page 7 of 12-row
  // pages is a different offset from page 7 of 30-row pages.
  useEffect(() => {
    setPage(1)
  }, [itemType, pathApplied, users, pageSize])

  useEffect(() => {
    // Wait for the measurement so the first request already asks for the right size.
    if (!fit.measured) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetchPermissions(
      target,
      {
        offset: (page - 1) * pageSize,
        limit: pageSize,
        ...(users.length > 0 ? { users: users.join(',') } : {}),
        ...(itemType ? { itemType } : {}),
        ...(pathApplied ? { path: pathApplied } : {}),
      },
      controller.signal,
    )
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setData(null)
        setLoading(false)
      })

    return () => controller.abort()
  }, [target, page, users, itemType, pathApplied, pageSize, fit.measured])

  const toggleUser = useCallback((name: string) => {
    setUsers((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]))
  }, [])

  const runExport = useCallback(
    (scope: 'filtered' | 'all') => {
      setExporting(true)
      exportPermissions(
        target,
        {
          ...(users.length > 0 ? { users: users.join(',') } : {}),
          ...(itemType ? { itemType } : {}),
          ...(pathApplied ? { path: pathApplied } : {}),
        },
        scope,
      ).finally(() => setExporting(false))
    },
    [target, users, itemType, pathApplied],
  )

  const shownUsers = useMemo(() => {
    if (!data) return []
    const q = userQuery.trim().toLowerCase()
    if (!q) return data.userCounts
    return data.userCounts.filter((u) => u.name.toLowerCase().includes(q))
  }, [data, userQuery])

  /**
   * Pre-list states share one wrapper carrying the measuring ref.
   *
   * They cannot be early returns: the first fetch waits on the measurement, and a
   * measurement needs a mounted box, so returning a bare skeleton would deadlock.
   */
  if (error || !data || data.userCounts.length === 0) {
    return (
      <div className="perm__body" ref={fit.ref}>
        {error ? (
          <div className="state state--error">
            <p className="state__title">Could not load permission issues</p>
            <p>{error}</p>
          </div>
        ) : !data ? (
          <div className="skeleton" />
        ) : (
          // No rows anywhere in the report, filters aside: the healthy case.
          <div className="state">
            <p className="state__title">No permission issues</p>
            <p>
              The scan read every path it visited. Nothing on this target was skipped for
              permissions.
            </p>
          </div>
        )}
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(data.total / pageSize))
  const totalIssues = data.userCounts.reduce((sum, u) => sum + u.count, 0)
  const namedUsers = data.userCounts.filter((u) => u.name !== UNKNOWN)

  return (
    <>
      <div className="perm__summary panel">
        <div className="perm__stat">
          <span className="perm__stat-num">{formatCount(totalIssues)}</span>
          <span className="perm__stat-label">Unreadable paths</span>
        </div>
        <div className="perm__stat">
          <span className="perm__stat-num">{formatCount(namedUsers.length)}</span>
          <span className="perm__stat-label">Users affected</span>
        </div>
        <div className="perm__stat">
          <span className="perm__stat-num">
            {formatCount(data.userCounts.find((u) => u.name === UNKNOWN)?.count ?? 0)}
          </span>
          <span className="perm__stat-label">No owning user</span>
        </div>

        <div className="perm__spacer" />

        <button
          type="button"
          className="btn"
          onClick={() => runExport('filtered')}
          disabled={exporting}
          data-tooltip="Download the current filtered list as CSV"
        >
          Export filtered
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => runExport('all')}
          disabled={exporting}
          data-tooltip="Download every issue in this report as CSV"
        >
          Export all
        </button>
      </div>

      {data.errorCounts.length > 0 && (
        <div className="perm__errors panel">
          {data.errorCounts.slice(0, 6).map((e) => (
            <span className="chip" key={e.error}>
              {e.error} <strong>{formatCount(e.count)}</strong>
            </span>
          ))}
        </div>
      )}

      <div className="perm__main">
        <button
          type="button"
          className="filter-badge"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Filters{users.length > 0 || itemType || pathApplied ? ' •' : ''}
        </button>

        <aside className={`perm__filters panel${filtersOpen ? ' perm__filters--open' : ''}`}>
          <div className="perm__types" role="group" aria-label="Item type">
            {TYPES.map((t) => (
              <button
                type="button"
                className="perm__type"
                key={t.value}
                aria-pressed={itemType === t.value}
                onClick={() => setItemType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <input
            type="search"
            className="sidebar__search"
            placeholder="Filter by path…"
            aria-label="Filter by path"
            value={pathQuery}
            onChange={(e) => setPathQuery(e.target.value)}
          />

          <header className="panel__head">
            <h2 className="panel__title">Users</h2>
            <span className="panel__note">
              {users.length === 0 ? 'all' : `${users.length} selected`}
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
            {shownUsers.map((u) => {
              const on = users.includes(u.name)
              return (
                <li key={u.name}>
                  <button
                    type="button"
                    className={`hist__chip${on ? ' hist__chip--on' : ''}${u.name === UNKNOWN ? ' hist__chip--dim' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleUser(u.name)}
                  >
                    <span className="hist__mark" aria-hidden="true">
                      {on ? '✓' : ''}
                    </span>
                    <span className="hist__name">
                      {u.name === UNKNOWN ? 'no owning user' : u.name}
                    </span>
                    <span className="hist__delta">{formatCount(u.count)}</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hist__actions">
            <button type="button" className="btn" onClick={() => setUsers([])}>
              Clear
            </button>
          </div>
        </aside>

        <section className={`panel perm__list${loading ? ' panel--loading' : ''}`}>
          <header className="panel__head">
            <h2 className="panel__title">Issues</h2>
            <span className="panel__note">
              {formatCount(data.total)} matching · page {page} of {formatCount(pageCount)}
            </span>
          </header>

          {/* The measured box: whatever height the flex layout leaves it decides how
              many rows the next request asks for. Wraps the empty state too, so a
              filter matching nothing does not lose the measurement. */}
          <div className="perm__body" ref={fit.ref}>
            {data.rows.length === 0 ? (
              <p className="empty">No issue matches the current filters.</p>
            ) : (
              <ul className="perm__rows">
              {data.rows.map((r, i) => (
                <li className="perm__row" key={`${r.path}-${i}`}>
                  <span
                    className={`perm__kind perm__kind--${r.itemType === 'directory' ? 'dir' : 'file'}`}
                    aria-hidden="true"
                  >
                    {r.itemType === 'directory' ? '▣' : '▤'}
                  </span>
                  <span className={`chip chip--sm${r.user === UNKNOWN ? ' chip--dim' : ''}`}>
                    {r.user === UNKNOWN ? 'unknown' : r.user}
                  </span>
                  <button
                    type="button"
                    className="ud__path"
                    onClick={() => void copyPath(r.path)}
                    data-tooltip={`${r.path} — click to copy`}
                  >
                    {r.path}
                  </button>
                  <span className="perm__err">{r.error}</span>
                </li>
              ))}
              </ul>
            )}
          </div>

          <NumberPager page={page} pageCount={pageCount} onGo={setPage} busy={loading} />
        </section>
      </div>
    </>
  )
}
