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
   * default: unless a reverse proxy that overwrites the header is the sole entry
   * point, any LAN peer can set it themselves, and trusting it would let them
   * spoof their IP and bypass the admin login rate limit. (`make setup` writes
   * DASHBOARD_HOST=0.0.0.0, so a default install is LAN-reachable.) Turn it on
   * only behind such a proxy (e.g. nginx). `false` uses the socket address;
   * `true` trusts the forwarding header from any peer; a comma-separated address
   * list trusts it only when the immediate peer is one of those addresses.
   */
  trustProxy: boolean | string
  /** API requests allowed per client IP per minute; 0 disables the limiter. */
  apiRateLimit: number
}

function envInt(name: string, fallback: number, min = 1): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= min ? n : fallback
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
  const trustProxyRaw = (process.env.DASHBOARD_TRUST_PROXY ?? '').trim()
  const trustProxyLower = trustProxyRaw.toLowerCase()
  // Absent, '', 'false' and '0' all mean the same thing: believe the socket peer
  // and ignore X-Forwarded-*. Anything else is either 'true' or a list of the
  // proxy addresses that may be believed, handed to fastify verbatim — it splits
  // on commas and compiles each token with @fastify/proxy-addr, so re-checking
  // that syntax here would only be a second, weaker copy of the same parser.
  let trustProxy: boolean | string = false
  if (trustProxyLower === 'true') {
    trustProxy = true
  } else if (trustProxyLower !== '' && trustProxyLower !== 'false' && trustProxyLower !== '0') {
    // fastify 5.12.1 removed the numeric form (GHSA-3m5p-2c4r-xxw2): a hop count
    // cannot verify the immediate peer, so a direct client could claim enough hops
    // and spoof X-Forwarded-For. Forwarding the number anyway would compile and
    // then trust nothing, which for an upgraded install means every client behind
    // the proxy silently collapses onto one address — and so onto one shared
    // admin-login rate-limit bucket. Refusing to start says what to write instead.
    if (/^[1-9][0-9]*$/.test(trustProxyLower)) {
      throw new Error(
        `DASHBOARD_TRUST_PROXY=${trustProxyRaw}: numeric hop counts are no longer supported. ` +
          `Use "true" to believe X-Forwarded-For from any peer, or list the reverse proxy's ` +
          `addresses/CIDRs (e.g. "127.0.0.1" or "10.0.0.0/8,127.0.0.1") to believe it only from those.`,
      )
    }
    trustProxy = trustProxyRaw
  }

  return {
    reportsDir,
    // 5310 is the *dev* API port: `make dev` runs Vite on 5311 and it proxies
    // /api here (web/vite.config.ts), so the two must not collide. Production
    // gets 5311 from the .env that `make setup` writes.
    port: envInt('DASHBOARD_PORT', 5310),
    // Loopback by default: the dashboard exposes filesystem usage and has no
    // authentication of its own, so binding 0.0.0.0 must be an explicit choice.
    host: process.env.DASHBOARD_HOST ?? '127.0.0.1',
    webDir,
    trustProxy,
    // 1800/min = 30 requests per second per IP: generous for humans (a viewer
    // polls statuses once every 3s) but a raw loop sending thousands/s is cut
    // off. Set to 0 to disable — hence min 0 here, the one integer setting with
    // a meaningful zero. index.ts builds the limiter only when this is > 0.
    apiRateLimit: envInt('DASHBOARD_API_RATE_LIMIT', 1800, 0),
  }
}
