// Queries backing the Inodes tab.
//
// Inodes are the count side of the same story the byte charts tell, and they come
// from the same two places:
//   - hist_snapshots.inodes_*  = the filesystem's own figures (statvfs at scan
//                                time), so whole-filesystem, not scan-root
//   - detail_users             = per-user counts the walk attributed, one row per
//                                account
//
// The inode columns were added to hist_snapshots after it shipped, so a report
// written by an older duscan has the table but not the columns. Probing for them
// lets the tab render the per-user breakdown (which every report has) and say the
// system figures need a rescan, instead of failing the whole request on a missing
// column.
//
// Both queries are O(snapshots) and O(users) — never over detail_files.

import type Database from 'better-sqlite3'
import type { InodeStats, InodeUser } from '../../../shared/api.js'

/**
 * Cap on the accounts returned.
 *
 * The tab renders a card per user, so a report with thousands of service accounts
 * would ship thousands of cards nobody scrolls to. Ordered by count, so the
 * accounts anyone is looking for are in the first page.
 */
export const INODE_USER_LIMIT = 500

/** Whether this report's hist_snapshots carries the inode columns. */
export function hasInodeColumns(db: Database.Database): boolean {
  const rows = db.prepare('PRAGMA table_info(hist_snapshots)').all() as { name: string }[]
  return rows.some((r) => r.name === 'inodes_total')
}

interface SystemRow {
  scanned_at: number | null
  inodes_total: number | null
  inodes_used: number | null
  inodes_free: number | null
  inodes_scanned: number | null
}

/**
 * Per-user inode counts from the current scan, largest first.
 *
 * `total_files` is exactly what legacy's inode report carried per user: the count
 * of files the walk attributed to that uid. Directories come along because they
 * consume inodes too and the number is already in the row.
 */
function readUsers(db: Database.Database): InodeUser[] {
  const rows = db
    .prepare(
      `SELECT username, total_files, total_dirs
         FROM detail_users
        WHERE total_files > 0 OR total_dirs > 0
        ORDER BY total_files DESC, total_dirs DESC, username ASC
        LIMIT ?`,
    )
    .all(INODE_USER_LIMIT) as { username: string; total_files: number; total_dirs: number }[]

  return rows.map((r) => ({
    name: r.username,
    inodes: r.total_files,
    dirs: r.total_dirs,
  }))
}

/**
 * Newest snapshot, with its inode figures when the report has them.
 *
 * The newest snapshot is picked by scan_date to match every other query here.
 * The inode columns are selected only when they exist, so a report that predates
 * them still yields its timestamp — the tab dates the per-user breakdown from it,
 * and "no snapshot" would be a lie about a report that has several.
 *
 * A snapshot can also carry NULL inodes with the columns present: that is a scan
 * written before the migration widened the table.
 */
function readSystem(db: Database.Database): SystemRow | null {
  const inodeCols = hasInodeColumns(db)
    ? 'inodes_total, inodes_used, inodes_free, inodes_scanned'
    : 'NULL AS inodes_total, NULL AS inodes_used, NULL AS inodes_free, NULL AS inodes_scanned'
  const row = db
    .prepare(
      `SELECT scanned_at, ${inodeCols}
         FROM hist_snapshots
        ORDER BY scan_date DESC
        LIMIT 1`,
    )
    .get() as SystemRow | undefined
  return row ?? null
}

/**
 * A filesystem with no fixed inode table reports f_files = 0, which duscan
 * records verbatim. Report that as null so the client says "not reported" rather
 * than drawing a 100%-used bar off a zero denominator.
 */
function positiveOrNull(n: number | null): number | null {
  return n === null || n <= 0 ? null : n
}

/** Assemble the Inodes payload for one target. */
export function readInodeStats(db: Database.Database): InodeStats {
  const users = readUsers(db)
  const row = readSystem(db)

  // The scan's own count is the one figure that does not depend on statvfs, so
  // fall back to summing the per-user rows when the snapshot has none. That sum
  // covers files and dirs the walk attributed, which is what an older report can
  // still answer.
  const attributed = users.reduce((sum, u) => sum + u.inodes + u.dirs, 0)

  if (row === null || row.inodes_total === null) {
    return {
      total: null,
      used: null,
      free: null,
      scanned: row?.inodes_scanned ?? attributed,
      timestamp: row?.scanned_at ?? 0,
      systemAvailable: false,
      users,
    }
  }

  return {
    total: positiveOrNull(row.inodes_total),
    used: positiveOrNull(row.inodes_used),
    free: positiveOrNull(row.inodes_free),
    scanned: row.inodes_scanned ?? attributed,
    timestamp: row.scanned_at ?? 0,
    systemAvailable: true,
    users,
  }
}
