// Report freshness.
//
// The client polls this and refetches when `stamp` moves, so the stamp must change
// when the report is replaced and stay put otherwise. A stamp that drifts on its
// own would put the dashboard in a refetch loop.

import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeAll } from './reports.js'
import { readScanStatus, STATUS_FILE } from './status.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dash-status-'))
})

afterEach(() => {
  closeAll()
  rmSync(dir, { recursive: true, force: true })
})

/** Write a minimal report.db for one target. */
function makeReport(target: string, scanTimestamp = 1_700_000_000): string {
  const targetDir = join(dir, target)
  mkdirSync(targetDir, { recursive: true })
  const path = join(targetDir, 'report.db')
  const db = new Database(path)
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('scan_timestamp', String(scanTimestamp))
  db.close()
  return targetDir
}

describe('readScanStatus', () => {
  it('returns null for a target with no report', () => {
    expect(readScanStatus(dir, 'missing')).toBeNull()
  })

  it('reports the scan timestamp from the report', () => {
    makeReport('Test', 1_712_000_000)
    expect(readScanStatus(dir, 'Test')?.scanTimestamp).toBe(1_712_000_000)
  })

  it('is not running when no status file is present', () => {
    makeReport('Test')
    const status = readScanStatus(dir, 'Test')
    expect(status?.running).toBe(false)
    expect(status?.stage).toBeUndefined()
  })

  it('does not report a running scan whose heartbeat has gone stale', () => {
    // The scanner heartbeats every ~2s; a SIGKILLed scan leaves `running: true`
    // frozen in the file. Trusting it verbatim would say "Scanning…" forever.
    makeReport('Test')
    writeFileSync(
      join(dir, 'Test', STATUS_FILE),
      JSON.stringify({ running: true, stage: 'scanning', updated_at: Math.floor(Date.now() / 1000) - 120 }),
    )
    expect(readScanStatus(dir, 'Test')?.running).toBe(false)
  })

  it('reports a running scan whose heartbeat is fresh', () => {
    makeReport('Test')
    writeFileSync(
      join(dir, 'Test', STATUS_FILE),
      JSON.stringify({ running: true, stage: 'scanning', updated_at: Math.floor(Date.now() / 1000) }),
    )
    expect(readScanStatus(dir, 'Test')?.running).toBe(true)
  })

  it('gives the same stamp for an unchanged file', () => {
    makeReport('Test')
    expect(readScanStatus(dir, 'Test')?.stamp).toBe(readScanStatus(dir, 'Test')?.stamp)
  })

  it('changes the stamp when the report is rewritten', () => {
    const targetDir = makeReport('Test')
    const before = readScanStatus(dir, 'Test')?.stamp

    // Grow the file so the size component moves even if mtime resolution is
    // coarse — a stamp that only tracked mtime could miss a fast rewrite.
    const db = new Database(join(targetDir, 'report.db'))
    db.exec('CREATE TABLE filler (x TEXT)')
    db.prepare('INSERT INTO filler VALUES (?)').run('x'.repeat(10_000))
    db.close()
    closeAll()

    expect(readScanStatus(dir, 'Test')?.stamp).not.toBe(before)
  })

  it('surfaces the stage and message from a status file', () => {
    const targetDir = makeReport('Test')
    writeFileSync(join(targetDir, STATUS_FILE), JSON.stringify({ stage: 'treemap', message: 'Building treemap' }))
    const status = readScanStatus(dir, 'Test')
    expect(status?.stage).toBe('treemap')
    expect(status?.message).toBe('Building treemap')
    expect(status?.running).toBe(true)
  })

  it('surfaces scan detail fields when duscan wrote them', () => {
    const targetDir = makeReport('Test')
    writeFileSync(
      join(targetDir, STATUS_FILE),
      JSON.stringify({
        stage: 'scan',
        pid: 1892842,
        started_at: 1785395281,
        updated_at: 1785395284,
        total_elapsed_sec: 3,
      }),
    )
    const status = readScanStatus(dir, 'Test')
    expect(status?.pid).toBe(1892842)
    expect(status?.startedAt).toBe(1785395281)
    expect(status?.updatedAt).toBe(1785395284)
    expect(status?.elapsedSec).toBe(3)
  })

  it('does not call a finished scan running', () => {
    const targetDir = makeReport('Test')
    // duscan leaves the file behind briefly after finishing.
    writeFileSync(join(targetDir, STATUS_FILE), JSON.stringify({ stage: 'done' }))
    expect(readScanStatus(dir, 'Test')?.running).toBe(false)
  })

  it('does not call a failed scan running', () => {
    const targetDir = makeReport('Test')
    writeFileSync(join(targetDir, STATUS_FILE), JSON.stringify({ stage: 'error' }))
    const status = readScanStatus(dir, 'Test')
    expect(status?.running).toBe(false)
    expect(status?.stage).toBe('error')
  })

  it('honours an explicit running flag over the stage guess', () => {
    const targetDir = makeReport('Test')
    writeFileSync(join(targetDir, STATUS_FILE), JSON.stringify({ stage: 'done', running: true }))
    expect(readScanStatus(dir, 'Test')?.running).toBe(true)
  })

  it('treats a half-written status file as no status', () => {
    const targetDir = makeReport('Test')
    // Caught mid-write by another process.
    writeFileSync(join(targetDir, STATUS_FILE), '{"stage": "sca')
    const status = readScanStatus(dir, 'Test')
    expect(status).not.toBeNull()
    expect(status?.stage).toBeUndefined()
  })
})
