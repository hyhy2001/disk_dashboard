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
import { join } from 'node:path'
import type { Capacity, Target } from '../../../shared/api.js'

export const REPORT_FILE = 'report.db'

interface CachedDb {
  db: Database.Database
  /** mtimeMs + size of the file this handle was opened on. */
  stamp: string
}

const cache = new Map<string, CachedDb>()

function stampOf(path: string): string {
  const s = statSync(path)
  return `${s.mtimeMs}:${s.size}`
}

/** Absolute path to a target's report.db (not checked for existence). */
export function reportPath(reportsDir: string, target: string): string {
  return join(reportsDir, target, REPORT_FILE)
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
    .get() as
    | { total: number | null; used: number | null; available: number | null; scanned: number }
    | undefined

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
      out.push({
        name: entry.name,
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
