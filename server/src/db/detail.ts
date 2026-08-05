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
import type { DetailFilter, DetailUser, Page, UserDetail, UserDir, UserFile } from '../../../shared/api.js'

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
 * LRU of filtered-list COUNT(*) totals, keyed by the report handle.
 *
 * The COUNT behind a filtered dirs/files page is the one query that scales with
 * the whole user slice: a path LIKE cannot use the index, so on a large report it
 * re-scans every one of a user's rows. The filter does not change as the user
 * pages through a filtered list — only the cursor does — so a single COUNT can
 * serve every page of that list instead of paying the scan once per page.
 *
 * Like searchNames' cache, a WeakMap keyed by the handle drops the entries the
 * moment a rescan produces a new handle; nothing here needs invalidation
 * bookkeeping.
 */
const countCache = new WeakMap<Database.Database, Map<string, number>>()

/**
 * Max cached COUNTs per report handle.
 *
 * A user flipping between a handful of filters stays well inside this; the cap
 * keeps a pathological many-filter session from accumulating entries. Each entry
 * is a single integer, so memory is negligible.
 */
const COUNT_CACHE_CAP = 200

/**
 * Which optional columns a report's tables actually carry, cached per handle.
 *
 * Columns added in a later schema generation are absent from reports written by
 * an older scanner, and those reports stay on disk until the target is rescanned
 * — which, for a multi-gigabyte report, is not soon. Probing lets one dashboard
 * build serve both generations instead of requiring a fleet-wide rescan.
 */
const columnCache = new WeakMap<Database.Database, Map<string, boolean>>()

/** Whether `table` has a column named `column` in this report. */
function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const key = `${table}.${column}`
  let known = columnCache.get(db)
  const hit = known?.get(key)
  if (hit !== undefined) return hit

  // table_info() is a pragma over the schema, not the data, so this costs
  // nothing even on a huge report. Quoted as an identifier: `table` is a
  // literal at every call site, never user input.
  const cols = db.pragma(`table_info("${table}")`) as { name: string }[]
  const present = cols.some((c) => c.name === column)

  if (!known) {
    known = new Map()
    columnCache.set(db, known)
  }
  known.set(key, present)
  return present
}

/** COUNT(*) for one query, cached per handle so paging a filtered list scans once. */
function countCached(db: Database.Database, sql: string, params: (string | number)[]): number {
  const key = `${sql}\u0000${JSON.stringify(params)}`
  let lru = countCache.get(db)
  const hit = lru?.get(key)
  if (hit !== undefined) {
    // Touch: re-insert so this key is the newest in the LRU.
    lru!.delete(key)
    lru!.set(key, hit)
    return hit
  }

  const { cnt } = db.prepare(sql).get(...params) as { cnt: number }

  if (!lru) {
    lru = new Map()
    countCache.set(db, lru)
  }
  lru.set(key, cnt)
  if (lru.size > COUNT_CACHE_CAP) {
    // Map iteration yields insertion order, so the first key is the LRU victim.
    const oldest = lru.keys().next().value as string | undefined
    if (oldest !== undefined) lru.delete(oldest)
  }
  return cnt
}

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
  const row = db.prepare('SELECT uid FROM detail_users WHERE username = ? LIMIT 1').get(username) as
    { uid: number } | undefined
  return row?.uid ?? null
}

/**
 * Every user in the report, largest first.
 *
 * `hasDetail` is derived from total_files/total_dirs rather than by probing the
 * detail tables: a user with zero of both cannot have rows there, and the check
 * is free. It drives the picker's "no breakdown available" state.
 *
 * detail_users.permission_issues is deliberately not selected. duscan declares
 * the column but its only writer hardcodes 0 (core/src/report_pipeline.rs, the
 * single UserRow construction site), so it never carries a real count. Per-user
 * permission figures come from the perm_issues table via perms.ts.
 */
/**
 * Cap on accounts returned for the picker. A shared host can carry tens of
 * thousands of accounts; shipping them all would be a multi-MB JSON blob for a
 * dropdown that is only ever used to pick someone to inspect. The list is
 * ordered by size, so the cap keeps the top consumers reachable, which is what
 * the picker is for.
 */
export const USER_LIST_LIMIT = 1000

export function listUsers(db: Database.Database): DetailUser[] {
  const rows = db
    .prepare(
      `SELECT username, total_size, total_files, total_dirs
         FROM detail_users
        ORDER BY total_size DESC, username ASC
        LIMIT ?`,
    )
    .all(USER_LIST_LIMIT) as {
    username: string
    total_size: number
    total_files: number
    total_dirs: number
  }[]

  return rows.map((r) => ({
    name: r.username,
    used: r.total_size,
    files: r.total_files,
    dirs: r.total_dirs,
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
    const exts = (filter.ext ?? []).map((e) => e.trim().replace(/^\./, '').toLowerCase()).filter((e) => e.length > 0)
    if (exts.length > 0) {
      parts.push(`${extColumn} IN (${exts.map(() => '?').join(', ')})`)
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
  /** Pre-computed total from detail_users, used when there's no filter (avoids COUNT). */
  totalHint?: number
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
export function readUserDirs(db: Database.Database, uid: number, opts: PageOptions = {}): Page<UserDir> {
  const limit = clampLimit(opts.limit)
  const cursor = decodeCursor<DirCursor>(opts.cursor, ['size', 'id'])
  const filter = buildFilter(opts.filter ?? {}, 'path', null)

  const keyset = cursor ? ' AND (size < ? OR (size = ? AND id > ?))' : ''
  const keysetParams = cursor ? [cursor.size, cursor.size, cursor.id] : []

  // detail_dirs is keyed (id, uid): a directory has one row per user who has
  // files in it, and `owner_uid` is the directory's real owner. Filtering on
  // uid alone would show directories the user merely touches (a file in /etc
  // puts /etc on the list) — the user's own directories are those they own.
  const ownedClause = ' AND owner_uid = ?'
  const ownedParam = uid

  // Fetch one extra row to learn whether another page exists, which avoids a
  // second COUNT(*) over the same range.
  const rows = db
    .prepare(
      `SELECT id, path, size, files
         FROM detail_dirs
        WHERE uid = ?${ownedClause}${keyset}${filter.sql}
        ORDER BY size DESC, id ASC
        LIMIT ?`,
    )
    .all(uid, ownedParam, ...keysetParams, ...filter.params, limit + 1) as {
    id: number
    path: string
    size: number
    files: number
  }[]

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page[page.length - 1]

  // Owner filtering means detail_users.total_dirs (the raw contribution count) no
  // longer matches what this list shows, so the total cannot come from that
  // column. Counting it costs a range scan over every one of the user's rows —
  // measured at 0.22s warm and 1.60s cold for root on a 1.5M-file report, and
  // better-sqlite3 is synchronous, so that time blocks every other request too.
  //
  // Scanners at schema 2 and later precompute the owned-directory count into
  // detail_users.owned_dirs during the merge, turning the scan into a primary-key
  // lookup. It only answers the unfiltered list, though: a path filter changes
  // which rows qualify, and that cannot be precomputed. Older reports have no
  // such column at all, so both cases fall back to the COUNT, cached per handle
  // (see countCached) since the filter stays fixed while the user pages.
  const total =
    !filter.sql && hasColumn(db, 'detail_users', 'owned_dirs')
      ? ((db.prepare('SELECT owned_dirs AS cnt FROM detail_users WHERE uid = ?').get(uid) as
          | { cnt: number }
          | undefined)?.cnt ?? 0)
      : countCached(
          db,
          `SELECT COUNT(*) AS cnt FROM detail_dirs WHERE uid = ?${ownedClause}${filter.sql}`,
          [uid, ownedParam, ...filter.params],
        )

  return {
    rows: page.map((r) => ({ id: r.id, path: r.path, used: r.size, files: r.files })),
    nextCursor: hasMore && last ? encodeCursor({ size: last.size, id: last.id }) : null,
    hasMore,
    pageTotal: page.reduce((sum, r) => sum + r.size, 0),
    total,
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
export function readUserFiles(db: Database.Database, uid: number, opts: PageOptions = {}): Page<UserFile> {
  const limit = clampLimit(opts.limit)
  const cursor = decodeCursor<FileCursor>(opts.cursor, ['size', 'dirId', 'nameId'])
  const filter = buildFilter(opts.filter ?? {}, 'd.path', 'f.ext')

  // Three-part keyset, one clause per index column.
  const keyset = cursor
    ? ` AND (f.size < ?
            OR (f.size = ? AND f.dir_id > ?)
            OR (f.size = ? AND f.dir_id = ? AND f.name_id > ?))`
    : ''
  const keysetParams = cursor ? [cursor.size, cursor.size, cursor.dirId, cursor.size, cursor.dirId, cursor.nameId] : []

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

  const hasFilter =
    (opts.filter?.query ?? []).some((t) => t.trim().length > 0) ||
    (opts.filter?.ext ?? []).some((e) => e.trim().length > 0) ||
    (opts.filter?.minSize !== undefined && opts.filter.minSize > 0) ||
    (opts.filter?.maxSize !== undefined && opts.filter.maxSize > 0)

  // When a filter is active detail_users.total_files (which the no-filter path
  // trusts via totalHint) no longer matches the list, so the total is counted.
  // That COUNT joins detail_dirs and scans the user's whole file slice — the
  // most expensive query in the tab, and why it is cached per handle (see
  // countCached): the count depends only on the filter, which stays fixed while
  // the user pages through the list.
  const total = hasFilter
    ? countCached(
        db,
        `SELECT COUNT(*) AS cnt
           FROM detail_files f
           JOIN detail_dirs d ON d.id = f.dir_id AND d.uid = f.uid
          WHERE f.uid = ?${filter.sql}`,
        [uid, ...filter.params],
      )
    : (opts.totalHint ?? 0)

  return {
    rows: page.map((r) => ({
      // Avoid '//name' when the file sits directly in the root.
      path: r.dir_path.endsWith('/') ? `${r.dir_path}${r.base}` : `${r.dir_path}/${r.base}`,
      size: r.size,
      ext: r.ext,
    })),
    nextCursor: hasMore && last ? encodeCursor({ size: last.size, dirId: last.dir_id, nameId: last.name_id }) : null,
    hasMore,
    pageTotal: page.reduce((sum, r) => sum + r.size, 0),
    total,
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
/** The Detail tab's two export buttons: one user's dirs or their files. */
export type ExportKind = 'dirs' | 'files'

/** Header rows match what legacy's exporter wrote, so old CSVs stay comparable. */
const EXPORT_HEADERS: Record<ExportKind, readonly string[]> = {
  dirs: ['Path', 'Bytes', 'Files'],
  files: ['Path', 'Bytes', 'Extension'],
}

/**
 * Quote one CSV cell, mirroring the web client's writer exactly so a saved file
 * has the same bytes whichever end produced it. Commas/quotes/newlines are
 * escaped, and a leading `=`, `+`, `-`, `@`, tab or CR gets a quote-escape too:
 * spreadsheets would otherwise evaluate such a cell as a formula — a filename
 * like `=cmd|...` becomes code execution when the file is opened.
 */
function csvCell(value: string | number): string {
  const s = String(value)
  const risky = /^[=+\-@\t\r]/.test(s)
  const body = risky ? `'${s}` : s
  if (/[",\n\r]/.test(body)) return `"${body.replace(/"/g, '""')}"`
  return body
}

function csvLine(row: readonly (string | number)[]): string {
  return `${row.map(csvCell).join(',')}\r\n`
}

/** Lines per yielded chunk; the generator also breathes every this many rows. */
const CSV_CHUNK = 256
const CSV_BREATHE_EVERY = 2000

/**
 * Stream one user's dirs or files as CSV, honouring the same filters as the
 * paged queries.
 *
 * An export wants everything — no limit, no cursor — so this is written
 * differently from readUserDirs/readUserFiles:
 *
 *   - Rows come from SQLite's iterator one at a time, so memory is O(chunk)
 *     rather than O(user): a 1.4M-file user never builds a big array, and no
 *     multi-megabyte JSON page is ever serialized.
 *   - The generator yields whole lines (Fastify streams them to the socket) and
 *     hands control back to the event loop every CSV_BREATHE_EVERY rows, so one
 *     user's export cannot peg the CPU and starve other requests.
 *
 * The SQL and filters are shared with the paged queries, so the CSV and the UI
 * cannot drift apart.
 */
export async function* streamUserListCsv(
  db: Database.Database,
  uid: number,
  kind: ExportKind,
  filter: DetailFilter = {},
): AsyncGenerator<string> {
  const clause = buildFilter(filter, kind === 'dirs' ? 'path' : 'd.path', kind === 'dirs' ? null : 'f.ext')

  // Both statements mirror readUserDirs/readUserFiles — same joins, the same
  // owner_uid rule for dirs, the same ORDER BY riding the (uid, size, …) index
  // (so no sort is needed). Only the LIMIT and cursor are gone.
  const sql =
    kind === 'dirs'
      ? `SELECT path, size, files
           FROM detail_dirs
          WHERE uid = ? AND owner_uid = ?${clause.sql}
          ORDER BY size DESC, id ASC`
      : `SELECT f.size, f.ext, d.path AS dir_path, n.name AS base
           FROM detail_files f
           JOIN detail_dirs d ON d.id = f.dir_id AND d.uid = f.uid
           JOIN detail_file_names n ON n.id = f.name_id
          WHERE f.uid = ?${clause.sql}
          ORDER BY f.size DESC, f.dir_id ASC, f.name_id ASC`
  const params = kind === 'dirs' ? [uid, uid, ...clause.params] : [uid, ...clause.params]

  // One shape for both statements: dirs fill path/size/files, files fill
  // size/ext/dir_path/base. SQLite's row type is a union of the two.
  const cells = (row: {
    path?: string
    size: number
    files?: number
    ext?: string
    dir_path?: string
    base?: string
  }): (string | number)[] =>
    kind === 'dirs'
      ? [row.path as string, row.size, row.files as number]
      : // Avoid '//name' when the file sits directly in the scan root (same rule
        // as readUserFiles).
        [
          `${row.dir_path as string}${(row.dir_path as string).endsWith('/') ? '' : '/'}${row.base as string}`,
          row.size,
          row.ext as string,
        ]

  let buffer = csvLine(EXPORT_HEADERS[kind])
  let lines = 0
  let rows = 0

  for (const row of db.prepare(sql).iterate(...params) as Iterable<{
    path?: string
    size: number
    files?: number
    ext?: string
    dir_path?: string
    base?: string
  }>) {
    buffer += csvLine(cells(row))
    lines += 1
    rows += 1

    if (lines >= CSV_CHUNK) {
      yield buffer
      buffer = ''
      lines = 0
    }
    if (rows % CSV_BREATHE_EVERY === 0) {
      // Yield the event loop even when the socket never blocks (a fast LAN
      // export) so timers and other requests get a turn.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
  }

  // The header alone (an empty export is a valid CSV) or the tail of the last
  // partial chunk.
  if (buffer) yield buffer
}

export function readUserDetail(db: Database.Database, user: string, uid: number, opts: DetailOptions = {}): UserDetail {
  const filter = opts.filter ?? {}
  const dirsSuppressed = (filter.ext ?? []).some((e) => e.trim().length > 0)

  const totals = db.prepare('SELECT total_size, total_dirs, total_files FROM detail_users WHERE uid = ?').get(uid) as
    { total_size: number; total_dirs: number; total_files: number } | undefined

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
          totalHint: totals?.total_dirs ?? 0,
        }),
    files: readUserFiles(db, uid, {
      ...(opts.fileCursor !== undefined ? { cursor: opts.fileCursor } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      filter,
      totalHint: totals?.total_files ?? 0,
    }),
    dirsSuppressed,
  }
}
