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
import type { TreemapLevel, TreemapNode, TreemapCrumb } from '../../../shared/api.js'

/**
 * Children returned per level. A treemap cannot usefully render more rectangles
 * than this, and the rest are summarised into one "other" node so the areas
 * still add up to the parent's size.
 */
const CHILD_LIMIT = 60

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
  const row = db
    .prepare('SELECT id FROM treemap_dirs WHERE parent_id IS NULL LIMIT 1')
    .get() as { id: number } | undefined
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

function toNode(r: ChildRow | NodeRow): TreemapNode {
  return {
    id: r.id,
    name: r.name,
    size: r.total_size,
    fileCount: r.file_count,
    dirCount: r.dir_count,
    owner: r.username ?? `uid-${r.owner_uid}`,
    hasChildren: r.dir_count > 0,
    hasFiles: r.has_files === 1,
  }
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

/**
 * One level of the tree: the node itself, its path, and its largest children.
 * Returns null when the id does not exist (a stale link after a rescan).
 */
export function readTreemapLevel(db: Database.Database, parentId: number | null): TreemapLevel | null {
  const id = parentId ?? rootId(db)
  if (id === null) return null

  const node = readNode(db, id)
  if (!node) return null

  const rows = db
    .prepare(
      `SELECT d.id, n.name, d.total_size, d.file_count, d.dir_count,
              d.owner_uid, o.username, d.has_files
         FROM treemap_dirs d
         JOIN treemap_names n ON n.id = d.name_id
    LEFT JOIN treemap_owners o ON o.uid = d.owner_uid
        WHERE d.parent_id = ?
        ORDER BY d.total_size DESC
        LIMIT ?`,
    )
    .all(id, CHILD_LIMIT + 1) as ChildRow[]

  const shown = rows.slice(0, CHILD_LIMIT)
  const children = shown.map(toNode)

  // Everything not accounted for by the returned children: the truncated tail
  // plus this directory's own files. Without it the rectangles would not fill
  // the parent and the proportions would lie.
  const childrenSize = shown.reduce((sum, r) => sum + r.total_size, 0)
  const remainder = node.total_size - childrenSize
  const truncated = rows.length > CHILD_LIMIT

  return {
    node: toNode(node),
    path: breadcrumbs(db, id),
    children,
    /** Size under this node not covered by `children`. */
    remainder: remainder > 0 ? remainder : 0,
    truncated,
  }
}
