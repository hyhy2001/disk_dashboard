// HTTP surface. Every handler returns the shared {status, data} envelope so the
// client branches on one field regardless of which endpoint failed.

import type { FastifyInstance, FastifyReply } from 'fastify'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import type {
  ApiResponse,
  HealthInfo,
  Overview,
  Target,
  TreemapLevel,
} from '../../../shared/api.js'
import type { Config } from '../config.js'
import { isSafeTargetName, listTargets, openReport, readMeta } from '../db/reports.js'
import { readOverview } from '../db/overview.js'
import { readTreemapLevel } from '../db/treemap.js'

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

export function registerApi(app: FastifyInstance, config: Config): void {
  app.get('/api/health', async (): Promise<ApiResponse<HealthInfo>> => {
    return ok<HealthInfo>({
      ok: true,
      sqliteVersion: sqliteVersion(),
      trigramAvailable: detectTrigram(),
      reportsDir: config.reportsDir,
      reportsDirExists: existsSync(config.reportsDir),
      targetsFound: listTargets(config.reportsDir).length,
    })
  })

  app.get('/api/targets', async (): Promise<ApiResponse<Target[]>> => {
    return ok(listTargets(config.reportsDir))
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
}
