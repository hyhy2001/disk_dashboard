// Fastify entry point.
//
// NOTE: this server has no authentication. It exposes filesystem usage and
// usernames, so it binds 127.0.0.1 by default — put it behind a reverse proxy
// that handles auth before setting DASHBOARD_HOST to a public interface.

import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { loadConfig } from './config.js'
import { registerApi } from './routes/api.js'
import { closeAll } from './db/reports.js'

const config = loadConfig()

const app = Fastify({
  logger: { level: process.env.DASHBOARD_LOG_LEVEL ?? 'info' },
})

registerApi(app, config)

// In dev the Vite server owns the assets and proxies /api here, so a missing
// webDir is normal rather than an error.
if (config.webDir && existsSync(config.webDir)) {
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
