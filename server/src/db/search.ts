// Global name search across a report.
//
// Legacy searched directory names only. This searches both directory names
// (treemap_names) and file basenames (detail_file_names), because the interning
// tables are small — 26k and 347k rows on a target with 1.5M files — so matching
// against them is orders of magnitude cheaper than scanning the path column.
//
// Reports written by a modern duscan carry FTS5 trigram search indexes
// (fts_file_names / fts_dir_names, external-content over the two interning
// tables). The scanner builds the index because the dashboard opens reports
// readonly; reports scanned by an older duscan simply lack the tables.
//
// Queries that are a plain ASCII alphanumeric run of three or more characters
// take the MATCH path: the trigram index serves them as a direct lookup
// (`SELECT rowid, name FROM fts_dir_names WHERE fts_dir_names MATCH ?`), joined
// to the base tables through the name_id index — a few milliseconds even on a
// report with millions of files. Every other query (shorter, or with
// punctuation) keeps the LIKE path, because MATCH semantics diverge there: a
// 1-2 character query matches nothing (a trigram needs three chars), and `-`,
// `.`, `+`, `@`, `#`, `'`, or a space raise syntax errors or change meaning.
// The LIKE fallback runs against the trigram table when it is present (the
// index serves the `%…%` pattern too) and against the base tables otherwise.
// The trigram tables are external-content, so their `rowid` is the base table's
// `id` and `name` reads through to the same rows — the MATCH and LIKE paths
// return identical results for the queries each handles, which the tests pin
// down.
//
// Each hit needs a full path, which means walking parents. That walk is per hit,
// not per candidate, so it is bounded by the page size.

import type Database from 'better-sqlite3'
import type { SearchHit, SearchResult } from '../../../shared/api.js'

/** Hits returned per page. */
export const SEARCH_LIMIT = 40

/**
 * Max cached results per report handle.
 *
 * Searches are the slowest queries in the app (a LIKE over 350k interned file
 * names plus a path walk per hit), and a user retypes similar terms while
 * exploring — same query, same report, same page. An LRU per report turns those
 * repeats into a map hit instead of another scan. 100 entries bounds memory at a
 * few hundred KB even for a worst-case page of 400 hits each.
 */
export const SEARCH_CACHE_CAP = 100

/** Shortest query accepted. One character would match nearly every report. */
export const MIN_QUERY = 2

/**
 * Does a report carry the FTS5 trigram search indexes a modern duscan builds?
 *
 * Checked once per handle and cached: the answer cannot change for a given
 * report. Both tables appear together, so probing one is enough.
 */
const ftsByHandle = new WeakMap<Database.Database, boolean>()

function hasFtsIndexes(db: Database.Database): boolean {
  let has = ftsByHandle.get(db)
  if (has === undefined) {
    const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fts_file_names' LIMIT 1`).get()
    has = row !== undefined
    ftsByHandle.set(db, has)
  }
  return has
}

/**
 * Candidates examined per name table before giving up.
 *
 * A query like `e` would match most of the 347k file names; without a cap the
 * server would build a path for each. The cap makes the worst case bounded and
 * the UI reports the result as partial.
 */
const CANDIDATE_LIMIT = 400

function likeParam(query: string): string {
  return `%${query.replace(/[%_\\]/g, '\\$&')}%`
}

/**
 * Is the query safe to hand to the FTS5 MATCH operator?
 *
 * Trigram tokenization only indexes three-character runs, so a query must be at
 * least three chars to find anything, and only an unadorned alphanumeric run
 * maps 1:1 onto the LIKE-substring semantics we need. Anything else — shorter
 * queries, punctuation, spaces — changes MATCH semantics or raises a syntax
 * error, so those stay on the LIKE path.
 */
function isMatchable(query: string): boolean {
  return /^[A-Za-z0-9]{3,}$/.test(query)
}

/**
 * LRU of search results, keyed by the report handle.
 *
 * Results are valid only against the exact report they were computed from. The
 * report handle is a stable object while the file is unchanged and a fresh
 * object after a rescan (see openReportAt), so a WeakMap keyed by the handle
 * invalidates the cache the moment a new report replaces the old one — no stamp
 * bookkeeping here. The entry per handle is dropped with it when it is GC'd.
 */
const resultCache = new WeakMap<Database.Database, Map<string, SearchResult>>()

function cacheKey(query: string, opts: SearchOptions): string {
  return `${opts.kind ?? '*'}\u0000${query}\u0000${opts.limit ?? SEARCH_LIMIT}`
}

function cacheGet(db: Database.Database, key: string): SearchResult | undefined {
  const lru = resultCache.get(db)
  if (!lru) return undefined
  const hit = lru.get(key)
  if (hit === undefined) return undefined
  // Touch: re-insert so this key is the newest in the LRU.
  lru.delete(key)
  lru.set(key, hit)
  return hit
}

function cacheSet(db: Database.Database, key: string, value: SearchResult): void {
  let lru = resultCache.get(db)
  if (!lru) {
    lru = new Map()
    resultCache.set(db, lru)
  }
  lru.set(key, value)
  if (lru.size > SEARCH_CACHE_CAP) {
    // Map iteration yields insertion order, so the first key is the LRU victim.
    const oldest = lru.keys().next().value as string | undefined
    if (oldest !== undefined) lru.delete(oldest)
  }
}

/**
 * Build a full path by walking up the parent chain.
 *
 * Paths are cached per call: search hits cluster in the same few directories, so
 * the second hit in a directory costs one map lookup instead of a tree walk.
 */
function pathBuilder(db: Database.Database): (id: number) => string {
  const cache = new Map<number, string>()
  const stmt = db.prepare(
    `SELECT d.parent_id, n.name
       FROM treemap_dirs d
       JOIN treemap_names n ON n.id = d.name_id
      WHERE d.id = ?`,
  )

  return function pathOf(id: number): string {
    const hit = cache.get(id)
    if (hit !== undefined) return hit

    const parts: string[] = []
    const seen = new Set<number>()
    let cur: number | null = id

    // `seen` guards against a cycle in a corrupt report — without it a bad
    // parent pointer would spin here forever.
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur)
      const row = stmt.get(cur) as { parent_id: number | null; name: string } | undefined
      if (!row) break
      parts.unshift(row.name)
      cur = row.parent_id
    }

    // The root's name is '/', so joining naively would yield '//var'.
    const joined = parts.reduce((acc, part) => {
      if (acc === '') return part
      return acc.endsWith('/') ? `${acc}${part}` : `${acc}/${part}`
    }, '')

    cache.set(id, joined)
    return joined
  }
}

/**
 * Directories whose basename matches, largest first.
 *
 * When the report has FTS tables and the query is MATCH-safe, the trigram index
 * resolves the match (its rowid is the base treemap_names.id), then the join
 * walks detail rows through the name_id index — no LIKE scan at all. Otherwise
 * it is the plain LIKE scan over the interned names (from the FTS table when
 * present, which also serves the pattern from the index).
 */
function searchDirs(db: Database.Database, query: string, limit: number): SearchHit[] {
  const fts = hasFtsIndexes(db)
  const matchable = fts && isMatchable(query)
  const rows = db
    .prepare(
      matchable
        ? `SELECT d.id, m.name, d.total_size, d.owner_uid, o.username
             FROM (SELECT rowid, name FROM fts_dir_names WHERE fts_dir_names MATCH ?) m
             JOIN treemap_dirs d ON d.name_id = m.rowid
        LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
             ORDER BY d.total_size DESC
             LIMIT ?`
        : `SELECT d.id, n.name, d.total_size, d.owner_uid, o.username
             FROM ${fts ? 'fts_dir_names' : 'treemap_names'} n
             JOIN treemap_dirs d ON d.name_id = ${fts ? 'n.rowid' : 'n.id'}
        LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
             WHERE n.name LIKE ? ESCAPE '\\'
             ORDER BY d.total_size DESC
             LIMIT ?`,
    )
    .all(matchable ? query : likeParam(query), Math.min(limit, CANDIDATE_LIMIT)) as {
    id: number
    name: string
    total_size: number
    owner_uid: number
    username: string | null
  }[]

  const pathOf = pathBuilder(db)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    path: pathOf(r.id),
    size: r.total_size,
    kind: 'dir' as const,
    owner: r.username ?? `uid-${r.owner_uid}`,
  }))
}

/**
 * Files whose basename matches, largest first.
 *
 * detail_files is joined *from* the name table, so the planner starts with the
 * few matching name ids rather than scanning 1.5M file rows. `id` on the hit is
 * the containing directory, which is what the treemap drills to — a file is not a
 * navigable node. Like searchDirs, MATCH-safe queries on FTS reports are served
 * entirely by the trigram + name_id indexes.
 */
function searchFiles(db: Database.Database, query: string, limit: number): SearchHit[] {
  const fts = hasFtsIndexes(db)
  const matchable = fts && isMatchable(query)
  const rows = db
    .prepare(
      matchable
        ? `SELECT f.dir_id, m.name, f.size, f.uid, o.username
             FROM (SELECT rowid, name FROM fts_file_names WHERE fts_file_names MATCH ?) m
             JOIN detail_files f ON f.name_id = m.rowid
        LEFT JOIN treemap_owners o ON o.uid = f.uid
             ORDER BY f.size DESC
             LIMIT ?`
        : `SELECT f.dir_id, n.name, f.size, f.uid, o.username
             FROM ${fts ? 'fts_file_names' : 'detail_file_names'} n
             JOIN detail_files f ON f.name_id = ${fts ? 'n.rowid' : 'n.id'}
        LEFT JOIN treemap_owners o ON o.uid = f.uid
             WHERE n.name LIKE ? ESCAPE '\\'
             ORDER BY f.size DESC
             LIMIT ?`,
    )
    .all(matchable ? query : likeParam(query), Math.min(limit, CANDIDATE_LIMIT)) as {
    dir_id: number
    name: string
    size: number
    uid: number
    username: string | null
  }[]

  const pathOf = pathBuilder(db)
  return rows.map((r) => {
    const dir = pathOf(r.dir_id)
    return {
      id: r.dir_id,
      name: r.name,
      path: dir.endsWith('/') ? `${dir}${r.name}` : `${dir}/${r.name}`,
      size: r.size,
      kind: 'file' as const,
      owner: r.username ?? `uid-${r.uid}`,
    }
  })
}

export interface SearchOptions {
  /** 'dir' | 'file' to restrict; absent searches both. */
  kind?: 'dir' | 'file'
  limit?: number
}

/**
 * Search a report for directories and files by name.
 *
 * Results from both tables are merged and re-sorted by size, so the biggest match
 * leads regardless of which table it came from — that is what a viewer hunting
 * for space wants first.
 */
export function searchNames(db: Database.Database, query: string, opts: SearchOptions = {}): SearchResult {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) {
    return { hits: [], hasMore: false, searched: { dirs: false, files: false } }
  }

  const key = cacheKey(trimmed, opts)
  const cached = cacheGet(db, key)
  if (cached !== undefined) return cached

  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? SEARCH_LIMIT)), CANDIDATE_LIMIT)
  const wantDirs = opts.kind !== 'file'
  const wantFiles = opts.kind !== 'dir'

  // Over-fetch from each side so the merge has enough to fill a page even when
  // one table supplies every top hit.
  const dirs = wantDirs ? searchDirs(db, trimmed, limit + 1) : []
  const files = wantFiles ? searchFiles(db, trimmed, limit + 1) : []

  const merged = [...dirs, ...files].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))

  const result: SearchResult = {
    hits: merged.slice(0, limit),
    hasMore: merged.length > limit,
    searched: { dirs: wantDirs, files: wantFiles },
  }

  cacheSet(db, key, result)
  return result
}
