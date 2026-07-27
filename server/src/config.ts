// Runtime configuration, all from the environment so nothing is baked into the
// build. Defaults point at the duscan checkout next door, which is where reports
// land during development.

import { resolve } from 'node:path'

export interface Config {
  /** Directory holding one subdirectory per scanned target. */
  reportsDir: string
  port: number
  host: string
  /** Directory of built web assets to serve, or null to run API-only. */
  webDir: string | null
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function loadConfig(): Config {
  const reportsDir = resolve(
    process.env.DASHBOARD_REPORTS_DIR ?? '../disk_scanner/reports',
  )
  return {
    reportsDir,
    port: envInt('DASHBOARD_PORT', 5310),
    // Loopback by default: the dashboard exposes filesystem usage and has no
    // authentication of its own, so binding 0.0.0.0 must be an explicit choice.
    host: process.env.DASHBOARD_HOST ?? '127.0.0.1',
    webDir: process.env.DASHBOARD_WEB_DIR ? resolve(process.env.DASHBOARD_WEB_DIR) : null,
  }
}
