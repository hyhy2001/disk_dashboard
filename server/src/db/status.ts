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
import { join } from 'node:path'
import type { ScanStatus } from '../../../shared/api.js'
import { openReport, readMeta, reportPath } from './reports.js'

/** duscan writes progress here while a scan is running, then removes it. */
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

/**
 * Freshness of one target's report. Returns null when the target has no report at
 * all, which the route turns into a 404.
 */
export function readScanStatus(reportsDir: string, target: string): ScanStatus | null {
  const path = reportPath(reportsDir, target)
  if (!existsSync(path)) return null

  const st = statSync(path)
  const db = openReport(reportsDir, target)
  const meta = db ? readMeta(db) : {}
  const status = readStatusFile(join(reportsDir, target))

  const stage = str(status?.stage)
  const message = str(status?.message)

  return {
    target,
    stamp: `${st.mtimeMs}:${st.size}`,
    scanTimestamp: Number(meta.scan_timestamp) || 0,
    reportMtime: st.mtimeMs,
    ...(stage !== undefined ? { stage } : {}),
    ...(message !== undefined ? { message } : {}),
    // A stage that is not a terminal one means work is still in flight. Trusting
    // an explicit `running: false` matters: duscan leaves the file behind briefly
    // after finishing, and a stale 'done' should not read as a live scan.
    running:
      status?.running === true ||
      (status?.running === undefined && stage !== undefined && stage !== 'done' && stage !== 'error'),
  }
}
