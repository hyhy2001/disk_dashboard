// Test harness for the HTTP routes: a Fastify instance with every route
// registered against a throwaway admin DB, plus helpers to plant a report
// fixture on disk and configure a disk pointing at it.

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyCookie from '@fastify/cookie'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerApi } from './api.js'
import { registerAdmin } from './admin.js'
import { closeAdminDb, createDisk, createSpace } from '../db/admin.js'
import { createFixture } from '../db/fixture.js'

let dir: string | null = null

/** A fresh admin DB in a temp dir and an app with all routes registered. */
export function createTestApp(): FastifyInstance {
  dir = mkdtempSync(join(tmpdir(), 'dash-routes-'))
  process.env.DASHBOARD_ADMIN_DB = join(dir, 'admin.db')
  const app = Fastify()
  void app.register(fastifyCookie)
  registerApi(app)
  registerAdmin(app)
  return app
}

/** Path to the temp admin-db directory (valid only after createTestApp). */
export function testDir(): string {
  if (!dir) throw new Error('createTestApp not called')
  return dir
}

/** Persist a fixture report to `<dir>/vol1/report.db` and wire a disk to it. */
export async function addDiskWithReport(): Promise<string> {
  const vol = join(testDir(), 'vol1')
  mkdirSync(vol, { recursive: true })
  const db = createFixture()
  await db.backup(join(vol, 'report.db'))
  db.close()

  const space = createSpace('prod')
  const disk = createDisk(space.id, 'data', vol)
  return disk.slug
}

/** Close the admin DB and remove the temp directory. */
export function cleanup(): void {
  closeAdminDb()
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
}
