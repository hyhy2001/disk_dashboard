// Discovery and read access for duscan report.db files.
//
// report.db is self-describing: a `meta` key/value table plus the detail_*,
// treemap_* and hist_* tables. Nothing from the duscan binary is needed to read
// it, so this module only depends on SQLite and the schema.
//
// Connections are opened readonly and cached per target. duscan builds each
// report into a temp file and rename()s it into place, so a reader either sees
// the whole previous file or the whole new one — never a half-written DB. The
// tradeoff is that a cached handle keeps pointing at the *old* inode after a
// rescan, so we stat the file and reopen when it changes.

import Database from 'better-sqlite3'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import type { Capacity, Target } from '../../../shared/api.js'
import { adminDb } from './admin.js'

export const REPORT_FILE = 'report.db'

/**
 * Report schema generation this dashboard's queries are written against.
 *
 * duscan stamps `meta.schema_version` (core/src/report_pipeline.rs) and the merge
 * carries it into report.db via `INSERT OR IGNORE INTO meta SELECT ... FROM
 * srcdetail.meta`. That makes the meta row the only dependable gate: the
 * `user_version` pragma is set by stamp_db(), which merge_into_single_db never
 * calls, and `application_id` is only written when open_merged_db creates the
 * file. Both read 0 / stale on real reports — verified against the reports on
 * this host.
 *
 * Generation 2 added detail_users.owned_dirs (the precomputed count of
 * directories a user owns). Reading a generation-1 report stays correct: the
 * dirs list probes for the column and falls back to counting when it is absent,
 * so this bump does not strand reports written before the column existed.
 */
export const SUPPORTED_SCHEMA_VERSION = 2

/**
 * Whether a report's schema generation is one this build understands.
 *
 * A *newer* report is the case worth catching: added columns are harmless, but a
 * renamed or re-meaning column would make the queries return confidently wrong
 * numbers rather than fail. A missing or unparseable value is treated as
 * compatible, because reports written before the key existed are still readable.
 */
export function isSupportedSchema(version: string | undefined): boolean {
  if (version === undefined) return true
  const n = Number(version)
  return !Number.isFinite(n) || n <= SUPPORTED_SCHEMA_VERSION
}

interface CachedDb {
  db: Database.Database
  /** Identity of the file this handle was opened on — see stampOf. */
  stamp: string
}

const cache = new Map<string, CachedDb>()
/** Same cache keyed by absolute report.db path, used by openReportAt/openTargetReport. */
const pathCache = new Map<string, CachedDb>()

/**
 * Fingerprint identifying *which* report.db a handle is open on.
 *
 * The inode is the load-bearing part. duscan builds into a temp file and
 * rename()s it over report.db, so the replacement is a different inode — but
 * mtimeMs and size can both repeat across a swap (SQLite sizes are page-aligned,
 * and two scans finishing in the same millisecond is not exotic on a fast box).
 * On an mtime+size-only stamp such a swap looks like "no change", and the cached
 * handle keeps serving the unlinked old inode forever, with no visible staleness.
 * Comparing st.ino makes a replaced file always compare unequal.
 */
export function stampOf(path: string): string {
  const s = statSync(path)
  return `${s.ino}:${s.mtimeMs}:${s.size}`
}

/** Drop any cached handle for a report path (and for a target name). */
export function evictReport(path: string, target?: string): void {
  const byPath = pathCache.get(path)
  if (byPath) {
    byPath.db.close()
    pathCache.delete(path)
  }
  if (target !== undefined) {
    const byName = cache.get(target)
    if (byName) {
      byName.db.close()
      cache.delete(target)
    }
  }
}

/** Paths already warned about, so one poll per interval does not spam the log. */
const warnedSchemas = new Set<string>()

/**
 * Complain once per report about a schema this build predates.
 *
 * Deliberately a warning and not a skip: hiding a disk from the picker would look
 * like the disk vanished, which is a worse failure than numbers that may be off.
 * The operator gets a line naming the file and both versions.
 */
export function warnIfUnsupportedSchema(path: string, meta: Record<string, string>): void {
  const version = meta.schema_version
  if (isSupportedSchema(version) || warnedSchemas.has(path)) return
  warnedSchemas.add(path)
  process.stderr.write(
    `warn: ${path} has meta.schema_version=${version}, newer than the supported ${SUPPORTED_SCHEMA_VERSION}; ` +
      'figures may be wrong until the dashboard is updated\n',
  )
}

/** Absolute path to a target's report.db (not checked for existence). */
export function reportPath(reportsDir: string, target: string): string {
  return join(reportsDir, target, REPORT_FILE)
}

/**
 * Try to open a report.db at an explicit path (may be outside reportsDir).
 * Returns the DB handle + the target name (derived from the parent dir), or
 * null if the file doesn't exist.
 */
export function openReportAt(path: string): { db: Database.Database; name: string } | null {
  if (!existsSync(path)) return null
  try {
    const name = statSync(path).isDirectory() ? 'unknown' : basename(dirname(path))
    const stamp = stampOf(path)
    const hit = pathCache.get(path)
    if (hit) {
      if (hit.stamp === stamp) return { db: hit.db, name }
      // A rescan replaced the file; drop the stale handle.
      hit.db.close()
      pathCache.delete(path)
    }
    const db = new Database(path, { readonly: true, fileMustExist: true })
    // The scanner writes report.db in WAL mode, so OFF here is only safe because
    // it never writes the live file in place: the merge builds a `.tmp` and
    // rename()s it over this path (disk_scanner core/src/db_writer.rs,
    // merge_into_single_db). What we open is therefore always a complete,
    // quiescent database with nothing left in a `-wal` sidecar to replay. If the
    // scanner ever starts updating report.db in place, this pragma must go —
    // a readonly OFF connection cannot see commits still living in the WAL.
    db.pragma('journal_mode = OFF')
    // Same read-tuning openReport applies: mmap keeps page access cheap on the
    // large detail tables, and a bigger page cache cuts the cold-start cost of
    // a first deep query. openTargetReport goes through here, so the Users tab
    // (root owns 1.4M files) gets the same cache the treemap already had.
    db.pragma('mmap_size = 268435456')
    db.pragma('cache_size = -65536')
    pathCache.set(path, { db, stamp })
    warnIfUnsupportedSchema(path, readMeta(db))
    return { db, name }
  } catch {
    return null
  }
}

/**
 * Reject target names that could escape the reports directory. Target names come
 * from the URL, so a value like `../../etc` must never reach a path join.
 */
export function isSafeTargetName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..'
}

/**
 * Open (or reuse) a readonly handle for a target. Returns null when the target
 * has no report.db yet — a configured target that has never been scanned.
 */
export function openReport(reportsDir: string, target: string): Database.Database | null {
  if (!isSafeTargetName(target)) return null
  const path = reportPath(reportsDir, target)
  if (!existsSync(path)) return null

  const stamp = stampOf(path)
  const hit = cache.get(target)
  if (hit) {
    if (hit.stamp === stamp) return hit.db
    // A rescan replaced the file; drop the stale handle.
    hit.db.close()
    cache.delete(target)
  }

  const db = new Database(path, { readonly: true, fileMustExist: true })
  // Reads only, so durability pragmas are irrelevant; mmap keeps page access
  // cheap on the large detail tables.
  db.pragma('mmap_size = 268435456')
  db.pragma('cache_size = -65536')
  cache.set(target, { db, stamp })
  return db
}

export function closeAll(): void {
  for (const { db } of cache.values()) db.close()
  cache.clear()
  for (const { db } of pathCache.values()) db.close()
  pathCache.clear()
}

/** Read the whole `meta` table into a plain object. */
export function readMeta(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta').all() as {
    key: string
    value: string
  }[]
  const out: Record<string, string> = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

function num(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Filesystem capacity from the newest snapshot.
 *
 * This is the one figure the `meta` table does not carry: meta records what the
 * scan walked, hist_snapshots records what the filesystem reported. Disk cards
 * need the latter to show real fullness rather than share-of-group, so the target
 * list pays for one indexed row per target.
 *
 * Returns null when there is no snapshot, or when the scan could not stat the
 * filesystem (total 0) — a bogus 0/0/0 would render as an empty disk.
 */
export function readCapacity(db: Database.Database): Capacity | null {
  const row = db
    .prepare(
      `SELECT s.total, s.used, s.available,
              COALESCE((SELECT SUM(u.size) FROM hist_user_usage u
                         WHERE u.snapshot_id = s.id), 0) AS scanned
         FROM hist_snapshots s
        ORDER BY s.scan_date DESC
        LIMIT 1`,
    )
    .get() as { total: number | null; used: number | null; available: number | null; scanned: number } | undefined

  if (!row || row.total === null || row.total === 0) return null
  return {
    total: row.total,
    used: row.used ?? 0,
    available: row.available ?? 0,
    scanned: row.scanned,
  }
}

/**
 * List every target that has a readable report.db, newest scan first. Targets
 * whose DB is missing or unreadable are skipped rather than failing the request,
 * so one corrupt report cannot take down the target picker.
 */
export function listTargets(reportsDir: string): Target[] {
  if (!existsSync(reportsDir)) return []
  const out: Target[] = []

  for (const entry of readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeTargetName(entry.name)) continue
    const path = reportPath(reportsDir, entry.name)
    if (!existsSync(path)) continue

    try {
      const db = openReport(reportsDir, entry.name)
      if (!db) continue
      const meta = readMeta(db)
      warnIfUnsupportedSchema(path, meta)
      out.push({
        name: entry.name,
        slug: entry.name,
        scanRoot: meta.scan_root ?? meta.scan_path ?? '',
        scanTimestamp: num(meta.scan_timestamp),
        totalFiles: num(meta.total_files),
        totalDirs: num(meta.total_dirs),
        totalSize: num(meta.total_size),
        dbSizeBytes: statSync(path).size,
        capacity: readCapacity(db),
      })
    } catch {
      continue
    }
  }

  out.sort((a, b) => b.scanTimestamp - a.scanTimestamp)
  return out
}

// ---------------------------------------------------------------------------
// Admin DB disk resolution — replaces hardcoded reportsDir
// ---------------------------------------------------------------------------

/**
 * Look up a disk's path from the admin DB by slug. Returns null if unknown.
 *
 * Slugs are globally unique (a random hex token per disk), so this never
 * ambiguously resolves a duplicate display name — the exact problem name-based
 * lookup had.
 */
export function diskPath(slug: string): string | null {
  try {
    const db = adminDb()
    const row = db.prepare('SELECT path FROM disks WHERE slug = ?').get(slug) as { path: string } | undefined
    return row?.path ?? null
  } catch {
    return null
  }
}

/**
 * Open a target's report.db by slug, resolving the path from the admin DB.
 * Returns null if the disk is unknown or the report doesn't exist.
 */
export function openTargetReport(slug: string): Database.Database | null {
  const path = diskPath(slug)
  if (!path) return null
  const rp = join(path, REPORT_FILE)
  if (!existsSync(rp)) return null
  // openReportAt caches by absolute path (reopening when a rescan replaces the
  // file), so every per-target route reuses one handle instead of leaking a new
  // SQLite connection per request.
  const opened = openReportAt(rp)
  return opened?.db ?? null
}
