// HTTP surface. Every handler returns the shared {status, data} envelope so the
// client branches on one field regardless of which endpoint failed.

import type { FastifyInstance, FastifyReply } from 'fastify'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import type {
  ApiResponse,
  DetailFilter,
  DetailUser,
  HealthInfo,
  HistorySeries,
  Overview,
  PermPage,
  ScanStatus,
  SearchResult,
  Target,
  TargetGroup,
  TreemapLevel,
  UserDetail,
} from '../../../shared/api.js'
import type { Config } from '../config.js'
import {
  isSafeTargetName,
  listTargets,
  openReport,
  readCapacity,
  readMeta,
} from '../db/reports.js'
import { readOverview } from '../db/overview.js'
import { readTreemapLevel } from '../db/treemap.js'
import { groupTargets, readMapping } from '../db/groups.js'
import { findUid, listUsers, readUserDetail } from '../db/detail.js'
import { readPermIssues } from '../db/perms.js'
import { readHistorySeries } from '../db/history.js'
import { searchNames } from '../db/search.js'
import { readScanStatus } from '../db/status.js'

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
function detailFilterFrom(q: {
  query?: string
  ext?: string
  minSize?: string
  maxSize?: string
}): DetailFilter {
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

export function registerApi(app: FastifyInstance, config: Config): void {
  app.get('/api/health', async (): Promise<ApiResponse<HealthInfo>> => {
    return ok<HealthInfo>({
      ok: true,
      sqliteVersion: sqliteVersion(),
      trigramAvailable: detectTrigram(),
      reportsDir: config.reportsDir,
      reportsDirExists: existsSync(config.reportsDir),
      targetsFound: listTargets(config.reportsDir).length,
      // Distinguishes "no teams.json" from "teams.json present but unparseable",
      // which otherwise both show up as a single default group.
      groupConfigLoaded: readMapping(config.reportsDir) !== null,
    })
  })

  app.get('/api/targets', async (): Promise<ApiResponse<Target[]>> => {
    return ok(listTargets(config.reportsDir))
  })

  // Targets arranged into groups for the Team → Disk sidebar.
  app.get('/api/groups', async (): Promise<ApiResponse<TargetGroup[]>> => {
    return ok(groupTargets(config.reportsDir, listTargets(config.reportsDir)))
  })

  app.get<{ Params: { target: string } }>(
    '/api/overview/:target',
    async (request, reply): Promise<ApiResponse<Overview>> => {
      const { target } = request.params
      if (!isSafeTargetName(target)) {
        return fail(reply, 400, 'invalid target name')
      }

      const db = openReport(config.reportsDir, target)
      if (!db) {
        return fail(reply, 404, `no report found for target '${target}'`)
      }

      // listTargets() already stats every report; reuse its row so the summary
      // numbers in the header match the target picker exactly.
      const meta = readMeta(db)
      const known = listTargets(config.reportsDir).find((t) => t.name === target)
      const row: Target = known ?? {
        name: target,
        scanRoot: meta.scan_root ?? meta.scan_path ?? '',
        scanTimestamp: Number(meta.scan_timestamp) || 0,
        totalFiles: Number(meta.total_files) || 0,
        totalDirs: Number(meta.total_dirs) || 0,
        totalSize: Number(meta.total_size) || 0,
        dbSizeBytes: 0,
        capacity: readCapacity(db),
      }

      return ok(readOverview(db, row))
    },
  )

  // One level of the treemap. `parent` omitted means the scan root; the client
  // drills by passing the id of the node it wants to open.
  app.get<{
    Params: { target: string }
    Querystring: { parent?: string; childOffset?: string; fileOffset?: string; files?: string }
  }>(
    '/api/treemap/:target',
    async (request, reply): Promise<ApiResponse<TreemapLevel>> => {
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

      const db = openReport(config.reportsDir, target)
      if (!db) {
        return fail(reply, 404, `no report found for target '${target}'`)
      }

      const level = readTreemapLevel(db, parent, {
        childOffset: childOffset ?? 0,
        // Files cost an extra skip-scan, so the client opts in.
        withFiles: request.query.files === '1',
        fileOffset: fileOffset ?? 0,
      })
      if (!level) {
        return fail(reply, 404, 'directory not found in this report')
      }
      return ok(level)
    },
  )

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
    const db = openReport(config.reportsDir, target)
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
  }>(
    '/api/detail/:target/:user',
    async (request, reply): Promise<ApiResponse<UserDetail>> => {
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
          ...(request.query.dirCursor !== undefined
            ? { dirCursor: request.query.dirCursor }
            : {}),
          ...(request.query.fileCursor !== undefined
            ? { fileCursor: request.query.fileCursor }
            : {}),
          ...(limit !== undefined ? { limit } : {}),
          filter: detailFilterFrom(request.query),
        }),
      )
    },
  )

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
  }>(
    '/api/permissions/:target',
    async (request, reply): Promise<ApiResponse<PermPage>> => {
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
    },
  )

  // Whole-target timeline plus one series per user, for the History tab.
  app.get<{ Params: { target: string } }>(
    '/api/history/:target',
    async (request, reply): Promise<ApiResponse<HistorySeries>> => {
      const opened = withReport(request.params.target, reply)
      if ('err' in opened) return opened.err
      return ok(readHistorySeries(opened.db))
    },
  )

  // Name search across directories and files.
  app.get<{
    Params: { target: string }
    Querystring: { q?: string; kind?: string; limit?: string }
  }>(
    '/api/search/:target',
    async (request, reply): Promise<ApiResponse<SearchResult>> => {
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
    },
  )

  // Report freshness. Polled, so it must stay a stat() plus one small read — no
  // caching header is set because a cached response would defeat the point.
  app.get<{ Params: { target: string } }>(
    '/api/status/:target',
    async (request, reply): Promise<ApiResponse<ScanStatus>> => {
      const { target } = request.params
      if (!isSafeTargetName(target)) return fail(reply, 400, 'invalid target name')
      const status = readScanStatus(config.reportsDir, target)
      if (!status) return fail(reply, 404, `no report found for target '${target}'`)
      reply.header('cache-control', 'no-store')
      return ok(status)
    },
  )
}
