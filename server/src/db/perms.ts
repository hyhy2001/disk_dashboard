// Queries backing the Permission Issues tab.
//
// perm_issues holds one row per path the scan could not read. A scan run as root
// produces none, which is why an empty table is the normal case rather than a
// sign of failure — the UI has to say "no issues" rather than "no data".
//
// Pagination here is offset-based, unlike the Detail User tab. That is a
// deliberate difference: the row count is small (thousands, not millions) and the
// UI shows numbered pages, which keyset cursors cannot do. The indexes
// ix_perm_user and ix_perm_user_type cover the filters.

import type Database from 'better-sqlite3'
import type { PermIssue, PermPage } from '../../../shared/api.js'

/** Items per page. Legacy showed 100 and the list is dense, so keep it. */
export const PERM_PAGE = 100

export const MAX_PERM_PAGE = 1000

/**
 * Users with no team mapping arrive as an empty string from duscan. Legacy
 * bucketed them under a sentinel so they could still be filtered; reuse the same
 * name so exported CSVs match.
 */
export const UNKNOWN_USER = '__unknown__'

export interface PermFilter {
  /** Usernames to include. Empty or absent means every user. */
  users?: string[]
  /** 'file' | 'directory'. Absent means both. */
  itemType?: string
  /** Case-insensitive substring on the path. */
  path?: string
}

export interface PermOptions extends PermFilter {
  offset?: number
  limit?: number
}

interface Clause {
  sql: string
  params: (string | number)[]
}

/**
 * Turn the filter into a WHERE fragment.
 *
 * The unknown bucket needs special handling: it is stored as '' but selected by
 * name, so a request for it becomes a test on the empty string rather than an
 * IN-list member.
 */
function buildWhere(filter: PermFilter): Clause {
  const parts: string[] = []
  const params: (string | number)[] = []

  const users = (filter.users ?? []).filter((u) => u.length > 0)
  if (users.length > 0) {
    const named = users.filter((u) => u !== UNKNOWN_USER)
    const wantsUnknown = users.length !== named.length
    const ors: string[] = []
    if (named.length > 0) {
      ors.push(`user IN (${named.map(() => '?').join(', ')})`)
      params.push(...named)
    }
    if (wantsUnknown) ors.push("(user = '' OR user IS NULL)")
    parts.push(`(${ors.join(' OR ')})`)
  }

  if (filter.itemType) {
    parts.push('item_type = ?')
    params.push(filter.itemType)
  }

  const path = filter.path?.trim()
  if (path) {
    parts.push("path LIKE ? ESCAPE '\\'")
    params.push(`%${path.replace(/[%_\\]/g, '\\$&')}%`)
  }

  return { sql: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '', params }
}

/**
 * Whether this report even has the table.
 *
 * Reports written by an older duscan predate perm_issues. Probing sqlite_master
 * lets the endpoint answer "not available" instead of throwing an SQL error that
 * the client would show as a failed request.
 */
export function hasPermTable(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'perm_issues'")
    .get() as { ok: number } | undefined
  return row !== undefined
}

/** Per-user issue counts across the whole report, for the filter chips. */
function readUserCounts(db: Database.Database): { name: string; count: number }[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN user IS NULL OR user = '' THEN ? ELSE user END AS name,
              COUNT(*) AS count
         FROM perm_issues
        GROUP BY name
        ORDER BY count DESC, name ASC`,
    )
    .all(UNKNOWN_USER) as { name: string; count: number }[]
  return rows
}

/**
 * Distinct error messages with counts, for the summary row.
 *
 * Capped because a pathological report could hold thousands of distinct strings
 * (an errno rendered with a varying path would do it), and the summary row only
 * has space for a handful.
 */
function readErrorCounts(db: Database.Database): { error: string; count: number }[] {
  return db
    .prepare(
      `SELECT error, COUNT(*) AS count
         FROM perm_issues
        GROUP BY error
        ORDER BY count DESC
        LIMIT 20`,
    )
    .all() as { error: string; count: number }[]
}

/** One page of permission issues, plus the summaries the sidebar needs. */
export function readPermIssues(db: Database.Database, opts: PermOptions = {}): PermPage {
  if (!hasPermTable(db)) {
    return { rows: [], total: 0, offset: 0, hasMore: false, userCounts: [], errorCounts: [] }
  }

  const limit = Math.min(
    Math.max(1, Math.floor(opts.limit ?? PERM_PAGE)),
    MAX_PERM_PAGE,
  )
  const offset = Math.max(0, Math.floor(opts.offset ?? 0))
  const where = buildWhere(opts)

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM perm_issues ${where.sql}`)
    .get(...where.params) as { n: number }

  const rows = db
    .prepare(
      `SELECT user, item_type, error, path
         FROM perm_issues
         ${where.sql}
        ORDER BY id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as {
    user: string | null
    item_type: string
    error: string
    path: string
  }[]

  const items: PermIssue[] = rows.map((r) => ({
    user: r.user && r.user.length > 0 ? r.user : UNKNOWN_USER,
    path: r.path,
    itemType: r.item_type,
    error: r.error,
  }))

  return {
    rows: items,
    total: totalRow.n,
    offset,
    hasMore: offset + items.length < totalRow.n,
    userCounts: readUserCounts(db),
    errorCounts: readErrorCounts(db),
  }
}
