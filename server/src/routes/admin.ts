// Admin API routes — auth, accounts, spaces, disks.
//
// Session: a signed cookie `du_sess` carrying `adminId:role:username`.
// The HMAC-based signature (rather than a random token) means the server
// can validate the session without a session store — stateless, like JWT
// but simpler.

import type { FastifyInstance } from 'fastify'
import * as A from '../db/admin.js'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'du_sess'
const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: false }

interface AuthUser {
  id: number
  username: string
  role: string
}

/** Parse the session cookie and return the authenticated user, or null. */
function authUser(req: any): AuthUser | null {
  const raw = req.cookies?.[SESSION_COOKIE]
  if (!raw) return null
  const payload = A.verifySession(raw)
  if (!payload) return null
  const parts = payload.split(':')
  const idStr = parts[0]!
  const role = parts[1]
  const username = parts[2]
  const id = Number.parseInt(idStr, 10)
  if (!id || !role || !username) return null
  return { id, role, username }
}

/** Require auth — sends 401 if not authenticated. */
function requireAuth(req: any, reply: any): AuthUser {
  const user = authUser(req)
  if (!user) return reply.code(401).send({ status: 'error', message: 'Unauthorized' })
  return user as AuthUser
}

/** Require owner role — sends 403 if not owner. */
function requireOwner(req: any, reply: any): AuthUser {
  const user = requireAuth(req, reply)
  if (user.role !== 'owner') return reply.code(403).send({ status: 'error', message: 'Owner access required' })
  return user
}

function clientIp(req: any): string {
  return (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown'
}

/** True when a better-sqlite3 UNIQUE constraint was violated. */
function isUniqueViolation(e: any): boolean {
  return e?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /UNIQUE constraint failed/i.test(String(e?.message))
}

/** Send a 409 for duplicate names, otherwise rethrow. */
function uniqueGuard(reply: any, e: any, what: string): never {
  if (isUniqueViolation(e)) {
    reply.code(409).send({ status: 'error', message: `Duplicate ${what}` })
  }
  throw e
}

// ---------------------------------------------------------------------------
// Public endpoints (no auth)
// ---------------------------------------------------------------------------

export function registerAdmin(app: FastifyInstance): void {
  // --- Config (public) ---
  app.get('/api/admin/config', async (_req, reply) => {
    return reply.send({ status: 'success', data: A.getPublicConfig() })
  })

  // --- Setup (first admin, no auth needed) ---
  app.post('/api/admin/setup', async (req: any, reply) => {
    if (A.hasAnyAdmin()) {
      return reply.code(403).send({ status: 'error', message: 'Setup already completed' })
    }
    const { username, password } = req.body ?? {}
    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Username and password required' })
    }
    if (username.length < 3 || username.length > 64) {
      return reply.code(422).send({ status: 'error', message: 'Username must be 3-64 characters' })
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return reply.code(422).send({ status: 'error', message: 'Username contains invalid characters' })
    }
    if (password.length < 10) {
      return reply.code(422).send({ status: 'error', message: 'Password must be at least 10 characters' })
    }
    const admin = A.createAdmin(username, password, 'owner')
    const token = A.signSession(`${admin.id}:owner:${admin.username}`)
    return reply
      .setCookie(SESSION_COOKIE, token, COOKIE_OPTS)
      .send({ status: 'success', data: { id: admin.id, username: admin.username, role: 'owner' } })
  })

  // --- Login ---
  app.get('/api/admin/status', async (req: any, reply) => {
    const user = authUser(req)
    const ip = clientIp(req)
    const rate = A.rateLimitCheck(ip)
    return reply.send({
      status: 'success',
      data: {
        loggedIn: !!user,
        user: user ? { id: user.id, username: user.username, role: user.role } : null,
        rateLimit: { captcha: rate.captcha, attempts: rate.attempts },
        needsSetup: !A.hasAnyAdmin(),
      },
    })
  })

  app.post('/api/admin/login', async (req: any, reply) => {
    const ip = clientIp(req)
    const rate = A.rateLimitCheck(ip)
    if (!rate.allowed) {
      return reply.code(429).send({ status: 'error', message: 'Too many attempts. Try again later.' })
    }
    const { username, password, captchaId, captchaAnswer } = req.body ?? {}
    if (!username || !password) {
      return reply.code(422).send({ status: 'error', message: 'Username and password required' })
    }
    // Captcha required after enough failures
    if (rate.captcha) {
      if (!captchaId || captchaAnswer === undefined || !A.verifyCaptcha(captchaId, Number(captchaAnswer))) {
        A.rateLimitRecord(ip)
        return reply.code(401).send({
          status: 'error',
          message: 'Captcha answer is incorrect',
          rateLimit: { captcha: true },
        })
      }
    }
    const admin = A.getAdminByUsername(username)
    if (!admin || !A.verifyPassword(password, admin.password_hash)) {
      A.rateLimitRecord(ip)
      const after = A.rateLimitCheck(ip)
      return reply.code(401).send({
        status: 'error',
        message: 'Invalid credentials',
        rateLimit: { captcha: after.captcha, attempts: after.attempts },
      })
    }
    A.rateLimitClear(ip)
    const token = A.signSession(`${admin.id}:${admin.role}:${admin.username}`)
    return reply
      .setCookie(SESSION_COOKIE, token, COOKIE_OPTS)
      .send({ status: 'success', data: { id: admin.id, username: admin.username, role: admin.role } })
  })

  app.get('/api/admin/captcha', async (_req: any, reply) => {
    const challenge = A.createCaptcha()
    return reply.send({ status: 'success', data: challenge })
  })

  app.post('/api/admin/logout', async (_req: any, reply) => {
    return reply.clearCookie(SESSION_COOKIE, COOKIE_OPTS).send({ status: 'success', data: null })
  })

  // --- Accounts (owner only) ---
  app.get('/api/admin/accounts', async (req: any, reply) => {
    requireOwner(req, reply)
    return reply.send({ status: 'success', data: A.listAdmins() })
  })

  app.post('/api/admin/accounts', async (req: any, reply) => {
    requireOwner(req, reply)
    const { username, password, role } = req.body ?? {}
    if (!username || !password) {
      return reply.code(422).send({ status: 'error', message: 'Username and password required' })
    }
    const admin = A.createAdmin(username, password, role ?? 'admin')
    return reply.code(201).send({ status: 'success', data: admin })
  })

  app.delete('/api/admin/accounts/:id', async (req: any, reply) => {
    requireOwner(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    const ok = A.deleteAdmin(id)
    if (!ok) return reply.code(400).send({ status: 'error', message: 'Cannot delete the last owner' })
    return reply.send({ status: 'success', data: null })
  })

  app.post('/api/admin/accounts/:id/password', async (req: any, reply) => {
    requireOwner(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    const { password } = req.body ?? {}
    if (!password || password.length < 10) {
      return reply.code(422).send({ status: 'error', message: 'Password must be at least 10 characters' })
    }
    const ok = A.changePassword(id, password)
    if (!ok) return reply.code(404).send({ status: 'error', message: 'Account not found' })
    return reply.send({ status: 'success', data: null })
  })

  // Change own password (any auth user)
  app.post('/api/admin/me/password', async (req: any, reply) => {
    const user = requireAuth(req, reply)
    const { currentPassword, newPassword } = req.body ?? {}
    if (!currentPassword || !newPassword || newPassword.length < 10) {
      return reply.code(422).send({ status: 'error', message: 'Invalid request' })
    }
    const admin = A.getAdminByUsername(user.username)
    if (!admin || !A.verifyPassword(currentPassword, admin.password_hash)) {
      return reply.code(401).send({ status: 'error', message: 'Current password is incorrect' })
    }
    A.changePassword(admin.id, newPassword)
    return reply.send({ status: 'success', data: null })
  })

  // --- Spaces & Disks (admin+) ---
  app.get('/api/admin/spaces', async (req: any, reply) => {
    requireAuth(req, reply)
    return reply.send({ status: 'success', data: A.listSpacesWithDisks() })
  })

  app.post('/api/admin/spaces', async (req: any, reply) => {
    requireAuth(req, reply)
    const { name } = req.body ?? {}
    if (!name || typeof name !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Name required' })
    }
    try {
      return reply.code(201).send({ status: 'success', data: A.createSpace(name) })
    } catch (e) {
      uniqueGuard(reply, e, 'space name')
    }
  })

  app.put('/api/admin/spaces/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    const { name } = req.body ?? {}
    if (!id || !name) return reply.code(422).send({ status: 'error', message: 'Invalid request' })
    try {
      A.updateSpace(id, name)
    } catch (e) {
      uniqueGuard(reply, e, 'space name')
    }
    return reply.send({ status: 'success', data: null })
  })

  app.delete('/api/admin/spaces/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    A.deleteSpace(id)
    return reply.send({ status: 'success', data: null })
  })

  app.post('/api/admin/disks', async (req: any, reply) => {
    requireAuth(req, reply)
    const { space_id, name, path } = req.body ?? {}
    if (!space_id || !name || !path) {
      return reply.code(422).send({ status: 'error', message: 'space_id, name, and path required' })
    }
    try {
      return reply.code(201).send({ status: 'success', data: A.createDisk(space_id, name, path) })
    } catch (e) {
      uniqueGuard(reply, e, 'disk name in this space')
    }
  })

  app.put('/api/admin/disks/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    const { name, path } = req.body ?? {}
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    try {
      A.updateDisk(id, { name, path })
    } catch (e) {
      uniqueGuard(reply, e, 'disk name in this space')
    }
    return reply.send({ status: 'success', data: null })
  })

  // Import teams from report.db into admin.db (idempotent)
  app.post('/api/admin/disks/:id/import-teams', async (req: any, reply) => {
    requireAuth(req, reply)
    const diskId = Number.parseInt(req.params.id, 10)
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })

    // Get disk path from admin.db
    const spaces = A.listSpacesWithDisks()
    const disk = spaces.flatMap((s) => s.disks).find((d) => d.id === diskId)
    if (!disk) return reply.code(404).send({ status: 'error', message: 'Disk not found' })

    const rp = join(disk.path, 'report.db')
    if (!existsSync(rp))
      return reply.code(404).send({ status: 'error', message: 'report.db not found at ' + disk.path })

    let reportDb: Database.Database | null = null
    try {
      reportDb = new Database(rp, { readonly: true })

      // Read teams from hist_team_usage
      const teamRows = reportDb
        .prepare("SELECT DISTINCT team_id AS id, name FROM hist_team_usage WHERE name IS NOT NULL AND name != ''")
        .all() as { id: string; name: string }[]

      // Read users per team from newest snapshot
      const snapRow = reportDb.prepare('SELECT id FROM hist_snapshots ORDER BY scan_date DESC LIMIT 1').get() as
        { id: number } | undefined
      const usersByTeam: Record<string, string[]> = {}
      if (snapRow) {
        const userRows = reportDb
          .prepare(`SELECT u.username, u.team_id FROM detail_users u WHERE u.team_id IS NOT NULL AND u.team_id != ''`)
          .all() as { username: string; team_id: string }[]
        for (const u of userRows) {
          if (!usersByTeam[u.team_id]) usersByTeam[u.team_id] = []
          usersByTeam[u.team_id]!.push(u.username)
        }
      }

      // Create admin teams (idempotent: clear existing for this disk first)
      const existing = A.listDiskTeams(diskId)
      for (const t of existing) A.deleteDiskTeam(t.id)

      let imported = 0
      for (const t of teamRows) {
        const users = usersByTeam[t.id] || []
        const created = A.createDiskTeam(diskId, t.name)
        A.updateDiskTeam(created.id, { name: t.name, users })
        imported++
      }

      reportDb.close()
      return reply.send({ status: 'success', data: { imported, teams: A.listDiskTeams(diskId) } })
    } catch (e: any) {
      if (reportDb) reportDb.close()
      return reply.code(500).send({ status: 'error', message: e.message })
    }
  })

  // Get all user names from report.db for a disk
  app.get('/api/admin/disks/:id/users', async (req: any, reply) => {
    requireAuth(req, reply)
    const diskId = Number.parseInt(req.params.id, 10)
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })

    const spaces = A.listSpacesWithDisks()
    const disk = spaces.flatMap((s) => s.disks).find((d) => d.id === diskId)
    if (!disk) return reply.code(404).send({ status: 'error', message: 'Disk not found' })

    const rp = join(disk.path, 'report.db')
    if (!existsSync(rp)) return reply.code(404).send({ status: 'error', message: 'report.db not found' })

    let reportDb: Database.Database | null = null
    try {
      reportDb = new Database(rp, { readonly: true })
      const rows = reportDb
        .prepare('SELECT DISTINCT username FROM detail_users WHERE total_size > 0 ORDER BY username')
        .all() as { username: string }[]
      reportDb.close()
      return reply.send({ status: 'success', data: rows.map((r) => r.username) })
    } catch (e: any) {
      if (reportDb) reportDb.close()
      return reply.code(500).send({ status: 'error', message: e.message })
    }
  })

  app.delete('/api/admin/disks/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    A.deleteDisk(id)
    return reply.send({ status: 'success', data: null })
  })

  // --- Disk Teams (admin+) ---
  app.get('/api/admin/disks/:id/teams', async (req: any, reply) => {
    requireAuth(req, reply)
    const diskId = Number.parseInt(req.params.id, 10)
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })
    return reply.send({ status: 'success', data: A.listDiskTeams(diskId) })
  })

  app.post('/api/admin/disks/:id/teams', async (req: any, reply) => {
    requireAuth(req, reply)
    const diskId = Number.parseInt(req.params.id, 10)
    const { name } = req.body ?? {}
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })
    if (!name || typeof name !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Team name required' })
    }
    return reply.code(201).send({ status: 'success', data: A.createDiskTeam(diskId, name) })
  })

  app.put('/api/admin/teams/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    const { name, users } = req.body ?? {}
    if (name !== undefined && typeof name !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Name must be a string' })
    }
    if (users !== undefined && !Array.isArray(users)) {
      return reply.code(422).send({ status: 'error', message: 'Users must be an array' })
    }
    A.updateDiskTeam(id, { name, users })
    return reply.send({ status: 'success', data: null })
  })

  app.delete('/api/admin/teams/:id', async (req: any, reply) => {
    requireAuth(req, reply)
    const id = Number.parseInt(req.params.id, 10)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    A.deleteDiskTeam(id)
    return reply.send({ status: 'success', data: null })
  })

  // --- Backup & Restore (owner only) ---
  app.get('/api/admin/backups', async (req: any, reply) => {
    requireAuth(req, reply)
    return reply.send({ status: 'success', data: A.listBackups() })
  })

  app.post('/api/admin/backups', async (req: any, reply) => {
    requireAuth(req, reply)
    return reply.code(201).send({ status: 'success', data: A.createBackup() })
  })

  app.post('/api/admin/backups/:name/restore', async (req: any, reply) => {
    requireOwner(req, reply)
    const ok = A.restoreBackup(req.params.name)
    if (!ok) return reply.code(404).send({ status: 'error', message: 'Backup not found' })
    return reply.send({ status: 'success', data: null })
  })

  app.delete('/api/admin/backups/:name', async (req: any, reply) => {
    requireAuth(req, reply)
    const ok = A.deleteBackup(req.params.name)
    if (!ok) return reply.code(404).send({ status: 'error', message: 'Backup not found' })
    return reply.send({ status: 'success', data: null })
  })

  // --- Stats ---
  app.get('/api/admin/stats', async (_req: any, reply) => {
    return reply.send({ status: 'success', data: A.getSummaryStats() })
  })
}
