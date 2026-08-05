// Fastify entry point.
//
// NOTE: this server has no authentication on the report-reading endpoints.
// It exposes filesystem usage and usernames, so it binds 127.0.0.1 by default
// — put it behind a reverse proxy that handles auth before setting
// DASHBOARD_HOST to a public interface.
//
// Admin endpoints (under /api/admin/) use cookie-based sessions backed by a
// separate admin.db with scrypt-hashed passwords.

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { registerApi } from './routes/api.js'
import { registerAdmin } from './routes/admin.js'
import { closeAll } from './db/reports.js'
import { closeAdminDb } from './db/admin.js'
import { RateLimiter } from './ratelimit.js'

const config = loadConfig()

const app = Fastify({
  logger: { level: process.env.DASHBOARD_LOG_LEVEL ?? 'info' },
  // Without this, req.ip is always the socket peer and X-Forwarded-For is
  // ignored — so a LAN attacker hitting 0.0.0.0 directly cannot fake an IP to
  // dodge the login rate limit. Behind nginx, set DASHBOARD_TRUST_PROXY=true.
  trustProxy: config.trustProxy,
  // DoS hardening: bound how long a socket may sit idle, how long a request may
  // take, and how many requests one keep-alive socket may issue, so a flood
  // cannot hold connections open indefinitely. Fastify's default is unbounded
  // for the first two.
  connectionTimeout: 60_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
  maxRequestsPerSocket: 1000,
  // Admin POST bodies never need the 1 MiB default; 256 KiB covers even a large
  // team's user list.
  bodyLimit: 262_144,
})

// Per-IP cap on API requests. The report endpoints are unauthenticated by
// design, so a loop against them is only stopped by this (or the reverse
// proxy). Cheap endpoints are exempt; the login endpoint has its own stricter
// limiter.
const apiLimiter = config.apiRateLimit > 0 ? new RateLimiter(60_000, config.apiRateLimit) : null
app.addHook('onRequest', async (request, reply) => {
  if (!apiLimiter) return
  const url = request.url
  if (!url.startsWith('/api/') || url.startsWith('/api/health')) return
  if (!apiLimiter.allow(request.ip)) {
    return reply.code(429).send({ status: 'error', message: 'rate limit exceeded' })
  }
})

await app.register(fastifyCookie, { secret: process.env.DASHBOARD_COOKIE_SECRET || undefined })

registerApi(app)
registerAdmin(app)

// In dev the Vite server owns the assets and proxies /api here, so a missing
// webDir is normal rather than an error.
if (config.webDir && existsSync(config.webDir)) {
  // Never serve build internals or repo metadata: source maps would expose the
  // original TS, and .git/.env/.db would leak far worse. Deny by URL shape so a
  // file added to webDir later is covered without a config change. API routes
  // are registered before this hook but never touch webDir, so exempt /api/.
  const SENSITIVE = /(?:^|\.)(?:map|git|env|db|sqlite|sqlite3|log|bak|ts|tsx|svelte|vue|lock)(?:\b|$)/i
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') && SENSITIVE.test(request.url)) {
      return reply.code(404).send({ status: 'error', message: 'not found' })
    }
  })
  await app.register(fastifyStatic, { root: config.webDir })
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ status: 'error', message: 'unknown endpoint' })
    }
    // Client-side routing: any non-API path renders the SPA shell.
    return reply.sendFile('index.html')
  })
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`received ${signal}, shutting down`)
  await app.close()
  closeAll()
  closeAdminDb()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ port: config.port, host: config.host })
  if (existsSync(config.reportsDir)) {
    app.log.info(`reports dir: ${config.reportsDir}`)
  } else {
    // Not fatal — the directory may appear after the first scan — but it is the
    // single most likely reason for an empty dashboard, so say it loudly.
    app.log.warn(
      `reports dir does not exist: ${config.reportsDir} — set DASHBOARD_REPORTS_DIR to the directory holding <target>/report.db`,
    )
  }
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
