// Admin API routes — auth, accounts, spaces, disks.
//
// Session: a signed cookie `du_sess` carrying `adminId:role:username`.
// The HMAC-based signature (rather than a random token) means the server
// can validate the session without a session store — stateless, like JWT
// but simpler.

import type { FastifyInstance } from 'fastify'
import * as A from '../db/admin.js'
import { evictReport, REPORT_FILE } from '../db/reports.js'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a numeric path param strictly: '12garbage' must not read as 12. */
function intParam(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : 0
}

const SESSION_COOKIE = 'du_sess'
// maxAge mirrors the token expiry in signSession so the browser drops the cookie
// when the server would reject it. `secure` is off by default because the
// server has no way to prove the upstream connection is TLS; deployments behind
// an HTTPS reverse proxy must set DASHBOARD_COOKIE_SECURE=true so the cookie is
// never sent over plain HTTP.
const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.DASHBOARD_COOKIE_SECURE === 'true',
  maxAge: 7 * 24 * 60 * 60,
}

interface AuthUser {
  id: number
  username: string
  role: string
}

/**
 * Parse the session cookie and return the authenticated user, or null.
 *
 * The cookie is HMAC-signed (so it cannot be forged) and carries an expiry, but
 * neither of those revokes a session when the account is deleted, demoted, or
 * has its password changed. Every request therefore re-checks the cookie against
 * the live admin row: the account must still exist with the same username, role,
 * and session_version, or the cookie is dead.
 */
function authUser(req: any): AuthUser | null {
  const raw = req.cookies?.[SESSION_COOKIE]
  if (!raw) return null
  const payload = A.verifySession(raw)
  if (!payload) return null
  const parts = payload.split(':')
  const idStr = parts[0]!
  const role = parts[1]
  const username = parts[2]
  const versionStr = parts[3]
  const id = intParam(idStr)
  if (!id || !role || !username) return null

  const admin = A.getAdminById(id)
  if (!admin || admin.username !== username || admin.role !== role) return null
  if (Number(versionStr) !== admin.session_version) return null
  return { id, role, username }
}

/**
 * Require auth — sends 401 and returns null when not authenticated.
 *
 * Returns null rather than `reply` so the caller must return early: sending the
 * response here and letting the handler send its own would call `reply.send`
 * twice, which Fastify flags as a double-send error on every unauthenticated
 * request.
 */
function requireAuth(req: any, reply: any): AuthUser | null {
  const user = authUser(req)
  if (!user) {
    reply.code(401).send({ status: 'error', message: 'Unauthorized' })
    return null
  }
  return user
}

/** Require owner role — sends 403 and returns null otherwise. */
function requireOwner(req: any, reply: any): AuthUser | null {
  const user = requireAuth(req, reply)
  if (!user) return null
  if (user.role !== 'owner') {
    reply.code(403).send({ status: 'error', message: 'Owner access required' })
    return null
  }
  return user
}

function clientIp(req: any): string {
  // req.ip honors the Fastify trustProxy setting: with it off (the default) it
  // is the socket address and the X-Forwarded-For header is ignored, so a client
  // cannot spoof the value used for rate limiting. Behind a trusted proxy it
  // resolves through the header instead.
  return req.ip || 'unknown'
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

/**
 * Shared username/password rules for setup and account creation, so an owner
 * cannot create an account weaker than the rules the first admin had to meet.
 * Returns an error message, or null when the pair is acceptable.
 */
function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return 'Username and password required'
  }
  if (username.length < 3 || username.length > 64) {
    return 'Username must be 3-64 characters'
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return 'Username contains invalid characters'
  }
  if (password.length < 10) {
    return 'Password must be at least 10 characters'
  }
  return null
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
    const invalid = validateCredentials(username, password)
    if (invalid) return reply.code(422).send({ status: 'error', message: invalid })
    const admin = A.createAdmin(username, password, 'owner')
    const token = A.signSession(`${admin.id}:owner:${admin.username}:${admin.session_version}`)
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
    // Verify against a real hash even when the username does not exist, so a
    // failed login costs the same scrypt work either way — otherwise the
    // timing difference reveals which usernames are valid.
    const hash = admin ? admin.password_hash : A.DUMMY_HASH
    if (!admin || !A.verifyPassword(password, hash)) {
      A.rateLimitRecord(ip)
      const after = A.rateLimitCheck(ip)
      return reply.code(401).send({
        status: 'error',
        message: 'Invalid credentials',
        rateLimit: { captcha: after.captcha, attempts: after.attempts },
      })
    }
    A.rateLimitClear(ip)
    const token = A.signSession(`${admin.id}:${admin.role}:${admin.username}:${admin.session_version}`)
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
    if (!requireOwner(req, reply)) return
    return reply.send({ status: 'success', data: A.listAdmins() })
  })

  app.post('/api/admin/accounts', async (req: any, reply) => {
    if (!requireOwner(req, reply)) return
    const { username, password, role } = req.body ?? {}
    const invalid = validateCredentials(username, password)
    if (invalid) return reply.code(422).send({ status: 'error', message: invalid })
    if (role !== undefined && role !== 'admin' && role !== 'owner') {
      return reply.code(422).send({ status: 'error', message: 'Role must be admin or owner' })
    }
    const admin = A.createAdmin(username, password, role ?? 'admin')
    return reply.code(201).send({ status: 'success', data: admin })
  })

  app.delete('/api/admin/accounts/:id', async (req: any, reply) => {
    if (!requireOwner(req, reply)) return
    const id = intParam(req.params.id)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    const ok = A.deleteAdmin(id)
    if (!ok) return reply.code(400).send({ status: 'error', message: 'Cannot delete the last owner' })
    return reply.send({ status: 'success', data: null })
  })

  app.post('/api/admin/accounts/:id/password', async (req: any, reply) => {
    if (!requireOwner(req, reply)) return
    const id = intParam(req.params.id)
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
    if (!user) return
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
    if (!requireAuth(req, reply)) return
    return reply.send({ status: 'success', data: A.listSpacesWithDisks() })
  })

  app.post('/api/admin/spaces', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
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
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
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
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    A.deleteSpace(id)
    return reply.send({ status: 'success', data: null })
  })

  app.post('/api/admin/disks', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const { space_id, name, path } = req.body ?? {}
    if (!space_id || !name || !path) {
      return reply.code(422).send({ status: 'error', message: 'space_id, name, and path required' })
    }
    const valid = A.validateDiskPath(path)
    if (!valid.ok) return reply.code(422).send({ status: 'error', message: valid.reason })
    try {
      return reply.code(201).send({ status: 'success', data: A.createDisk(space_id, name, path) })
    } catch (e) {
      uniqueGuard(reply, e, 'disk name in this space')
    }
  })

  app.put('/api/admin/disks/:id', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
    const { name, path } = req.body ?? {}
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    if (path !== undefined) {
      const valid = A.validateDiskPath(path)
      if (!valid.ok) return reply.code(422).send({ status: 'error', message: valid.reason })
    }
    // Repointing a disk leaves the old report.db's readonly handle cached under
    // its absolute path, so reads would keep serving the previous file. The cache
    // only reopens when the *same* path's stamp moves, which never happens here.
    const before = path !== undefined ? A.diskById(id) : null
    try {
      A.updateDisk(id, { name, path })
      if (before && before.path !== path) evictReport(join(before.path, REPORT_FILE), before.slug)
    } catch (e) {
      uniqueGuard(reply, e, 'disk name in this space')
    }
    return reply.send({ status: 'success', data: null })
  })

  // Verify a disk path before saving the mapping: report.db presence and the
  // meta fields the dashboard will show. Readonly, so it is safe to poke.
  app.post('/api/admin/disks/test-read', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const { path } = req.body ?? {}
    if (typeof path !== 'string' || !path) {
      return reply.code(422).send({ status: 'error', message: 'path required' })
    }
    return reply.send({ status: 'success', data: A.testDiskRead(path) })
  })

  // Import teams from report.db into admin.db (idempotent)
  app.post('/api/admin/disks/:id/import-teams', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const diskId = intParam(req.params.id)
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

      // Replace the disk's teams atomically (idempotent: existing ones are
      // cleared inside the same transaction as the inserts).
      const imported = A.importDiskTeams(
        diskId,
        teamRows.map((t) => ({ name: t.name, users: usersByTeam[t.id] || [] })),
      )

      reportDb.close()
      return reply.send({ status: 'success', data: { imported, teams: A.listDiskTeams(diskId) } })
    } catch {
      if (reportDb) reportDb.close()
      return reply.code(500).send({ status: 'error', message: 'Could not import teams from this report' })
    }
  })

  // Get all user names from report.db for a disk
  app.get('/api/admin/disks/:id/users', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const diskId = intParam(req.params.id)
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
    } catch {
      if (reportDb) reportDb.close()
      return reply.code(500).send({ status: 'error', message: 'Could not read users from this report' })
    }
  })

  app.delete('/api/admin/disks/:id', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    // Close the cached readonly handle too: nothing will ask for this slug again,
    // so without an explicit evict the fd (and its mmap) is held until shutdown —
    // and on a deleted-then-recreated report the stale inode would still be open.
    const disk = A.diskById(id)
    A.deleteDisk(id)
    if (disk) evictReport(join(disk.path, REPORT_FILE), disk.slug)
    return reply.send({ status: 'success', data: null })
  })

  // --- Disk Teams (admin+) ---
  app.get('/api/admin/disks/:id/teams', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const diskId = intParam(req.params.id)
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })
    return reply.send({ status: 'success', data: A.listDiskTeams(diskId) })
  })

  app.post('/api/admin/disks/:id/teams', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const diskId = intParam(req.params.id)
    const { name } = req.body ?? {}
    if (!diskId) return reply.code(422).send({ status: 'error', message: 'Invalid disk id' })
    if (!name || typeof name !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Team name required' })
    }
    return reply.code(201).send({ status: 'success', data: A.createDiskTeam(diskId, name) })
  })

  app.put('/api/admin/teams/:id', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    const { name, users } = req.body ?? {}
    if (name !== undefined && typeof name !== 'string') {
      return reply.code(422).send({ status: 'error', message: 'Name must be a string' })
    }
    if (users !== undefined && !Array.isArray(users)) {
      return reply.code(422).send({ status: 'error', message: 'Users must be an array' })
    }
    if (users !== undefined) {
      const team = A.getDiskTeam(id)
      if (!team) return reply.code(404).send({ status: 'error', message: 'Team not found' })
      const clashes = A.teamUserClashes(team.disk_id, id, users)
      if (clashes.length > 0) {
        return reply.code(422).send({
          status: 'error',
          message: `User${clashes.length > 1 ? 's' : ''} already in another team of this disk: ${clashes.join(', ')}`,
        })
      }
    }
    A.updateDiskTeam(id, { name, users })
    return reply.send({ status: 'success', data: null })
  })

  app.delete('/api/admin/teams/:id', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const id = intParam(req.params.id)
    if (!id) return reply.code(422).send({ status: 'error', message: 'Invalid id' })
    A.deleteDiskTeam(id)
    return reply.send({ status: 'success', data: null })
  })

  // --- Backup & Restore (owner only) ---
  app.get('/api/admin/backups', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    return reply.send({ status: 'success', data: A.listBackups() })
  })

  app.post('/api/admin/backups', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    return reply.code(201).send({ status: 'success', data: A.createBackup() })
  })

  app.post('/api/admin/backups/:name/restore', async (req: any, reply) => {
    if (!requireOwner(req, reply)) return
    const ok = A.restoreBackup(req.params.name)
    if (!ok) return reply.code(404).send({ status: 'error', message: 'Backup not found' })
    return reply.send({ status: 'success', data: null })
  })

  app.delete('/api/admin/backups/:name', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    const ok = A.deleteBackup(req.params.name)
    if (!ok) return reply.code(404).send({ status: 'error', message: 'Backup not found' })
    return reply.send({ status: 'success', data: null })
  })

  // --- Stats ---
  app.get('/api/admin/stats', async (req: any, reply) => {
    if (!requireAuth(req, reply)) return
    return reply.send({ status: 'success', data: A.getSummaryStats() })
  })
}
