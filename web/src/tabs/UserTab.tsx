// Detail User tab: one account's largest directories and largest files.
//
// The two lists page independently — a viewer hunting a big file should not lose
// their place in the directory list — so each keeps its own cursor stack. A stack
// rather than a single cursor because keyset pagination can only move forward:
// going back means replaying the cursor that produced the previous page.
//
// Filters are applied on submit, not per keystroke. Each apply is a query over a
// user's whole slice of detail_files, which is not something to fire on every
// character.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DetailUser, UserDetail } from '../../../shared/api.js'
import { fetchUserDetail, fetchUsers, type DetailQuery } from '../lib/api.js'
import { formatCount, formatPercent, formatSize } from '../lib/format.js'
import { copyPath } from '../lib/clipboard.js'
import { saveFilters } from '../lib/prefs.js'
import { useFitRows } from '../lib/useFitRows.js'
import { EMPTY_SIZE, SizeInput, toBytes, type SizeValue } from '../components/SizeInput.js'
import { StepPager } from '../components/Pager.js'
import { TagInput } from '../components/TagInput.js'
import { UserPicker } from '../components/UserPicker.js'
import { exportUserList } from '../lib/exports.js'

interface Props {
  target: string
  /** Restored from prefs so reopening the tab lands on the same account. */
  initialUser: string | null
}

/** Filter values as the form holds them, before conversion to a query. */
interface FormState {
  query: string
  ext: string
  min: SizeValue
  max: SizeValue
}

const EMPTY_FORM: FormState = { query: '', ext: '', min: EMPTY_SIZE, max: EMPTY_SIZE }

/** Turn the form into API params, omitting anything unset. */
function toQuery(form: FormState): DetailQuery {
  const min = toBytes(form.min)
  const max = toBytes(form.max)
  return {
    ...(form.query.trim() ? { query: form.query } : {}),
    ...(form.ext.trim() ? { ext: form.ext } : {}),
    ...(min !== undefined ? { minSize: min } : {}),
    ...(max !== undefined ? { maxSize: max } : {}),
  }
}

/** How many filter fields carry a value, for the badge on the Filters button. */
function activeCount(form: FormState): number {
  const q = toQuery(form)
  return Object.keys(q).length
}

/**
 * One row's height including its 1px gap, measured in the browser.
 *
 * Hardcoded rather than measured per-row: reading a rendered row's height to decide
 * how many rows to request is circular, and the row is a fixed single line by
 * design (paths are ellipsised, never wrapped).
 */
const ROW_HEIGHT = 26

/** Extension chip colours, keyed by the extensions that actually dominate scans. */
const EXT_CLASS: Record<string, string> = {
  log: 'ext--log',
  gz: 'ext--gz',
  zip: 'ext--gz',
  csv: 'ext--csv',
  json: 'ext--csv',
  txt: 'ext--txt',
  bin: 'ext--bin',
  so: 'ext--bin',
}

export function UserTab({ target, initialUser }: Props): JSX.Element {
  const [users, setUsers] = useState<DetailUser[]>([])
  const [user, setUser] = useState<string | null>(initialUser)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  // Draft is what the form shows; `applied` is what the request uses. Separating
  // them is what makes Apply mean something.
  const [draft, setDraft] = useState<FormState>(EMPTY_FORM)
  const [applied, setApplied] = useState<FormState>(EMPTY_FORM)

  // Cursor stacks. The last entry is the cursor for the page on screen; undefined
  // at the bottom of the stack means "first page".
  const [dirStack, setDirStack] = useState<(string | undefined)[]>([undefined])
  const [fileStack, setFileStack] = useState<(string | undefined)[]>([undefined])

  const [exporting, setExporting] = useState(false)

  // Users load per target. A user selected on the previous target may not exist
  // here, so the selection is validated against the new list rather than kept.
  useEffect(() => {
    let live = true
    fetchUsers(target)
      .then((list) => {
        if (!live) return
        setUsers(list)
        setUser((cur) => {
          if (cur && list.some((u) => u.name === cur)) return cur
          return list[0]?.name ?? null
        })
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      live = false
    }
  }, [target])

  /*
   * Page size follows the measured height, so a page always fits on screen. Both
   * cards are the same height, so one measurement drives both lists.
   *
   * The measurement runs from the measured box's top edge to the bottom of the
   * scroll host, so reserve has to cover everything between that top edge and the
   * rows (the card header, 43px) plus everything below them (the pager at 35px and
   * the card's bottom padding). Measured at 1920x1080: box top 317, host bottom
   * 1080, rows 360→1017 — so 96px of chrome.
   */
  const fit = useFitRows({ rowHeight: ROW_HEIGHT, min: 8, max: 60, reserve: 96 })

  // Reset paging whenever the identity of the query changes. Reusing a cursor
  // across a different user or filter would resume at a meaningless position.
  // The page size counts: a cursor from a 30-row page is meaningless on a 12-row one.
  useEffect(() => {
    setDirStack([undefined])
    setFileStack([undefined])
  }, [user, applied, fit.rows])

  const dirCursor = dirStack[dirStack.length - 1]
  const fileCursor = fileStack[fileStack.length - 1]

  useEffect(() => {
    if (!user) {
      setDetail(null)
      return
    }
    // Wait for the first measurement rather than fetching a provisional page and
    // immediately refetching at the real size.
    if (!fit.measured) return

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetchUserDetail(
      target,
      user,
      {
        ...toQuery(applied),
        limit: fit.rows,
        ...(dirCursor !== undefined ? { dirCursor } : {}),
        ...(fileCursor !== undefined ? { fileCursor } : {}),
      },
      controller.signal,
    )
      .then((data) => {
        setDetail(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        // An aborted request is the expected outcome of switching users quickly;
        // reporting it as an error would flash a failure on every fast click.
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
        setDetail(null)
        setLoading(false)
      })

    return () => controller.abort()
  }, [target, user, applied, dirCursor, fileCursor, fit.rows, fit.measured])

  // Remember the account so reopening the tab returns to it.
  useEffect(() => {
    if (user) saveFilters({ detailUser: user })
  }, [user])

  const apply = useCallback(() => {
    setApplied(draft)
    setShowFilters(false)
  }, [draft])

  const reset = useCallback(() => {
    setDraft(EMPTY_FORM)
    setApplied(EMPTY_FORM)
  }, [])

  const filterBadge = activeCount(applied)
  const selectedMeta = useMemo(() => users.find((u) => u.name === user), [users, user])

  const runExport = useCallback(
    (kind: 'dirs' | 'files') => {
      if (!user) return
      setExporting(true)
      // The picker already knows the user's unfiltered row count, so the progress
      // bar gets a denominator without a counting pass.
      const expected = kind === 'dirs' ? selectedMeta?.dirs : selectedMeta?.files
      exportUserList(target, user, kind, toQuery(applied), expected).finally(() =>
        setExporting(false),
      )
    },
    [target, user, applied, selectedMeta],
  )

  if (error) {
    return (
      <div className="state state--error">
        <p className="state__title">Could not load this user</p>
        <p>{error}</p>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="state">
        <p className="state__title">No per-user detail</p>
        <p>This report has no user breakdown. Run a scan with detail reporting enabled.</p>
      </div>
    )
  }

  return (
    <>
      <div className="ud__toolbar panel">
        <span className="ud__count">{formatCount(users.length)} users</span>

        <UserPicker users={users} selected={user} onSelect={setUser} />

        <TagInput
          id="ud-query"
          label=""
          placeholder="Search path (comma or tab)..."
          value={draft.query}
          onChange={(query) => setDraft((d) => ({ ...d, query }))}
          onSubmit={apply}
        />

        <button
          type="button"
          className="btn"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters
          {filterBadge > 0 && <span className="btn__badge">{filterBadge}</span>}
        </button>

        <div className="ud__spacer" />

        <button
          type="button"
          className="btn"
          onClick={() => runExport('dirs')}
          disabled={exporting || !user || detail?.dirsSuppressed}
          data-tooltip="Export the filtered directory list as CSV"
        >
          Export dirs
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => runExport('files')}
          disabled={exporting || !user}
          data-tooltip="Export the filtered file list as CSV"
        >
          Export files
        </button>
      </div>

      {showFilters && (
        <div className="ud__filters panel">
          <TagInput
            id="ud-ext"
            label="File extension"
            placeholder="e.g. csv, log"
            value={draft.ext}
            onChange={(ext) => setDraft((d) => ({ ...d, ext }))}
            onSubmit={apply}
          />
          <SizeInput
            id="ud-min"
            label="Minimum size"
            value={draft.min}
            onChange={(min) => setDraft((d) => ({ ...d, min }))}
            onSubmit={apply}
          />
          <SizeInput
            id="ud-max"
            label="Maximum size"
            value={draft.max}
            onChange={(max) => setDraft((d) => ({ ...d, max }))}
            onSubmit={apply}
          />
          <div className="ud__filter-actions">
            <button type="button" className="btn btn--primary" onClick={apply}>
              Apply
            </button>
            <button type="button" className="btn" onClick={reset}>
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Always mounted, and the box useFitRows measures. It has to exist before the
          first fetch, because the fetch waits on the measurement to know its page
          size — measuring the rendered list instead would deadlock. */}
      <div className="ud__body" ref={fit.ref}>
        {!user ? (
          <div className="state">
            <p className="state__title">Select a user</p>
            <p>Choose an account above to see its largest directories and files.</p>
          </div>
        ) : selectedMeta && !selectedMeta.hasDetail ? (
          <div className="state">
            <p className="state__title">{user}</p>
            <p>
              Total usage <strong>{formatSize(selectedMeta.used)}</strong>. This account has no
              per-directory breakdown in the report.
            </p>
          </div>
        ) : !detail ? (
          <div className="skeleton" />
        ) : (
          <div className={`ud__grid${loading ? ' ud__grid--loading' : ''}`}>
            <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Top directories</h2>
              <span className="panel__note">
                {formatSize(detail.userTotal)} total for {user}
              </span>
            </header>

            {detail.dirsSuppressed ? (
              <p className="empty">
                Directory sizes cover every extension, so they are hidden while an extension
                filter is active. Clear it to see them.
              </p>
            ) : detail.dirs.rows.length === 0 ? (
              <p className="empty">No directory matched the current filter.</p>
            ) : (
              <ul className="ud__list">
                {detail.dirs.rows.map((d) => {
                  const share = detail.userTotal > 0 ? d.used / detail.userTotal : 0
                  return (
                    <li className="ud__row" key={`${d.id}-${d.path}`}>
                      <button
                        type="button"
                        className="ud__path"
                        onClick={() => void copyPath(d.path)}
                        data-tooltip={`${d.path} — click to copy`}
                      >
                        {d.path}
                      </button>
                      <span className="ud__bar">
                        <span
                          className={`ud__fill ${share > 0.7 ? 'fill--hot' : share > 0.4 ? 'fill--warm' : 'fill--cool'}`}
                          style={{ width: `${Math.min(100, share * 100)}%` }}
                        />
                      </span>
                      <span className="ud__pct">
                        {formatPercent(d.used, detail.userTotal)}
                      </span>
                      <span className="ud__size">{formatSize(d.used)}</span>
                    </li>
                  )
                })}
              </ul>
            )}

            <StepPager
              page={dirStack.length}
              hasPrev={dirStack.length > 1}
              hasNext={detail.dirs.hasMore}
              busy={loading}
              onPrev={() => setDirStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
              onNext={() =>
                setDirStack((s) =>
                  detail.dirs.nextCursor !== null ? [...s, detail.dirs.nextCursor] : s,
                )
              }
            />
          </section>

          <section className="panel">
            <header className="panel__head">
              <h2 className="panel__title">Top files</h2>
              <span className="panel__note">
                {formatSize(detail.files.pageTotal)} on this page
              </span>
            </header>

            {detail.files.rows.length === 0 ? (
              <p className="empty">No file matched the current filter.</p>
            ) : (
              <ul className="ud__list">
                {detail.files.rows.map((f) => {
                  // Share of the page, not of the user: a page of files is what is
                  // on screen, and the user total would make every bar invisible.
                  const share =
                    detail.files.pageTotal > 0 ? f.size / detail.files.pageTotal : 0
                  return (
                    <li className="ud__row" key={f.path}>
                      <span className={`ext ${EXT_CLASS[f.ext.toLowerCase()] ?? 'ext--other'}`}>
                        {f.ext || '—'}
                      </span>
                      <button
                        type="button"
                        className="ud__path"
                        onClick={() => void copyPath(f.path)}
                        data-tooltip={`${f.path} — click to copy`}
                      >
                        {f.path}
                      </button>
                      <span className="ud__bar">
                        <span
                          className="ud__fill fill--cool"
                          style={{ width: `${Math.min(100, share * 100)}%` }}
                        />
                      </span>
                      <span className="ud__size">{formatSize(f.size)}</span>
                    </li>
                  )
                })}
              </ul>
            )}

            <StepPager
              page={fileStack.length}
              hasPrev={fileStack.length > 1}
              hasNext={detail.files.hasMore}
              busy={loading}
              onPrev={() => setFileStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
              onNext={() =>
                setFileStack((s) =>
                  detail.files.nextCursor !== null ? [...s, detail.files.nextCursor] : s,
                )
              }
            />
            </section>
          </div>
        )}
      </div>
    </>
  )
}
