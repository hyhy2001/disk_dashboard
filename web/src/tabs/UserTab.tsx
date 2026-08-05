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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

export function UserTab({ target, initialUser }: Props): JSX.Element {
  const [users, setUsers] = useState<DetailUser[]>([])
  const [user, setUser] = useState<string | null>(initialUser)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const filterRef = useRef<HTMLDivElement>(null)
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const filterPopRef = useRef<HTMLDivElement>(null)

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
      // The server streams the CSV; the filters applied on screen carry over.
      exportUserList(target, user, kind, toQuery(applied)).finally(() => setExporting(false))
    },
    [target, user, applied],
  )

  // Close filter dropdown when clicking outside.
  useEffect(() => {
    if (!showFilters) return
    const onDown = (e: MouseEvent): void => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilters(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showFilters])

  // Escape closes the popover and returns focus to the trigger, so a keyboard
  // user is never stranded inside it.
  useEffect(() => {
    if (!showFilters) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setShowFilters(false)
        filterBtnRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showFilters])

  // Move focus into the popover when it opens, so typing lands in the first field.
  useEffect(() => {
    if (!showFilters) return
    filterPopRef.current?.querySelector<HTMLElement>('input, button, select')?.focus()
  }, [showFilters])

  if (error) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">Could not load this user</p>
        <p>{error}</p>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm font-semibold">No per-user detail</p>
        <p>This report has no user breakdown. Run a scan with detail reporting enabled.</p>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border/30 bg-surface/30">
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">{formatCount(users.length)} users</span>

        <UserPicker users={users} selected={user} onSelect={setUser} />

        <TagInput
          id="ud-query"
          label=""
          placeholder="Search path (comma or tab)..."
          value={draft.query}
          onChange={(query) => setDraft((d) => ({ ...d, query }))}
          onSubmit={apply}
          className="flex-1 min-w-0"
        />

        <div className="relative" ref={filterRef}>
          <button
            type="button"
            ref={filterBtnRef}
            className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            aria-expanded={showFilters}
            aria-haspopup="dialog"
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters
            {filterBadge > 0 && (
              <span className="inline-flex items-center justify-center size-4 rounded-full bg-primary text-[11px] text-primary-foreground ml-1">
                {filterBadge}
              </span>
            )}
          </button>

          {showFilters && (
            <div
              ref={filterPopRef}
              className="absolute top-full left-0 mt-1 z-20 glass rounded-sm shadow-md p-3 space-y-3 w-64"
              role="dialog"
              aria-label="Filters"
              onMouseDown={(e) => e.stopPropagation()}
            >
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
              <button
                type="button"
                className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors w-full justify-center"
                onClick={reset}
              >
                Reset
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="inline-flex items-center rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-xs hover:opacity-90 transition-colors font-medium"
          onClick={apply}
          tabIndex={showFilters ? -1 : undefined}
        >
          Apply
        </button>

        <div className="flex-1 hidden md:block" />

        <button
          type="button"
          className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          onClick={() => runExport('dirs')}
          disabled={exporting || !user || detail?.dirsSuppressed}
          data-tooltip="Export the filtered directory list as CSV"
          tabIndex={showFilters ? -1 : undefined}
        >
          Export dirs
        </button>
        <button
          type="button"
          className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          onClick={() => runExport('files')}
          disabled={exporting || !user}
          data-tooltip="Export the filtered file list as CSV"
          tabIndex={showFilters ? -1 : undefined}
        >
          Export files
        </button>
      </div>

      {/* Always mounted, and the box useFitRows measures. It has to exist before the
          first fetch, because the fetch waits on the measurement to know its page
          size — measuring the rendered list instead would deadlock. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:overflow-hidden" ref={fit.ref}>
        {!user ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm font-semibold">Select a user</p>
            <p>Choose an account above to see its largest directories and files.</p>
          </div>
        ) : selectedMeta && !selectedMeta.hasDetail ? (
          <div className="flex items-center justify-center p-8">
            <p className="text-sm font-semibold">{user}</p>
            <p>
              Total usage <strong>{formatSize(selectedMeta.used)}</strong>. This account has no per-directory breakdown
              in the report.
            </p>
          </div>
        ) : !detail ? (
          <div className="flex-1 min-h-0 w-full rounded-lg border border-border/50 bg-surface/50 animate-pulse" />
        ) : (
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-3 h-full min-h-0 ${
              loading ? 'opacity-50 pointer-events-none' : ''
            }`}
          >
            <section className="rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col min-h-0 md:h-full">
              <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2 shrink-0">
                <h2 className="text-sm font-semibold flex-1">Top directories</h2>
                {/* userTotal is the account's whole footprint — it is the denominator
                    for the per-row bars and never reflects the filter. Saying "total
                    for <user>" beside a filtered count read as the size of the match,
                    so under a filter the wording names whose total it is instead.
                    When an extension filter suppresses the list there is no count to
                    show: falling back to the user list's dir tally would print a
                    number that ignores the filter and comes from a column that counts
                    contributed-to rather than owned directories. */}
                <span className="text-[12px] text-muted-foreground">
                  {detail.dirsSuppressed ? (
                    <>Hidden by the extension filter</>
                  ) : filterBadge > 0 ? (
                    <>
                      {formatCount(detail.dirs.total ?? 0)} dirs match · {user} owns {formatSize(detail.userTotal)} in
                      all
                    </>
                  ) : (
                    <>
                      {formatCount(detail.dirs.total ?? 0)} dirs, {formatSize(detail.userTotal)} total for {user}
                    </>
                  )}
                </span>
              </header>

              <div className="flex-1 min-h-0 overflow-auto">
                {detail.dirsSuppressed ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">
                    Directory sizes cover every extension, so they are hidden while an extension filter is active. Clear
                    it to see them.
                  </p>
                ) : detail.dirs.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">
                    No directory matched the current filter.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/30 text-sm">
                    {detail.dirs.rows.map((d) => {
                      const share = detail.userTotal > 0 ? d.used / detail.userTotal : 0
                      const barColor = share > 0.7 ? 'bg-rose-500' : share > 0.4 ? 'bg-amber-400' : 'bg-emerald-500'
                      return (
                        <li
                          className="flex items-center gap-2 px-3 py-2 min-h-[34px] hover:bg-white/[0.03] transition-colors"
                          key={`${d.id}-${d.path}`}
                        >
                          <span className="rounded-sm bg-muted/50 px-1.5 text-[13px] font-mono text-muted-foreground shrink-0 w-10 text-center truncate leading-tight">
                            ▸
                          </span>
                          <button
                            type="button"
                            className="flex-1 truncate text-left font-mono text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => void copyPath(d.path)}
                            data-tooltip={`${d.path} — click to copy`}
                          >
                            {d.path}
                          </button>
                          <span className="h-1.5 w-12 rounded-full bg-muted overflow-hidden shrink-0">
                            <span
                              className={`block h-full rounded-full ${barColor}`}
                              style={{ width: `${Math.min(100, share * 100)}%` }}
                            />
                          </span>
                          <span className="text-right tabular-nums text-[13px] text-muted-foreground w-12 shrink-0">
                            {formatPercent(d.used, detail.userTotal)}
                          </span>
                          <span className="text-right tabular-nums text-[13px] font-medium shrink-0 w-16">
                            {formatSize(d.used)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <StepPager
                page={dirStack.length}
                hasPrev={dirStack.length > 1}
                hasNext={detail.dirs.hasMore}
                busy={loading}
                onPrev={() => setDirStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
                onNext={() =>
                  setDirStack((s) => (detail.dirs.nextCursor !== null ? [...s, detail.dirs.nextCursor] : s))
                }
              />
            </section>

            <section className="rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col min-h-0 md:h-full">
              <header className="flex items-center gap-2 border-b border-border/40 px-3 py-2 shrink-0">
                <h2 className="text-sm font-semibold flex-1">Top files</h2>
                <span className="text-[12px] text-muted-foreground">
                  {formatCount(detail.files.total ?? 0)} files{filterBadge > 0 ? ' match' : ''},{' '}
                  {formatSize(detail.files.pageTotal)} on this page
                </span>
              </header>

              <div className="flex-1 min-h-0 overflow-auto">
                {detail.files.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4 text-center">No file matched the current filter.</p>
                ) : (
                  <ul className="divide-y divide-border/30 text-sm">
                    {detail.files.rows.map((f) => {
                      const share = detail.files.pageTotal > 0 ? f.size / detail.files.pageTotal : 0
                      return (
                        <li
                          className="flex items-center gap-2 px-3 py-2 min-h-[34px] hover:bg-white/[0.03] transition-colors"
                          key={f.path}
                        >
                          <span className="rounded-sm bg-muted/50 px-1.5 text-[13px] font-mono text-muted-foreground shrink-0 w-14 text-center truncate leading-tight">
                            {f.ext || '—'}
                          </span>
                          <button
                            type="button"
                            className="flex-1 truncate text-left font-mono text-[13px] text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => void copyPath(f.path)}
                            data-tooltip={`${f.path} — click to copy`}
                          >
                            {f.path}
                          </button>
                          <span className="h-1.5 w-12 rounded-full bg-muted overflow-hidden shrink-0">
                            <span
                              className="block h-full rounded-full bg-emerald-500/60"
                              style={{ width: `${Math.min(100, share * 100)}%` }}
                            />
                          </span>
                          <span className="text-right tabular-nums text-[13px] text-muted-foreground w-12 shrink-0">
                            {share > 0.01 ? `${(share * 100).toFixed(1)}%` : '<0.1%'}
                          </span>
                          <span className="text-right tabular-nums text-[13px] font-medium shrink-0 w-16">
                            {formatSize(f.size)}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <StepPager
                page={fileStack.length}
                hasPrev={fileStack.length > 1}
                hasNext={detail.files.hasMore}
                busy={loading}
                onPrev={() => setFileStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
                onNext={() =>
                  setFileStack((s) => (detail.files.nextCursor !== null ? [...s, detail.files.nextCursor] : s))
                }
              />
            </section>
          </div>
        )}
      </div>
    </>
  )
}
