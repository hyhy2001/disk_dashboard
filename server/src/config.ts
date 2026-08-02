// Runtime configuration, all from the environment so nothing is baked into the
// build. Defaults point at the duscan checkout next door, which is where reports
// land during development.

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  /** Directory holding one subdirectory per scanned target. */
  reportsDir: string
  port: number
  host: string
  /** Directory of built web assets to serve, or null to run API-only. */
  webDir: string | null
  /**
   * Whether X-Forwarded-For may be trusted to name the real client. Off by
   * default: when the server binds 0.0.0.0 (the default), trusting a header any
   * LAN peer can set would let them spoof their IP and bypass the admin login
   * rate limit. Turn it on only behind a reverse proxy that overwrites the
   * header (e.g. nginx). `false` uses the socket address; a number trusts that
   * many proxy hops.
   */
  trustProxy: boolean | number
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/**
 * Repo root, derived from this module's own location rather than cwd.
 *
 * `npm run dev` executes the workspace script with cwd = server/, while
 * `npm start` from the repo root uses the root — so a cwd-relative default
 * points somewhere different depending on how the server was launched. Anchoring
 * to the module path makes the default mean the same thing either way.
 *
 * Layout: <root>/server/src/config.ts in dev, <root>/server/dist/server/src/
 * config.js after tsc, so walk up until package.json with the workspaces key.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'shared'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  // Fall back to cwd rather than throwing: an explicit env var still works, and
  // the health endpoint reports the path it settled on.
  return process.cwd()
}

export function loadConfig(): Config {
  const fromEnv = process.env.DASHBOARD_REPORTS_DIR
  // Sibling checkout of the scanner is where reports land in development.
  const reportsDir = fromEnv ? resolve(fromEnv) : resolve(repoRoot(), '..', 'disk_scanner', 'reports')
  // Resolve relative paths against the repo root, not cwd, so a portable .env
  // entry like `web/dist` works no matter which directory the server was
  // launched from.
  const webEnv = process.env.DASHBOARD_WEB_DIR
  const webDir = webEnv ? (isAbsolute(webEnv) ? webEnv : resolve(repoRoot(), webEnv)) : null
  const trustProxyRaw = process.env.DASHBOARD_TRUST_PROXY
  // 'true' trusts every hop; a positive integer trusts that many hops; anything
  // else (absent, 'false', garbage) means trust no proxy and use the socket peer.
  const trustProxy: boolean | number =
    trustProxyRaw !== undefined && trustProxyRaw !== '' && trustProxyRaw.toLowerCase() !== 'false'
      ? trustProxyRaw.toLowerCase() === 'true'
        ? true
        : envInt('DASHBOARD_TRUST_PROXY', 0) || 0
      : false

  return {
    reportsDir,
    port: envInt('DASHBOARD_PORT', 5310),
    // Loopback by default: the dashboard exposes filesystem usage and has no
    // authentication of its own, so binding 0.0.0.0 must be an explicit choice.
    host: process.env.DASHBOARD_HOST ?? '0.0.0.0',
    webDir,
    trustProxy,
  }
}
