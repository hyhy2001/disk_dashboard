// HTTP surface. Every handler returns the shared {status, data} envelope so the
// client branches on one field regardless of which endpoint failed.

import type { FastifyInstance, FastifyReply } from 'fastify'
import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createGzip } from 'node:zlib'
import type {
  ApiResponse,
  DetailFilter,
  DetailUser,
  HealthInfo,
  HistorySeries,
  InodeStats,
  Overview,
  PermPage,
  ScanStatus,
  SearchResult,
  Target,
  TargetGroup,
  TreemapLevel,
  UserDetail,
} from '../../../shared/api.js'
import {
  isSafeTargetName,
  openTargetReport,
  diskPath,
  openReportAt,
  readCapacity,
  readMeta,
  REPORT_FILE,
} from '../db/reports.js'
import { assignAdminTeams, readOverview, USER_LIMIT } from '../db/overview.js'
import { readTreemapLevel } from '../db/treemap.js'
import { getPublicConfig } from '../db/admin.js'
import { findUid, listUsers, readUserDetail, streamUserListCsv } from '../db/detail.js'
import { readPermIssues } from '../db/perms.js'
import { readHistorySeries } from '../db/history.js'
import { readInodeStats } from '../db/inodes.js'
import { searchNames } from '../db/search.js'
import { readScanStatusAtAsync } from '../db/status.js'
import { listDiskTeams, diskBySlug } from '../db/admin.js'

function ok<T>(data: T): ApiResponse<T> {
  return { status: 'success', data }
}

function fail(reply: FastifyReply, code: number, message: string): ApiResponse<never> {
  reply.code(code)
  return { status: 'error', message }
}

/**
 * Targets with an export stream in flight. Exports are large and CPU-heavy
 * (sqlite iteration + gzip), and the report endpoints are unauthenticated by
 * design, so without a cap anyone could stack unlimited concurrent exports per
 * target. One stream per target at a time is generous and stops the abuse.
 */
const activeExports = new Set<string>()

/**
 * Whether this SQLite build can do infix search (FTS5 + trigram tokenizer).
 *
 * Probing requires opening a fresh in-memory database, so the result is computed
 * once and cached: `/api/health` is polled on every page load and has no reason
 * to re-create a database each time.
 */
let trigramCached: boolean | null = null
function detectTrigram(): boolean {
  if (trigramCached !== null) return trigramCached
  const db = new Database(':memory:')
  try {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')")
    trigramCached = true
  } catch {
    trigramCached = false
  } finally {
    db.close()
  }
  return trigramCached
}

/** SQLite version, cached for the same reason as detectTrigram. */
let sqliteVersionCached: string | null = null
function sqliteVersion(): string {
  if (sqliteVersionCached !== null) return sqliteVersionCached
  const db = new Database(':memory:')
  try {
    const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string }
    sqliteVersionCached = row.v
  } finally {
    db.close()
  }
  return sqliteVersionCached ?? 'unknown'
}

/**
 * Split a comma-or-tab separated filter field into terms.
 *
 * Legacy accepted both separators in its tag inputs, and pasting a column out of a
 * spreadsheet yields tabs, so both are honoured. Empty terms are dropped so a
 * trailing comma does not become a match-everything term.
 */
function splitTerms(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,\t\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** Parse a byte-size query param. Returns undefined for absent or invalid input. */
function sizeParam(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.floor(n)
}

/** Build a DetailFilter from query params, omitting fields the caller left out. */
function detailFilterFrom(q: { query?: string; ext?: string; minSize?: string; maxSize?: string }): DetailFilter {
  const query = splitTerms(q.query)
  const ext = splitTerms(q.ext)
  const minSize = sizeParam(q.minSize)
  const maxSize = sizeParam(q.maxSize)
  return {
    ...(query.length > 0 ? { query } : {}),
    ...(ext.length > 0 ? { ext } : {}),
    ...(minSize !== undefined ? { minSize } : {}),
    ...(maxSize !== undefined ? { maxSize } : {}),
  }
}

/** Strip characters that are awkward in a filename. */
function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'export'
}

/** A timestamp suffix for export filenames: 20260727_143022. */
function fileStamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/**
 * Apply teams from admin.db to the overview, overriding report.db team assignments.
 * This lets the admin Group Config control team → user mapping in the dashboard.
 *
 * Team totals must come from the FULL user set, not overview.users/otherUsers —
 * those are each capped at USER_LIMIT, so on a disk with more accounts than the
 * cap, any admin-team member beyond it would silently vanish from the rollup.
 */
function applyAdminTeams(db: Database.Database, slug: string, overview: Overview): Overview {
  try {
    const disk = diskBySlug(slug)
    if (!disk) return overview

    const adminTeams = listDiskTeams(disk.id)
    if (adminTeams.length === 0) return overview

    // Full, uncapped user list — the authoritative set for team membership.
    const rows = db
      .prepare('SELECT username, total_size FROM detail_users WHERE total_size > 0 ORDER BY total_size DESC')
      .all() as { username: string; total_size: number }[]

    const mapped = assignAdminTeams(rows, adminTeams)

    // Cap only what the UI renders; team totals above already used every user.
    return {
      ...overview,
      teams: mapped.teams,
      users: mapped.users.slice(0, USER_LIMIT),
      otherUsers: mapped.otherUsers.slice(0, USER_LIMIT),
    }
  } catch {
    return overview
  }
}

/**
 * One Target row for a configured disk.
 *
 * A disk whose report.db is missing or unreadable still gets a row — with a zero
 * scanTimestamp and no capacity — so a configured-but-unscanned disk is visible
 * in the sidebar instead of silently vanishing. The zero stamp is the UI's
 * "never scanned" signal (gray dot, "never").
 */
function targetFor(disk: { name: string; slug: string; path: string }): Target {
  const rp = join(disk.path, REPORT_FILE)
  const info = openReportAt(rp)
  const missing: Target = {
    name: disk.name,
    slug: disk.slug,
    scanRoot: disk.path,
    scanTimestamp: 0,
    totalFiles: 0,
    totalDirs: 0,
    totalSize: 0,
    dbSizeBytes: 0,
    capacity: null,
  }
  if (!info) return missing
  try {
    const meta = readMeta(info)
    const cap = readCapacity(info)
    const dbSize = statSync(rp).size
    return {
      name: disk.name,
      slug: disk.slug,
      scanRoot: meta.scan_root ?? disk.path,
      scanTimestamp: Number(meta.scan_timestamp ?? 0),
      totalFiles: Number(meta.total_files ?? 0),
      totalDirs: Number(meta.total_dirs ?? 0),
      totalSize: Number(meta.total_size ?? 0),
      dbSizeBytes: dbSize,
      capacity: cap ?? null,
    }
  } catch {
    return missing
  }
}

/**
 * A stamp of the whole configured set, used as the cache key.
 *
 * Report stamps catch a rescan; names/slugs/order catch admin-config changes
 * (add/remove/rename/reorder), which the report files alone would miss.
 */
function targetsCacheKey(adminCfg: {
  spaces: { name: string; sort_order: number; disks: { name: string; slug: string; path: string; sort_order: number }[] }[]
}): string {
  let key = ''
  for (const space of adminCfg.spaces) {
    key += `s:${space.name}:${space.sort_order}:`
    for (const disk of space.disks) {
      const rp = join(disk.path, REPORT_FILE)
      try {
        const st = statSync(rp)
        // Inode catches a report replaced by a rename that preserves mtime+size;
        // disk.path catches a disk repointed at a different report directory.
        key += `${disk.slug}:${disk.name}:${disk.sort_order}:${st.ino}:${st.mtimeMs}:${st.size}:${disk.path};`
      } catch {
        // A missing report still participates, so a scan landing later refreshes
        // the cache instead of reusing a stale "no report" list.
        key += `${disk.slug}:${disk.name}:${disk.sort_order}:none:${disk.path};`
      }
    }
  }
  return key
}

interface TargetsCache {
  key: string
  targets: Target[]
}

let targetsCache: TargetsCache | null = null

/**
 * Every configured disk that has a readable report, cached by report stamp.
 *
 * The expensive part of /api/targets and /api/groups is opening each report.db
 * and reading its meta and capacity — per-disk SQLite work that both endpoints
 * repeated on every request. Reports only change when duscan replaces a file, so
 * the assembled list is reused until any report's mtime/size moves or the disk
 * set changes (both of which alter the key).
 */
function configuredTargets(adminCfg: ReturnType<typeof getPublicConfig>): Target[] {
  const key = targetsCacheKey(adminCfg)
  if (targetsCache && targetsCache.key === key) return targetsCache.targets

  const targets: Target[] = []
  for (const space of adminCfg.spaces) {
    for (const disk of space.disks) {
      targets.push(targetFor(disk))
    }
  }
  targetsCache = { key, targets }
  return targets
}

export function registerApi(app: FastifyInstance): void {
  app.get('/api/health', async (): Promise<ApiResponse<HealthInfo>> => {
    const adminCfg = getPublicConfig()
    const diskCount = adminCfg.spaces.reduce((s, sp) => s + sp.disks.length, 0)
    return ok<HealthInfo>({
      ok: true,
      sqliteVersion: sqliteVersion(),
      trigramAvailable: detectTrigram(),
      reportsDir: '(admin DB)',
      reportsDirExists: true,
      targetsFound: diskCount,
      groupConfigLoaded: adminCfg.spaces.length > 0,
      needsSetup: adminCfg.needsSetup,
    })
  })

  app.get('/api/targets', async (): Promise<ApiResponse<Target[]>> => {
    return ok(configuredTargets(getPublicConfig()))
  })

  // Targets arranged into groups for the Team → Disk sidebar.
  app.get('/api/groups', async (): Promise<ApiResponse<TargetGroup[]>> => {
    const adminCfg = getPublicConfig()
    const bySlug = new Map(configuredTargets(adminCfg).map((t) => [t.slug, t]))
    const groups: TargetGroup[] = []
    for (const space of adminCfg.spaces) {
      const members = space.disks.map((d) => bySlug.get(d.slug)).filter((t): t is Target => t !== undefined)
      if (members.length > 0) groups.push({ name: space.name, targets: members })
    }
    return ok(groups)
  })

  app.get<{ Params: { target: string } }>(
    '/api/overview/:target',
    async (request, reply): Promise<ApiResponse<Overview>> => {
      const { target } = request.params
      if (!isSafeTargetName(target)) {
        return fail(reply, 400, 'invalid target name')
      }

      const db = openTargetReport(target)
      if (!db) {
        return fail(reply, 404, `no report found for target '${target}'`)
      }

      // The slug is the route id; the display name comes from the admin DB so a
      // renamed disk still shows its current name in the header.
      const disk = diskBySlug(target)

      // readOverview needs a Target row; build one from meta.
      const meta = readMeta(db)
      const row: Target = {
        name: disk?.name ?? target,
        slug: target,
        scanRoot: meta.scan_root ?? '',
        scanTimestamp: Number(meta.scan_timestamp) || 0,
        totalFiles: Number(meta.total_files) || 0,
        totalDirs: Number(meta.total_dirs) || 0,
        totalSize: Number(meta.total_size) || 0,
        dbSizeBytes: 0,
        capacity: readCapacity(db),
      }

      return ok(applyAdminTeams(db, target, readOverview(db, row)))
    },
  )

  // One level of the treemap. `parent` omitted means the scan root; the client
  // drills by passing the id of the node it wants to open.
  app.get<{
    Params: { target: string }
    Querystring: {
      parent?: string
      childAfterSize?: string
      childAfterName?: string
      childSkippedSize?: string
      fileOffset?: string
      files?: string
      limit?: string
    }
  }>('/api/treemap/:target', async (request, reply): Promise<ApiResponse<TreemapLevel>> => {
    const { target } = request.params
    if (!isSafeTargetName(target)) {
      return fail(reply, 400, 'invalid target name')
    }

    /** Parse a non-negative integer query param, or null when absent. */
    const intParam = (raw: string | undefined): number | null | 'bad' => {
      if (raw === undefined || raw === '') return null
      const n = Number(raw)
      // Anything else is a malformed link rather than a missing node, so
      // reject instead of silently falling back to a default.
      if (!Number.isInteger(n) || n < 0) return 'bad'
      return n
    }

    const parent = intParam(request.query.parent)
    if (parent === 'bad') return fail(reply, 400, 'parent must be a non-negative integer')

    // Keyset cursor: the (size, name) of the last child the client already has.
    // A name alone is not a cursor, so require both halves together.
    const childAfterSize = intParam(request.query.childAfterSize)
    if (childAfterSize === 'bad') {
      return fail(reply, 400, 'childAfterSize must be a non-negative integer')
    }
    const childAfterName = request.query.childAfterName
    const childAfter = childAfterSize !== null && childAfterName ? { size: childAfterSize, name: childAfterName } : null

    const childSkippedSize = intParam(request.query.childSkippedSize)
    if (childSkippedSize === 'bad') {
      return fail(reply, 400, 'childSkippedSize must be a non-negative integer')
    }

    const fileOffset = intParam(request.query.fileOffset)
    if (fileOffset === 'bad') {
      return fail(reply, 400, 'fileOffset must be a non-negative integer')
    }

    const db = openTargetReport(target)
    if (!db) {
      return fail(reply, 404, `no report found for target '${target}'`)
    }

    // sizeParam drops an unusable value rather than failing: a bad limit is a
    // display preference, and defaulting it is friendlier than a 400.
    const limit = sizeParam(request.query.limit)

    const level = readTreemapLevel(db, parent, {
      childAfter,
      childSkippedSize: childSkippedSize ?? 0,
      // Files cost an extra skip-scan, so the client opts in.
      withFiles: request.query.files === '1',
      fileOffset: fileOffset ?? 0,
      ...(limit !== undefined ? { limit } : {}),
    })
    if (!level) {
      return fail(reply, 404, 'directory not found in this report')
    }
    return ok(level)
  })

  /**
   * Open a target's report, or produce the error response for it.
   *
   * Every per-target route needs the same two guards — a name that cannot escape
   * the reports directory, and a report that exists — so they share one helper
   * rather than repeating the pair five times.
   */
  const withReport = (
    target: string,
    reply: FastifyReply,
  ): { db: import('better-sqlite3').Database } | { err: ApiResponse<never> } => {
    if (!isSafeTargetName(target)) return { err: fail(reply, 400, 'invalid target name') }
    const db = openTargetReport(target)
    if (!db) return { err: fail(reply, 404, `no report found for target '${target}'`) }
    return { db }
  }

  // Every account in the report, for the Detail User picker.
  app.get<{ Params: { target: string } }>(
    '/api/users/:target',
    async (request, reply): Promise<ApiResponse<DetailUser[]>> => {
      const opened = withReport(request.params.target, reply)
      if ('err' in opened) return opened.err
      return ok(listUsers(opened.db))
    },
  )

  // One user's directories and files. Cursors are opaque; the client echoes back
  // whatever the previous page returned.
  app.get<{
    Params: { target: string; user: string }
    Querystring: {
      dirCursor?: string
      fileCursor?: string
      limit?: string
      query?: string
      ext?: string
      minSize?: string
      maxSize?: string
    }
  }>('/api/detail/:target/:user', async (request, reply): Promise<ApiResponse<UserDetail>> => {
    const opened = withReport(request.params.target, reply)
    if ('err' in opened) return opened.err

    // The username comes from the URL path, so it arrives percent-decoded by
    // Fastify but may still be any string; it is only ever used as a bound
    // parameter, never interpolated.
    const user = request.params.user
    const uid = findUid(opened.db, user)
    if (uid === null) return fail(reply, 404, `no such user '${user}' in this report`)

    const limit = sizeParam(request.query.limit)
    return ok(
      readUserDetail(opened.db, user, uid, {
        ...(request.query.dirCursor !== undefined ? { dirCursor: request.query.dirCursor } : {}),
        ...(request.query.fileCursor !== undefined ? { fileCursor: request.query.fileCursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
        filter: detailFilterFrom(request.query),
      }),
    )
  })

  /**
   * Streaming CSV export of one user's dirs or files.
   *
   * This is the Detail tab's export path and it deliberately does not go through
   * the {status,data} envelope or the paged queries: a whole-list export written
   * as CSV is a single streaming query instead of a loop of up-to-50k-row pages,
   * and never materialises the multi-megabyte JSON arrays that made exports peg
   * the CPU. The body is the CSV itself (UTF-8, BOM-free), so the browser can
   * save it directly.
   */
  app.get<{
    Params: { target: string; user: string }
    Querystring: {
      kind?: string
      query?: string
      ext?: string
      minSize?: string
      maxSize?: string
    }
  }>('/api/export/:target/:user', async (request, reply): Promise<ApiResponse<never> | void> => {
    const { target } = request.params
    const opened = withReport(target, reply)
    if ('err' in opened) return opened.err

    if (activeExports.has(target)) {
      return fail(reply, 429, 'an export for this target is already running')
    }
    activeExports.add(target)

    const kind = request.query.kind
    if (kind !== 'dirs' && kind !== 'files') {
      activeExports.delete(target)
      return fail(reply, 400, "export kind must be 'dirs' or 'files'")
    }

    const user = request.params.user
    const uid = findUid(opened.db, user)
    if (uid === null) {
      activeExports.delete(target)
      return fail(reply, 404, `no such user '${user}' in this report`)
    }

    const filter = detailFilterFrom(request.query)
    // The dirs list cannot be filtered by extension (readUserDetail suppresses
    // it in the UI for the same reason), so a dirs export with an ext filter
    // would silently drop the constraint. Reject it as the UI does.
    if (kind === 'dirs' && (filter.ext ?? []).length > 0) {
      activeExports.delete(target)
      return fail(reply, 400, 'an extension filter does not apply to a directory export')
    }

    const filename = `${kind}_${safeName(user)}_${fileStamp()}.csv.gz`
    reply
      .code(200)
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'no-store')
    // The CSV is gzipped here rather than on the client so every browser gets a
    // ~10x smaller download: text compresses extremely well, and the old
    // client-side CompressionStream path only ran on Chromium — Firefox/Safari
    // were left with a hundreds-of-MB plain CSV. No Content-Encoding header, so
    // the bytes the browser saves are exactly the .csv.gz archive.
    const stream = Readable.from(streamUserListCsv(opened.db, uid, kind, filter)).pipe(createGzip())
    // Release the per-target lock when the stream finishes, errors, or the
    // client disconnects.
    stream.on('close', () => activeExports.delete(target))
    stream.on('error', () => activeExports.delete(target))
    return reply.send(stream)
  })

  // Permission issues, offset-paginated because the UI shows numbered pages.
  app.get<{
    Params: { target: string }
    Querystring: {
      offset?: string
      limit?: string
      users?: string
      itemType?: string
      path?: string
    }
  }>('/api/permissions/:target', async (request, reply): Promise<ApiResponse<PermPage>> => {
    const opened = withReport(request.params.target, reply)
    if ('err' in opened) return opened.err

    const users = splitTerms(request.query.users)
    const itemType = request.query.itemType
    const path = request.query.path
    const offset = sizeParam(request.query.offset)
    const limit = sizeParam(request.query.limit)

    return ok(
      readPermIssues(opened.db, {
        ...(users.length > 0 ? { users } : {}),
        // Anything other than the two known values is a malformed link; ignore
        // it rather than returning an empty list that looks like "no issues".
        ...(itemType === 'file' || itemType === 'directory' ? { itemType } : {}),
        ...(path !== undefined && path !== '' ? { path } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    )
  })

  // Whole-target timeline plus one series per user, for the History tab.
  app.get<{ Params: { target: string } }>(
    '/api/history/:target',
    async (request, reply): Promise<ApiResponse<HistorySeries>> => {
      const opened = withReport(request.params.target, reply)
      if ('err' in opened) return opened.err
      return ok(readHistorySeries(opened.db))
    },
  )

  // Inode usage: the filesystem's own figures plus the per-user breakdown.
  app.get<{ Params: { target: string } }>(
    '/api/inodes/:target',
    async (request, reply): Promise<ApiResponse<InodeStats>> => {
      const opened = withReport(request.params.target, reply)
      if ('err' in opened) return opened.err
      return ok(readInodeStats(opened.db))
    },
  )

  // Name search across directories and files.
  app.get<{
    Params: { target: string }
    Querystring: { q?: string; kind?: string; limit?: string }
  }>('/api/search/:target', async (request, reply): Promise<ApiResponse<SearchResult>> => {
    const opened = withReport(request.params.target, reply)
    if ('err' in opened) return opened.err

    const kind = request.query.kind
    const limit = sizeParam(request.query.limit)
    return ok(
      searchNames(opened.db, request.query.q ?? '', {
        ...(kind === 'dir' || kind === 'file' ? { kind } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    )
  })

  // Report freshness. Polled, so it must stay a stat() plus one small read — no
  // caching header is set because a cached response would defeat the point.
  app.get<{ Params: { target: string } }>(
    '/api/status/:target',
    async (request, reply): Promise<ApiResponse<ScanStatus>> => {
      const { target } = request.params
      if (!isSafeTargetName(target)) return fail(reply, 400, 'invalid target name')
      const dir = diskPath(target)
      if (!dir) return fail(reply, 404, `no disk configured for target '${target}'`)
      const status = await readScanStatusAtAsync(join(dir, REPORT_FILE), dir)
      if (!status) return fail(reply, 404, `no report found for target '${target}'`)
      reply.header('cache-control', 'no-store')
      return ok(status)
    },
  )

  // Freshness for every configured target at once, so the disk column can show a
  // per-card scan indicator with one poll per interval instead of one request per
  // card. Same cost model as the single-target route: stat() plus one small read.
  app.get('/api/statuses', async (_request, reply): Promise<ApiResponse<ScanStatus[]>> => {
    const disks = getPublicConfig().spaces.flatMap((space) => space.disks)
    // One poll covers every disk, so read them concurrently rather than letting a
    // slow (or network-mounted) report directory serialise the rest.
    const read = await Promise.all(
      disks.map(async (disk) => ({
        slug: disk.slug,
        status: await readScanStatusAtAsync(join(disk.path, REPORT_FILE), disk.path),
      })),
    )
    const statuses: ScanStatus[] = []
    for (const { slug, status } of read) {
      if (!status) continue
      // readScanStatusAtAsync names the target from the directory basename; the
      // card keys on the admin-DB route slug, so overwrite it.
      statuses.push({ ...status, target: slug })
    }
    reply.header('cache-control', 'no-store')
    return ok(statuses)
  })
}
