// HTTP surface. Every handler returns the shared {status, data} envelope so the
// client branches on one field regardless of which endpoint failed.

import type { FastifyInstance, FastifyReply } from 'fastify'
import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
import { join } from 'node:path'
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
  UsageRow,
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
import { readOverview } from '../db/overview.js'
import { readTreemapLevel } from '../db/treemap.js'
import { getPublicConfig } from '../db/admin.js'
import { findUid, listUsers, readUserDetail } from '../db/detail.js'
import { readPermIssues } from '../db/perms.js'
import { readHistorySeries } from '../db/history.js'
import { readInodeStats } from '../db/inodes.js'
import { searchNames } from '../db/search.js'
import { readScanStatusAt } from '../db/status.js'
import { listDiskTeams, diskBySlug } from '../db/admin.js'

function ok<T>(data: T): ApiResponse<T> {
  return { status: 'success', data }
}

function fail(reply: FastifyReply, code: number, message: string): ApiResponse<never> {
  reply.code(code)
  return { status: 'error', message }
}

/** Whether this SQLite build can do infix search (FTS5 + trigram tokenizer). */
function detectTrigram(): boolean {
  const db = new Database(':memory:')
  try {
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')")
    return true
  } catch {
    return false
  } finally {
    db.close()
  }
}

function sqliteVersion(): string {
  const db = new Database(':memory:')
  try {
    const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string }
    return row.v
  } finally {
    db.close()
  }
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

/**
 * Apply teams from admin.db to the overview, overriding report.db team assignments.
 * This lets the admin Group Config control team → user mapping in the dashboard.
 */
function applyAdminTeams(slug: string, overview: Overview): Overview {
  try {
    const disk = diskBySlug(slug)
    if (!disk) return overview

    const adminTeams = listDiskTeams(disk.id)
    if (adminTeams.length === 0) return overview

    // Build user → team lookup from admin teams
    const userTeam = new Map<string, string>()
    for (const t of adminTeams) {
      for (const u of t.users) userTeam.set(u.toLowerCase(), t.name)
    }

    // Remap users: if user has an admin team, move them to teams; else to otherUsers
    const teamUsage = new Map<string, number>()
    const teamUsers: UsageRow[] = []
    const otherUsers: UsageRow[] = []

    const allUsers = [...overview.users, ...overview.otherUsers]
    for (const u of allUsers) {
      const team = userTeam.get(u.name.toLowerCase())
      if (team) {
        teamUsage.set(team, (teamUsage.get(team) ?? 0) + u.used)
        teamUsers.push({ ...u, team })
      } else {
        otherUsers.push(u)
      }
    }

    // Add admin teams that have no users yet (show them as 0)
    for (const t of adminTeams) {
      if (!teamUsage.has(t.name)) {
        teamUsage.set(t.name, 0)
      }
    }

    // Build teams UsageRow[] sorted by size
    const teams: UsageRow[] = Array.from(teamUsage.entries())
      .map(([name, used]) => ({ name, used }))
      .sort((a, b) => b.used - a.used)

    return { ...overview, teams, users: teamUsers, otherUsers }
  } catch {
    return overview
  }
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
    const adminCfg = getPublicConfig()
    const targets: Target[] = []
    for (const space of adminCfg.spaces) {
      for (const disk of space.disks) {
        const rp = join(disk.path, REPORT_FILE)
        const info = openReportAt(rp)
        if (info) {
          const meta = readMeta(info.db)
          const cap = readCapacity(info.db)
          const dbSize = statSync(rp).size
          info.db.close()
          targets.push({
            name: disk.name,
            slug: disk.slug,
            scanRoot: meta.scan_root ?? disk.path,
            scanTimestamp: Number(meta.scan_timestamp ?? 0),
            totalFiles: Number(meta.total_files ?? 0),
            totalDirs: Number(meta.total_dirs ?? 0),
            totalSize: Number(meta.total_size ?? 0),
            dbSizeBytes: dbSize,
            capacity: cap ?? null,
          })
        }
      }
    }
    return ok(targets)
  })

  // Targets arranged into groups for the Team → Disk sidebar.
  app.get('/api/groups', async (): Promise<ApiResponse<TargetGroup[]>> => {
    const adminCfg = getPublicConfig()
    const groups: TargetGroup[] = []
    for (const space of adminCfg.spaces) {
      const members: Target[] = []
      for (const disk of space.disks) {
        const rp = join(disk.path, REPORT_FILE)
        const info = openReportAt(rp)
        if (info) {
          const meta = readMeta(info.db)
          const cap = readCapacity(info.db)
          const dbSize = statSync(rp).size
          info.db.close()
          members.push({
            name: disk.name,
            slug: disk.slug,
            scanRoot: meta.scan_root ?? disk.path,
            scanTimestamp: Number(meta.scan_timestamp ?? 0),
            totalFiles: Number(meta.total_files ?? 0),
            totalDirs: Number(meta.total_dirs ?? 0),
            totalSize: Number(meta.total_size ?? 0),
            dbSizeBytes: dbSize,
            capacity: cap ?? null,
          })
        }
      }
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

      return ok(applyAdminTeams(target, readOverview(db, row)))
    },
  )

  // One level of the treemap. `parent` omitted means the scan root; the client
  // drills by passing the id of the node it wants to open.
  app.get<{
    Params: { target: string }
    Querystring: {
      parent?: string
      childOffset?: string
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

    const childOffset = intParam(request.query.childOffset)
    if (childOffset === 'bad') {
      return fail(reply, 400, 'childOffset must be a non-negative integer')
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
      childOffset: childOffset ?? 0,
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
      const status = readScanStatusAt(join(dir, REPORT_FILE), dir)
      if (!status) return fail(reply, 404, `no report found for target '${target}'`)
      reply.header('cache-control', 'no-store')
      return ok(status)
    },
  )

  // Freshness for every configured target at once, so the disk column can show a
  // per-card scan indicator with one poll per interval instead of one request per
  // card. Same cost model as the single-target route: stat() plus one small read.
  app.get('/api/statuses', async (request, reply): Promise<ApiResponse<ScanStatus[]>> => {
    const statuses: ScanStatus[] = []
    for (const space of getPublicConfig().spaces) {
      for (const disk of space.disks) {
        const status = readScanStatusAt(join(disk.path, REPORT_FILE), disk.path)
        if (!status) continue
        // readScanStatusAt names the target from the directory basename; the card
        // keys on the admin-DB route slug, so overwrite it.
        statuses.push({ ...status, target: disk.slug })
      }
    }
    reply.header('cache-control', 'no-store')
    return ok(statuses)
  })
}
