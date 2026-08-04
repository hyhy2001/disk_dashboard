// Report freshness, for the sync pill.
//
// The dashboard cannot start a scan — duscan runs on its own schedule and swaps
// each report in with rename(). So "sync" here means "notice that the report
// changed", not "trigger work". This module reports observed state:
//
//   stamp        mtimeMs:size of report.db — changes exactly when it is replaced
//   scanTimestamp what the report says about itself
//   stage        present only while duscan is mid-scan
//
// The client polls this cheaply and refetches its data only when `stamp` moves,
// which is the same fingerprint trick legacy used with meta.latest_date, but based
// on the file rather than on a query.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { ScanStatus } from '../../../shared/api.js'
import { openReportAt, readMeta, reportPath } from './reports.js'

/**
 * duscan writes progress here while a scan is running and leaves the file in
 * place afterwards (it is never removed), so presence says nothing about
 * liveness — read `running` / a terminal `stage` for that.
 */
export const STATUS_FILE = 'scan_status.json'

/**
 * Shape of scan_status.json as duscan writes it. Every field is optional because
 * the file is written by another process on its own schedule: a partially written
 * or older-format file must degrade to "no stage known", not throw.
 */
interface StatusFile {
  stage?: unknown
  message?: unknown
  running?: unknown
  pid?: unknown
  started_at?: unknown
  updated_at?: unknown
  total_elapsed_sec?: unknown
}

function readStatusFile(dir: string): StatusFile | null {
  const path = join(dir, STATUS_FILE)
  if (!existsSync(path)) return null
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as StatusFile
  } catch {
    // A scan writing the file right now can be caught mid-write. Treat an
    // unparseable file as "no status", not as an error worth surfacing.
    return null
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Stages after which duscan does no further work on this report.
 *
 * These are the literals duscan actually writes (`set_phase` in
 * `disk_scanner/cli/src/main.rs`, plus the `"cancelled"` written on SIGINT).
 * A stage outside this set means work is still in flight. Getting `cancelled`
 * wrong is the reason this is a named set rather than an inline comparison: it is
 * neither `done` nor `error`, so a two-value check leaves an aborted scan looking
 * like it is running forever.
 */
const TERMINAL_STAGES = new Set(['done', 'error', 'cancelled'])

/**
 * Freshness of one target's report. Returns null when the target has no report at
 * all, which the route turns into a 404.
 */
export function readScanStatus(reportsDir: string, target: string): ScanStatus | null {
  return readScanStatusAt(reportPath(reportsDir, target), join(reportsDir, target))
}

/**
 * Read scan status for a target whose report directory path is known directly
 * (e.g. resolved from admin DB). This avoids needing a reportsDir + target pair.
 */
export function readScanStatusAt(reportDbPath: string, targetDir: string): ScanStatus | null {
  if (!existsSync(reportDbPath)) return null

  const st = statSync(reportDbPath)
  const target = basename(targetDir)
  // openReportAt caches the handle by path; do not close it here or the next
  // poll would hand back a closed connection.
  const db = openReportAt(reportDbPath)
  const meta = db ? readMeta(db.db) : {}
  const status = readStatusFile(targetDir)

  const stage = str(status?.stage)
  const message = str(status?.message)
  const pid = num(status?.pid)
  const startedAt = num(status?.started_at)
  const updatedAt = num(status?.updated_at)
  const elapsedSec = num(status?.total_elapsed_sec)

  return {
    target,
    stamp: `${st.mtimeMs}:${st.size}`,
    scanTimestamp: Number(meta.scan_timestamp) || 0,
    reportMtime: st.mtimeMs,
    ...(stage !== undefined ? { stage } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
    ...(elapsedSec !== undefined ? { elapsedSec } : {}),
    // A stage that is not a terminal one means work is still in flight. Trusting
    // an explicit `running: false` matters: duscan leaves the file behind for
    // good after finishing, and a stale 'done' should not read as a live scan.
    running: status?.running === true || (status?.running === undefined && stage !== undefined && !TERMINAL_STAGES.has(stage)),
  }
}
