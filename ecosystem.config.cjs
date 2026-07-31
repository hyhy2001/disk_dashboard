// pm2 process definition.
//
// One process serves both the API and the built web assets, on the port nginx
// proxies to. The previous setup ran `npm run dev` (Vite + tsx watch) behind
// nginx, which dies on any crash and has no restart policy — fine for a laptop,
// not for something a vhost points at.
//
// Portable: every path resolves relative to this repo (not $HOME, not /usr),
// and .env in this directory overrides the defaults below when present.
//
// Usage:
//   make build && make start

const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')

const root = __dirname

// Minimal .env loader — KEY=VALUE lines, # comments, no quoting subtleties.
// The dashboard deliberately does not read .env itself, so PM2 does it here.
function loadDotEnv() {
  const envFile = resolve(root, '.env')
  if (!existsSync(envFile)) return {}
  const out = {}
  for (const raw of readFileSync(envFile, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const dot = loadDotEnv()

module.exports = {
  apps: [
    {
      name: 'disk-dashboard',
      script: resolve(root, 'server/dist/server/src/index.js'),
      cwd: root,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      // A restart loop from a bad config should not spin the CPU.
      restart_delay: 2000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        // nginx (dashboard.hydev.me) proxies to this port.
        DASHBOARD_PORT: dot.DASHBOARD_PORT || '5311',
        // Loopback only: nginx terminates TLS and is the sole entry point.
        DASHBOARD_HOST: dot.DASHBOARD_HOST || '127.0.0.1',
        DASHBOARD_WEB_DIR: dot.DASHBOARD_WEB_DIR || resolve(root, 'web/dist'),
        // Secret for signing session cookies. Set it in .env so sessions survive
        // restarts; without it a fresh random key is generated per boot.
        DASHBOARD_COOKIE_SECRET: dot.DASHBOARD_COOKIE_SECRET || '',
        DASHBOARD_LOG_LEVEL: dot.DASHBOARD_LOG_LEVEL || 'info',
      },
      out_file: resolve(root, 'logs/out.log'),
      error_file: resolve(root, 'logs/error.log'),
      merge_logs: true,
      time: true,
    },
  ],
}
