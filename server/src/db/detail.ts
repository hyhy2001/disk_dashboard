// Queries backing the Detail User tab.
//
// These are the only queries in the codebase that touch detail_files (1.5M rows
// on a modest target, far more on a real one), so every one of them is written to
// ride an existing index rather than to sort:
//
//   detail_dirs   ix_detail_dirs_uid_size_dir       (uid, size DESC, id ASC)
//   detail_files  ix_detail_files_uid_size_dir_name (uid, size DESC, dir_id ASC, name_id ASC)
//
// Both indexes lead with uid, so a single user's rows are a contiguous range
// already in the display order. That is what makes keyset pagination possible:
// instead of OFFSET (which re-walks every skipped row), a page starts from the
// last row of the previous page. Deep pages cost the same as the first.
//
// Filters are applied inside the range scan. A filter that cannot use the index
// (a path substring) still only tests rows within one user's slice, and stops as
// soon as the page is full.
//
// Measured on a real report (1.5M files, warm cache): dirs page 1.7ms, files page
// 28ms, and a deep page via cursor is no slower than the first. The one costly
// case is the extension filter — `ext` is not in the covering index, so each
// candidate needs a row lookup and a rare extension scans a long way before it
// fills a page (~1s cold). That is inherent to filtering on an unindexed column;
// the alternative would be an index we cannot add to a readonly report.

import type Database from 'better-sqlite3'
import type {
  DetailFilter,
  DetailUser,
  Page,
  UserDetail,
  UserDir,
  UserFile,
} from '../../../shared/api.js'

/** Rows per page. Legacy used 500; the same value keeps scroll depth familiar. */
export const PAGE_SIZE = 500

/**
 * Cap on a client-supplied page size, matching legacy's `get_int('limit', 500, 1, 50000)`.
 *
 * The ceiling exists for exports, not for the UI, which never asks for more than
 * PAGE_SIZE. Measured on a 1.5M-file report: 50,000 file rows cost 322ms and 7.6 MB
 * of JSON. That is a poor page but a good export chunk — it turns one user's 1.4M
 * files into 29 requests instead of 290, and the row cost is sublinear (500 rows
 * 23ms, 50,000 rows 322ms) because the per-request overhead dominates at small
 * sizes.
 */
export const MAX_PAGE_SIZE = 50_000

/**
 * Keyset position in the dirs ordering. `(size DESC, id ASC)` needs both parts:
 * sizes repeat constantly (thousands of empty directories all sort as 0), so size
 * alone cannot identify where a page ended.
 */
interface DirCursor {
  size: number
  id: number
}

/** Keyset position in the files ordering, `(size DESC, dir_id ASC, name_id ASC)`. */
interface FileCursor {
  size: number
  dirId: number
  nameId: number
}

/**
 * Cursors are opaque to the client but must survive a round trip through a URL,
 * so they travel as base64url. Corrupt or foreign cursors decode to null and are
 * treated as "start from the beginning" rather than as an error — a stale
 * bookmark should show page one, not a 400.
 */
function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor<T>(raw: string | undefined, keys: (keyof T)[]): T | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    // Every part of the key must be a finite number, or the comparison below
    // would silently degrade into a scan from the top.
    for (const k of keys) {
      if (typeof obj[k as string] !== 'number' || !Number.isFinite(obj[k as string] as number)) {
        return null
      }
    }
    return parsed as T
  } catch {
    return null
  }
}

/** Look up a username's uid. Returns null for an unknown user. */
export function findUid(db: Database.Database, username: string): number | null {
  const row = db
    .prepare('SELECT uid FROM detail_users WHERE username = ? LIMIT 1')
    .get(username) as { uid: number } | undefined
  return row?.uid ?? null
}

/**
 * Every user in the report, largest first.
 *
 * `hasDetail` is derived from total_files/total_dirs rather than by probing the
 * detail tables: a user with zero of both cannot have rows there, and the check
 * is free. It drives the picker's "no breakdown available" state.
 */
export function listUsers(db: Database.Database): DetailUser[] {
  const rows = db
    .prepare(
      `SELECT username, total_size, total_files, total_dirs, permission_issues
         FROM detail_users
        ORDER BY total_size DESC, username ASC`,
    )
    .all() as {
    username: string
    total_size: number
    total_files: number
    total_dirs: number
    permission_issues: number
  }[]

  return rows.map((r) => ({
    name: r.username,
    used: r.total_size,
    files: r.total_files,
    dirs: r.total_dirs,
    permissionIssues: r.permission_issues,
    hasDetail: r.total_files > 0 || r.total_dirs > 0,
  }))
}

/** SQL fragment plus bound parameters, so callers can compose WHERE clauses. */
interface Clause {
  sql: string
  params: (string | number)[]
}

/**
 * Build the filter predicates common to dirs and files.
 *
 * Query terms are OR-ed, matching legacy: typing `log, tmp` means "either". The
 * LIKE is case-insensitive for ASCII via SQLite's default NOCASE-like behaviour
 * on LIKE, which is what legacy's SQL relied on too.
 */
function buildFilter(filter: DetailFilter, pathExpr: string, extColumn: string | null): Clause {
  const parts: string[] = []
  const params: (string | number)[] = []

  const terms = (filter.query ?? []).map((t) => t.trim()).filter((t) => t.length > 0)
  if (terms.length > 0) {
    parts.push(`(${terms.map(() => `${pathExpr} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    // Escaping matters: a user searching for `100%` must not match everything.
    for (const t of terms) params.push(`%${t.replace(/[%_\\]/g, '\\$&')}%`)
  }

  if (extColumn) {
    const exts = (filter.ext ?? [])
      .map((e) => e.trim().replace(/^\./, '').toLowerCase())
      .filter((e) => e.length > 0)
    if (exts.length > 0) {
      parts.push(`LOWER(${extColumn}) IN (${exts.map(() => '?').join(', ')})`)
      params.push(...exts)
    }
  }

  if (filter.minSize !== undefined && filter.minSize > 0) {
    parts.push('size >= ?')
    params.push(filter.minSize)
  }
  if (filter.maxSize !== undefined && filter.maxSize > 0) {
    parts.push('size <= ?')
    params.push(filter.maxSize)
  }

  return { sql: parts.length > 0 ? ` AND ${parts.join(' AND ')}` : '', params }
}

export interface PageOptions {
  cursor?: string
  limit?: number
  filter?: DetailFilter
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return PAGE_SIZE
  return Math.min(Math.floor(limit), MAX_PAGE_SIZE)
}

/**
 * One page of a user's directories, largest first.
 *
 * The keyset predicate mirrors the index order exactly: strictly smaller size,
 * or the same size with a larger id. Writing it as a lexicographic comparison
 * (rather than `OFFSET`) is what keeps page 500 as cheap as page 1.
 */
export function readUserDirs(
  db: Database.Database,
  uid: number,
  opts: PageOptions = {},
): Page<UserDir> {
  const limit = clampLimit(opts.limit)
  const cursor = decodeCursor<DirCursor>(opts.cursor, ['size', 'id'])
  const filter = buildFilter(opts.filter ?? {}, 'path', null)

  const keyset = cursor ? ' AND (size < ? OR (size = ? AND id > ?))' : ''
  const keysetParams = cursor ? [cursor.size, cursor.size, cursor.id] : []

  // Fetch one extra row to learn whether another page exists, which avoids a
  // second COUNT(*) over the same range.
  const rows = db
    .prepare(
      `SELECT id, path, size, files
         FROM detail_dirs
        WHERE uid = ?${keyset}${filter.sql}
        ORDER BY size DESC, id ASC
        LIMIT ?`,
    )
    .all(uid, ...keysetParams, ...filter.params, limit + 1) as {
    id: number
    path: string
    size: number
    files: number
  }[]

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    rows: page.map((r) => ({ id: r.id, path: r.path, used: r.size, files: r.files })),
    nextCursor: hasMore && last ? encodeCursor({ size: last.size, id: last.id }) : null,
    hasMore,
    pageTotal: page.reduce((sum, r) => sum + r.size, 0),
  }
}

/**
 * One page of a user's files, largest first.
 *
 * File paths are stored split: the directory in detail_dirs, the basename in
 * detail_file_names. Both joins are by primary key, so they add a lookup per
 * returned row and nothing per scanned row — the joins are on the page, not on
 * the range.
 */
export function readUserFiles(
  db: Database.Database,
  uid: number,
  opts: PageOptions = {},
): Page<UserFile> {
  const limit = clampLimit(opts.limit)
  const cursor = decodeCursor<FileCursor>(opts.cursor, ['size', 'dirId', 'nameId'])
  const filter = buildFilter(opts.filter ?? {}, 'd.path', 'f.ext')

  // Three-part keyset, one clause per index column.
  const keyset = cursor
    ? ` AND (f.size < ?
            OR (f.size = ? AND f.dir_id > ?)
            OR (f.size = ? AND f.dir_id = ? AND f.name_id > ?))`
    : ''
  const keysetParams = cursor
    ? [cursor.size, cursor.size, cursor.dirId, cursor.size, cursor.dirId, cursor.nameId]
    : []

  // The path filter reads d.path, so the dirs join has to happen before the
  // predicate; it is a primary-key lookup either way.
  const rows = db
    .prepare(
      `SELECT f.size, f.dir_id, f.name_id, f.ext,
              d.path AS dir_path, n.name AS base
         FROM detail_files f
         JOIN detail_dirs d ON d.id = f.dir_id AND d.uid = f.uid
         JOIN detail_file_names n ON n.id = f.name_id
        WHERE f.uid = ?${keyset}${filter.sql}
        ORDER BY f.size DESC, f.dir_id ASC, f.name_id ASC
        LIMIT ?`,
    )
    .all(uid, ...keysetParams, ...filter.params, limit + 1) as {
    size: number
    dir_id: number
    name_id: number
    ext: string
    dir_path: string
    base: string
  }[]

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  return {
    rows: page.map((r) => ({
      // Avoid '//name' when the file sits directly in the root.
      path: r.dir_path.endsWith('/') ? `${r.dir_path}${r.base}` : `${r.dir_path}/${r.base}`,
      size: r.size,
      ext: r.ext,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ size: last.size, dirId: last.dir_id, nameId: last.name_id })
        : null,
    hasMore,
    pageTotal: page.reduce((sum, r) => sum + r.size, 0),
  }
}

export interface DetailOptions {
  dirCursor?: string
  fileCursor?: string
  limit?: number
  filter?: DetailFilter
}

/**
 * Both lists for one user in a single response.
 *
 * When an extension filter is active the dirs list is suppressed rather than
 * filtered. A directory's stored size covers every file in it; there is no way to
 * restrict that to one extension without summing detail_files per directory,
 * which would turn an indexed range scan into a full aggregate. Legacy made the
 * same call and hid the card.
 */
export function readUserDetail(
  db: Database.Database,
  user: string,
  uid: number,
  opts: DetailOptions = {},
): UserDetail {
  const filter = opts.filter ?? {}
  const dirsSuppressed = (filter.ext ?? []).some((e) => e.trim().length > 0)

  const totals = db.prepare('SELECT total_size FROM detail_users WHERE uid = ?').get(uid) as
    | { total_size: number }
    | undefined

  const empty: Page<UserDir> = { rows: [], nextCursor: null, hasMore: false, pageTotal: 0 }

  return {
    user,
    userTotal: totals?.total_size ?? 0,
    dirs: dirsSuppressed
      ? empty
      : readUserDirs(db, uid, {
          ...(opts.dirCursor !== undefined ? { cursor: opts.dirCursor } : {}),
          ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
          filter,
        }),
    files: readUserFiles(db, uid, {
      ...(opts.fileCursor !== undefined ? { cursor: opts.fileCursor } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      filter,
    }),
    dirsSuppressed,
  }
}
