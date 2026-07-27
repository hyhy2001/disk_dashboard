// Inodes tab: the count side of the same capacity story the byte charts tell.
//
// A filesystem runs out of inodes independently of bytes, and when it does the
// symptom is "No space left on device" on a disk that df says is half empty. That
// is why this is its own tab rather than a column on Detail User: the useful
// comparison is inodes against the inode limit, not against sizes.
//
// Two panels, matching legacy:
//   system — the filesystem's own figures, with the used/free ring
//   users  — a card per account, ranked by file count, searchable
//
// The system figures come from statvfs at scan time and cover the whole
// filesystem; the per-user figures come from the walk and cover the scan root. So
// scanned is normally far below used, and the gap is the same unattributed usage
// the Overview shows in bytes.

import { useEffect, useMemo, useState } from 'react'
import type { InodeStats } from '../../../shared/api.js'
import { fetchInodes } from '../lib/api.js'
import { formatCount, formatPercent, formatTimestamp } from '../lib/format.js'

interface Props {
  target: string
}

/**
 * Inode *table* usage above these turns the figure amber, then red. Legacy's
 * thresholds. Only the system panel uses them: a share of the scan is not a
 * warning at any value.
 */
const WARM_PERCENT = 65
const HOT_PERCENT = 85

function toneFor(pct: number): 'hot' | 'warm' | 'cool' {
  if (pct > HOT_PERCENT) return 'hot'
  if (pct > WARM_PERCENT) return 'warm'
  return 'cool'
}

/** One of the four figures across the top of the system panel. */
function Figure({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: string
  tone?: 'hot' | 'warm' | 'cool' | 'good'
  title?: string
}): JSX.Element {
  return (
    <div className="ino__stat" title={title}>
      <div className="ino__stat-label">{label}</div>
      <div className={`ino__stat-num${tone ? ` ino__stat-num--${tone}` : ''}`}>{value}</div>
    </div>
  )
}

/**
 * Used/free ring for the inode table.
 *
 * Same construction as Donut — dasharray arcs on one circle — but the slices are
 * fixed (scanned, unscanned-but-used, free) rather than a user list, so it does
 * not share that component's palette or click behaviour.
 */
function InodeRing({ total, used, scanned }: { total: number; used: number; scanned: number }): JSX.Element {
  const size = 148
  const stroke = size * 0.14
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius

  // Scanned is bounded by the scan root and used by the filesystem, but a scan of
  // a whole filesystem can report slightly more if files were created between the
  // walk and the statvfs call. Clamp so the ring never overdraws.
  const walked = Math.min(scanned, used)
  const gap = Math.max(0, used - walked)
  const free = Math.max(0, total - used)

  const slices = [
    { name: 'Scanned', value: walked, color: 'var(--emerald-500)' },
    { name: 'Used, not scanned', value: gap, color: 'var(--amber-400)' },
    { name: 'Free', value: free, color: 'var(--sky-400)' },
  ].filter((s) => s.value > 0)

  let offset = 0
  const usedPct = formatPercent(used, total)

  return (
    <div className="ino__ring">
      <svg
        className="donut__svg"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${usedPct} of ${formatCount(total)} inodes used`}
      >
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((s) => {
            const length = (s.value / total) * circumference
            const el = (
              <circle
                key={s.name}
                className="donut__slice"
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.name}: ${formatCount(s.value)} (${formatPercent(s.value, total)})`}</title>
              </circle>
            )
            offset += length
            return el
          })}
        </g>
        <text
          className="donut__total"
          x={size / 2}
          y={size / 2 - 5}
          textAnchor="middle"
          fontSize={size * 0.15}
        >
          {usedPct}
        </text>
        <text
          className="donut__caption"
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          fontSize={size * 0.082}
        >
          used
        </text>
      </svg>

      <ul className="legend">
        {slices.map((s) => (
          <li key={s.name}>
            <span className="legend__item">
              <span className="legend__swatch" style={{ background: s.color }} />
              <span className="legend__name">{s.name}</span>
              <span className="legend__value">{formatCount(s.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function InodesTab({ target }: Props): JSX.Element {
  const [data, setData] = useState<InodeStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  /*
   * No useFitRows here, unlike the list tabs.
   *
   * They measure because their page size is a server request: asking for the wrong
   * number of rows costs a refetch. This tab gets every account in one bounded
   * payload and renders them all, so the only question is which ones are on screen
   * — and CSS answers that with a scrolling grid. Measuring would add a render
   * pass and a resize observer to arrive at the same layout.
   */

  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    setData(null)
    fetchInodes(target, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [target])

  // A new target's account list is unrelated to whatever was being searched.
  useEffect(() => {
    setQuery('')
  }, [target])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!data) return []
    if (!q) return data.users
    return data.users.filter((u) => u.name.toLowerCase().includes(q))
  }, [data, query])

  if (error) {
    return (
      <div className="state state--error">
        <p className="state__title">Could not load inode usage</p>
        <p>{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="ino__body">
        <div className="skeleton" />
      </div>
    )
  }

  const { total, used, free, scanned, users } = data
  const usedPct = total !== null && used !== null ? (used / total) * 100 : null
  // Unattributed inodes: counted by the filesystem, never reached by the walk.
  const unscanned = used !== null ? Math.max(0, used - scanned) : null

  /*
   * Denominator for the per-user bars: files the scan attributed to an account.
   *
   * Not the inode table, and not `scanned`. The table is the wrong scale — the scan
   * root is usually a fraction of the filesystem, so it draws every bar as a sliver
   * (2.9% for the account owning nearly everything the scan found). And `scanned`
   * counts directories and symlinks as well as files, so a per-file share of it
   * would not add up across accounts. Summing the same quantity the cards show
   * makes the bars comparable to each other and to 100%.
   */
  const walked = users.reduce((sum, u) => sum + u.inodes, 0)

  return (
    <div className="ino">
      <section className="panel ino__sys">
        <header className="panel__head">
          <h2 className="panel__title">System inodes</h2>
          <span className="panel__note">
            {data.timestamp > 0 ? formatTimestamp(data.timestamp) : 'no snapshot'}
          </span>
        </header>

        {/* An older report, or a filesystem with no fixed inode table, has no
            system figures. The per-user breakdown below still works, so say which
            half is missing rather than emptying the tab. */}
        {total === null ? (
          <div className="state">
            <p className="state__title">No filesystem inode figures</p>
            <p>
              {data.systemAvailable
                ? 'This filesystem does not report a fixed inode table, which is normal for btrfs, XFS with dynamic inodes, and most NFS mounts. Only the scanned count is available.'
                : 'This report was written before duscan recorded inode capacity. Rescan the target to fill these in.'}
            </p>
          </div>
        ) : (
          <>
            <div className="ino__stats">
              <Figure label="Total" value={formatCount(total)} />
              <Figure
                label="Used"
                value={formatCount(used ?? 0)}
                tone={usedPct !== null ? toneFor(usedPct) : undefined}
                title={usedPct !== null ? `${usedPct.toFixed(1)}% of the inode table` : undefined}
              />
              <Figure
                label="Scanned"
                value={formatCount(scanned)}
                tone="good"
                title={
                  unscanned !== null && unscanned > 0
                    ? `${formatCount(unscanned)} used inodes were not walked by the scan`
                    : 'The scan walked every used inode'
                }
              />
              <Figure label="Free" value={formatCount(free ?? 0)} />
            </div>

            <InodeRing total={total} used={used ?? 0} scanned={scanned} />
          </>
        )}
      </section>

      <section className="panel ino__users">
        <header className="panel__head">
          <h2 className="panel__title">Per-user inodes</h2>
          <span className="panel__note">
            {formatCount(shown.length)}
            {shown.length === users.length ? '' : ` of ${formatCount(users.length)}`} account
            {users.length === 1 ? '' : 's'}
          </span>
          <input
            type="search"
            className="sidebar__search ino__search"
            placeholder="Search users…"
            aria-label="Search users by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        {/* Takes the height the panel header leaves and scrolls the grid inside,
            so the page itself stays one screen however many accounts there are. */}
        <div className="ino__body">
          {shown.length === 0 ? (
            <p className="empty">
              {users.length === 0
                ? 'No account owns any file in this report.'
                : `No account matches “${query.trim()}”.`}
            </p>
          ) : (
            <ul className="ino__grid">
              {shown.map((u) => {
                const walkPct = walked > 0 ? (u.inodes / walked) * 100 : 0
                return (
                  <li className="ino__card" key={u.name}>
                    <div className="ino__card-top">
                      <span className="ino__user" title={u.name}>
                        {u.name}
                      </span>
                      <span className="ino__count">{formatCount(u.inodes)}</span>
                    </div>
                    {/* The bar shows share of the scan, so it is not colour-coded:
                        owning most of what was scanned is a fact about the scan
                        root, not a warning. The thresholds belong to the table
                        figures in the system panel, where >85% really is a risk. */}
                    <div className="ud__bar">
                      <span
                        className="ud__fill fill--cool"
                        style={{ width: `${Math.min(100, walkPct)}%` }}
                      />
                    </div>
                    <div className="ino__card-foot">
                      <span>{formatPercent(u.inodes, walked)} of scanned files</span>
                      {/* Share of the whole table too, when there is one: it is the
                          figure that says whether an account is a risk to the
                          filesystem rather than just the biggest in this scan. */}
                      {total !== null && (
                        <span>{formatPercent(u.inodes, total)} of table</span>
                      )}
                      <span>{formatCount(u.dirs)} dirs</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
