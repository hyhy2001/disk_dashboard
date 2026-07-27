// Global name search across a report.
//
// Legacy searched directory names only. This searches both directory names
// (treemap_names) and file basenames (detail_file_names), because the interning
// tables are small — 26k and 347k rows on a target with 1.5M files — so matching
// against them is orders of magnitude cheaper than scanning the path column.
//
// The search is a LIKE over interned names, not FTS5. Trigram would allow infix
// matching with an index, but building that index would mean writing to a report
// opened readonly; the interned tables are small enough that a scan of them is
// already fast, and correctness beats a speedup we cannot deploy.
//
// Each hit needs a full path, which means walking parents. That walk is per hit,
// not per candidate, so it is bounded by the page size.

import type Database from 'better-sqlite3'
import type { SearchHit, SearchResult } from '../../../shared/api.js'

/** Hits returned per page. */
export const SEARCH_LIMIT = 40

/** Shortest query accepted. One character would match nearly every report. */
export const MIN_QUERY = 2

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

/** Directories whose basename matches, largest first. */
function searchDirs(db: Database.Database, query: string, limit: number): SearchHit[] {
  const rows = db
    .prepare(
      `SELECT d.id, n.name, d.total_size, d.owner_uid, o.username
         FROM treemap_names n
         JOIN treemap_dirs d ON d.name_id = n.id
    LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
        WHERE n.name LIKE ? ESCAPE '\\'
        ORDER BY d.total_size DESC
        LIMIT ?`,
    )
    .all(likeParam(query), Math.min(limit, CANDIDATE_LIMIT)) as {
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
 * navigable node.
 */
function searchFiles(db: Database.Database, query: string, limit: number): SearchHit[] {
  const rows = db
    .prepare(
      `SELECT f.dir_id, n.name, f.size, f.uid, o.username
         FROM detail_file_names n
         JOIN detail_files f ON f.name_id = n.id
    LEFT JOIN treemap_owners o ON o.uid = f.uid
        WHERE n.name LIKE ? ESCAPE '\\'
        ORDER BY f.size DESC
        LIMIT ?`,
    )
    .all(likeParam(query), Math.min(limit, CANDIDATE_LIMIT)) as {
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
export function searchNames(
  db: Database.Database,
  query: string,
  opts: SearchOptions = {},
): SearchResult {
  const trimmed = query.trim()
  if (trimmed.length < MIN_QUERY) {
    return { hits: [], hasMore: false, searched: { dirs: false, files: false } }
  }

  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? SEARCH_LIMIT)), CANDIDATE_LIMIT)
  const wantDirs = opts.kind !== 'file'
  const wantFiles = opts.kind !== 'dir'

  // Over-fetch from each side so the merge has enough to fill a page even when
  // one table supplies every top hit.
  const dirs = wantDirs ? searchDirs(db, trimmed, limit + 1) : []
  const files = wantFiles ? searchFiles(db, trimmed, limit + 1) : []

  const merged = [...dirs, ...files].sort((a, b) => b.size - a.size || a.path.localeCompare(b.path))

  return {
    hits: merged.slice(0, limit),
    hasMore: merged.length > limit,
    searched: { dirs: wantDirs, files: wantFiles },
  }
}
