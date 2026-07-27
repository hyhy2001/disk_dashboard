// Queries backing the History tab.
//
// The Overview already returns the whole-target timeline, but the History tab
// additionally plots one line per user, which needs hist_user_usage pivoted from
// (snapshot, user) rows into per-user series.
//
// The pivot happens here rather than in the client because the row count is
// snapshots x users — small in absolute terms, but it is pure regrouping work and
// doing it once on the server keeps the payload one array per user instead of a
// sparse matrix the client has to index.

import type Database from 'better-sqlite3'
import type { HistoryPoint, HistorySeries, UserTrend } from '../../../shared/api.js'

/**
 * Cap on the number of user series returned.
 *
 * The chart cannot usefully draw more than a dozen lines, and the picker sorts by
 * current usage, so the accounts a viewer would plot are always in the first
 * page. Without a cap a report with 5000 accounts would ship 5000 arrays.
 */
export const TREND_USER_LIMIT = 200

/** Whole-target timeline, oldest scan first. */
function readSnapshots(db: Database.Database): HistoryPoint[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.scan_date, s.scanned_at, s.total, s.used, s.available,
              COALESCE((SELECT SUM(u.size) FROM hist_user_usage u
                         WHERE u.snapshot_id = s.id), 0) AS scanned
         FROM hist_snapshots s
        ORDER BY s.scan_date ASC`,
    )
    .all() as {
    id: number
    scan_date: number
    scanned_at: number | null
    total: number | null
    used: number | null
    available: number | null
    scanned: number
  }[]

  return rows.map((r) => ({
    timestamp: r.scanned_at ?? 0,
    date: r.scan_date,
    totalSize: r.total ?? 0,
    usedSize: r.used ?? 0,
    availableSize: r.available ?? 0,
    scannedSize: r.scanned,
  }))
}

/**
 * Per-user series, ordered by usage in the newest snapshot the user appears in.
 *
 * A user who existed in older scans but not the newest still gets a series, so
 * the chart can show an account's footprint disappearing rather than silently
 * dropping the line. Their rank comes from their last known size.
 */
function readUserTrends(db: Database.Database): UserTrend[] {
  const rows = db
    .prepare(
      `SELECT u.name, u.size, s.scan_date, s.scanned_at
         FROM hist_user_usage u
         JOIN hist_snapshots s ON s.id = u.snapshot_id
        WHERE u.name IS NOT NULL
        ORDER BY s.scan_date ASC`,
    )
    .all() as {
    name: string
    size: number | null
    scan_date: number
    scanned_at: number | null
  }[]

  const byUser = new Map<string, UserTrend>()
  for (const r of rows) {
    let entry = byUser.get(r.name)
    if (!entry) {
      entry = { name: r.name, points: [] }
      byUser.set(r.name, entry)
    }
    entry.points.push({
      date: r.scan_date,
      timestamp: r.scanned_at ?? 0,
      used: r.size ?? 0,
    })
  }

  // Rank by the most recent point, which is the last one pushed because the query
  // is ordered by scan_date.
  const trends = [...byUser.values()]
  trends.sort((a, b) => {
    const av = a.points[a.points.length - 1]?.used ?? 0
    const bv = b.points[b.points.length - 1]?.used ?? 0
    return bv - av || a.name.localeCompare(b.name)
  })

  return trends.slice(0, TREND_USER_LIMIT)
}

export function readHistorySeries(db: Database.Database): HistorySeries {
  return { snapshots: readSnapshots(db), users: readUserTrends(db) }
}
