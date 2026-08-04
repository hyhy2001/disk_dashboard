// Treemap drill-down over treemap_dirs.
//
// The table is an adjacency list: each row points at its parent, with the index
// ix_treemap_dirs_parent_size on (parent_id, total_size DESC). That shape decides
// the whole design here — we fetch exactly one level at a time, so a request
// costs O(children of one node) regardless of how big the tree is. Measured at
// 5-8ms per level on a 187k-node report, and it stays that way at 15M nodes.
//
// The alternative (ship a whole subtree and let the client zoom) would mean an
// unbounded recursive query, so it is deliberately not done.
//
// Directory *names* are interned in treemap_names, so every read joins through
// it; the full path of a node is only known by walking up to the root, which is
// what breadcrumbs() does.

import type Database from 'better-sqlite3'
import type { TreemapCrumb, TreemapFile, TreemapLevel, TreemapNode } from '../../../shared/api.js'

/**
 * Children returned per page.
 *
 * Legacy paged at 20 per "Load more"; 60 is chosen instead because this view also
 * renders the treemap rectangles, and 20 tiles is too few to read proportions from.
 * The tradeoff is a longer list page, which is cheap — the query is an index range
 * scan over one parent's children.
 */
export const CHILD_LIMIT = 60

/** Files returned per page, same reasoning. */
export const FILE_LIMIT = 60

interface ChildRow {
  id: number
  name: string
  total_size: number
  file_count: number
  dir_count: number
  owner_uid: number
  username: string | null
  has_files: number
}

/**
 * Resolve the node to show. A null parent means "start at the scan root", which
 * is the single row with parent_id IS NULL.
 */
function rootId(db: Database.Database): number | null {
  const row = db.prepare('SELECT id FROM treemap_dirs WHERE parent_id IS NULL LIMIT 1').get() as
    { id: number } | undefined
  return row?.id ?? null
}

interface NodeRow {
  id: number
  name: string
  total_size: number
  file_count: number
  dir_count: number
  owner_uid: number
  username: string | null
  has_files: number
}

function readNode(db: Database.Database, id: number): NodeRow | undefined {
  return db
    .prepare(
      `SELECT d.id, n.name, d.total_size, d.file_count, d.dir_count,
              d.owner_uid, o.username, d.has_files
         FROM treemap_dirs d
         JOIN treemap_names n ON n.id = d.name_id
    LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
        WHERE d.id = ?`,
    )
    .get(id) as NodeRow | undefined
}

/**
 * Files sitting directly in one directory, largest first.
 *
 * detail_files has no dir_id index of its own — only the covering index
 * (uid, size DESC, dir_id, name_id) — so this runs as a skip-scan over the 32
 * distinct uids. That is fine at this scale (measured 9-22ms for a directory
 * with 9,571 files) precisely because uid cardinality is tiny. If a report ever
 * carries thousands of uids, this needs a dedicated dir_id index rather than a
 * bigger LIMIT.
 *
 * Only call this when treemap_dirs.has_files is 1; it is exact, verified against
 * a real report, so a 0 means the scan is guaranteed to find nothing.
 */
function readFiles(db: Database.Database, dirId: number, offset: number, limit: number): TreemapFile[] {
  const rows = db
    .prepare(
      `SELECT n.name, f.size, f.uid, o.username
         FROM detail_files f
         JOIN detail_file_names n ON n.id = f.name_id
    LEFT JOIN treemap_owners o ON o.uid = f.uid
        WHERE f.dir_id = ?
        ORDER BY f.size DESC, n.name ASC
        LIMIT ? OFFSET ?`,
    )
    .all(dirId, limit, offset) as {
    name: string
    size: number
    uid: number
    username: string | null
  }[]

  return rows.map((r) => ({
    name: r.name,
    size: r.size,
    owner: r.username ?? `uid-${r.uid}`,
  }))
}

function toNode(r: ChildRow | NodeRow, hasChildren: boolean): TreemapNode {
  return {
    id: r.id,
    name: r.name,
    size: r.total_size,
    fileCount: r.file_count,
    dirCount: r.dir_count,
    owner: r.username ?? `uid-${r.owner_uid}`,
    hasChildren,
    hasFiles: r.has_files === 1,
  }
}

/**
 * Which of `ids` actually have rows pointing at them as parent.
 *
 * `dir_count` cannot answer this. The scanner counts subdirectories while
 * walking, but `report_pipeline.rs` only *emits* treemap rows down to
 * `max_level`, and it does not adjust `dir_count` on the deepest kept row. So
 * every node at the depth cap advertises children it has no rows for — 1,080 of
 * them on the report this was measured against, all at depth 20. Trusting
 * `dir_count` made each one look drillable and open onto an empty level.
 *
 * One statement covers a whole page: each id is an index seek on
 * ix_treemap_dirs_parent_size, so this is ~60 lookups, not a scan.
 */
function idsWithChildren(db: Database.Database, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set()
  const holes = ids.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT DISTINCT parent_id AS p FROM treemap_dirs WHERE parent_id IN (${holes})`)
    .all(...ids) as { p: number }[]
  return new Set(rows.map((r) => r.p))
}


/**
 * Path from the scan root down to `id`, root first. Walks the parent chain with a
 * recursive CTE — bounded by tree depth, measured at 13ms for a depth-20 node.
 */
function breadcrumbs(db: Database.Database, id: number): TreemapCrumb[] {
  const rows = db
    .prepare(
      `WITH RECURSIVE up(id, parent_id, name_id, depth) AS (
         SELECT id, parent_id, name_id, 0 FROM treemap_dirs WHERE id = ?
         UNION ALL
         SELECT d.id, d.parent_id, d.name_id, up.depth + 1
           FROM treemap_dirs d JOIN up ON d.id = up.parent_id
       )
       SELECT up.id, n.name, up.depth
         FROM up JOIN treemap_names n ON n.id = up.name_id
        ORDER BY up.depth DESC`,
    )
    .all(id) as { id: number; name: string; depth: number }[]

  return rows.map((r) => ({ id: r.id, name: r.name }))
}

export interface LevelOptions {
  /** How many children to skip — the "Load more" cursor. */
  childOffset?: number
  /** Include files sitting directly in this directory. */
  withFiles?: boolean
  /** How many files to skip. */
  fileOffset?: number
  /**
   * Rows per page, for each of children and files.
   *
   * The client sends this because only the client knows how tall its list box is,
   * and a page taller than the box would scroll off screen. Clamped to CHILD_LIMIT.
   */
  limit?: number
}

/**
 * One level of the tree: the node itself, its path, its largest children, and
 * optionally the files directly inside it.
 *
 * Returns null when the id does not exist (a stale link after a rescan).
 */
export function readTreemapLevel(
  db: Database.Database,
  parentId: number | null,
  opts: LevelOptions = {},
): TreemapLevel | null {
  const { childOffset = 0, withFiles = false, fileOffset = 0 } = opts
  // Clamp rather than trust: a client asking for 100,000 children would build a
  // page nothing can render.
  const pageSize = Math.max(1, Math.min(CHILD_LIMIT, opts.limit ?? CHILD_LIMIT))

  const id = parentId ?? rootId(db)
  if (id === null) return null

  const node = readNode(db, id)
  if (!node) return null

  // One extra row tells us whether more pages exist without a COUNT(*).
  const rows = db
    .prepare(
      `SELECT d.id, n.name, d.total_size, d.file_count, d.dir_count,
              d.owner_uid, o.username, d.has_files
         FROM treemap_dirs d
         JOIN treemap_names n ON n.id = d.name_id
    LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
        WHERE d.parent_id = ?
        ORDER BY d.total_size DESC, n.name ASC
        LIMIT ? OFFSET ?`,
    )
    .all(id, pageSize + 1, childOffset) as ChildRow[]

  const shown = rows.slice(0, pageSize)
  const withChildren = idsWithChildren(db, shown.map((r) => r.id))
  const children = shown.map((r) => toNode(r, withChildren.has(r.id)))
  const truncated = rows.length > pageSize

  // Size under this node not covered by the children returned *so far*: the
  // unfetched tail plus this directory's own files. The treemap needs it so the
  // rectangles fill the parent honestly instead of overstating each tile.
  const coveredSize = shown.reduce((sum, r) => sum + r.total_size, 0)
  const remainder = node.total_size - coveredSize - childOffsetSize(db, id, childOffset)

  // Total bytes of the files sitting directly in this directory (no recursion).
  // This is what the list's `[files]` row shows; `remainder` also carries the
  // unloaded children's bytes, which would make a small direct count look
  // recursive.
  //
  // Summing detail_files is the only method that stays correct at the treemap's
  // depth cap. Subtracting the children's subtree sizes from node.total_size
  // agrees with the exact sum wherever the children are all present (checked on
  // 400 nodes, 400 matches), but below the cap there are no child rows to
  // subtract, so the whole truncated subtree lands in "files directly here" —
  // 312 MB overstated across 815 nodes on the measured report.
  //
  // The earlier comment here claimed a SUM over detail_files would scan the
  // table. It does not: with no dir_id index SQLite skip-scans the covering
  // index (uid, size DESC, dir_id, name_id) over the handful of distinct uids,
  // planned as `SEARCH detail_files USING COVERING INDEX ... (dir_id=?)` and
  // measured at 7ms. `has_files` is exact, so pure containers skip it entirely.
  const filesSize =
    node.has_files === 1
      ? ((db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM detail_files WHERE dir_id = ?').get(id) as { s: number })
          .s ?? 0)
      : 0

  // has_files is exact, so skip the file query entirely when there are none —
  // detail_files has no dir_id index and the skip-scan is not free.
  const files = withFiles && node.has_files === 1 ? readFiles(db, id, fileOffset, pageSize) : []

  return {
    node: toNode(node, childOffset > 0 || rows.length > 0),
    path: breadcrumbs(db, id),
    children,
    files,
    fileTotal: node.file_count,
    remainder: remainder > 0 ? remainder : 0,
    filesSize,
    truncated,
    childOffset: childOffset + children.length,
    // Same depth-cap caveat as hasChildren: dir_count is the number of
    // subdirectories the *walk* saw, and the treemap keeps rows only down to
    // max_level. On a node at the cap it would render as "showing 0 of 12" over
    // an empty list, so report what the report can actually produce.
    childTotal: childOffset === 0 && rows.length === 0 ? 0 : node.dir_count,
  }
}

/**
 * Total size of the children already skipped past. Needed so `remainder` stays
 * correct on later pages — without it page 2 would claim page 1's bytes as
 * unaccounted-for.
 */
function childOffsetSize(db: Database.Database, id: number, offset: number): number {
  if (offset <= 0) return 0
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total_size), 0) AS s FROM (
         SELECT d.total_size
           FROM treemap_dirs d
           JOIN treemap_names n ON n.id = d.name_id
          WHERE d.parent_id = ?
          ORDER BY d.total_size DESC, n.name ASC
          LIMIT ?
       )`,
    )
    .get(id, offset) as { s: number }
  return row.s
}
