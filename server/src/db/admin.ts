// Admin database — a single SQLite DB holding accounts, spaces, and disks.
//
// This is the *only* writable component. All report.db reads remain readonly.
// The DB lives at DASHBOARD_ADMIN_DB with a default next to the server module.

import Database from 'better-sqlite3'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, resolve, join } from 'node:path'

// ---------------------------------------------------------------------------
// Path & singleton
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null

function adminDbPath(): string {
  const fromEnv = process.env.DASHBOARD_ADMIN_DB
  // A relative value in .env is anchored to the repo root, not cwd, so the
  // dashboard stays portable across machines and launch directories.
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(repoRoot(), fromEnv)
  const repo = repoRoot()
  return resolve(repo, 'server', 'admin.db')
}

function repoRoot(): string {
  let dir = dirname(new URL(import.meta.url).pathname)
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join2(dir, 'package.json')) && existsSync(join2(dir, 'shared'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return process.cwd()
}

function join2(a: string, b: string): string {
  return a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '')
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE IF NOT EXISTS admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  password_hash   TEXT    NOT NULL,
  role            TEXT    NOT NULL DEFAULT 'admin',
  created_at      TEXT    NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ip  TEXT    NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_attempts_ip ON login_attempts(ip, ts);

CREATE TABLE IF NOT EXISTS spaces (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS disks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id   INTEGER NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  path       TEXT    NOT NULL,
  slug       TEXT    NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(space_id, name)
);

CREATE TABLE IF NOT EXISTS disk_teams (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  disk_id INTEGER NOT NULL REFERENCES disks(id) ON DELETE CASCADE,
  name    TEXT    NOT NULL,
  users   TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_disk_teams_disk ON disk_teams(disk_id);

CREATE TABLE IF NOT EXISTS captcha_challenges (
  id        TEXT    PRIMARY KEY,
  answer    INTEGER NOT NULL,
  expires   INTEGER NOT NULL
);
`

/** Open (or return the cached) admin DB, applying DDL migrations on first open. */
export function adminDb(): Database.Database {
  if (_db) return _db
  const dbPath = adminDbPath()
  const parent = dirname(dbPath)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true })
  _db = new Database(dbPath)
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.exec(DDL)
  // Migrate roles for DBs that predate the `role` column.
  migrateRoles(_db)
  // Add the unique route slug to disks for DBs that predate it.
  migrateDisksSlug(_db)
  // Enforce unique disk names within a space (duplicates renamed on migration).
  migrateDiskSpaceName(_db)
  // Track a per-account session version so password/role changes revoke cookies.
  migrateSessionVersion(_db)
  return _db
}

function migrateRoles(db: Database.Database): void {
  const cols = db.pragma('table_info(admins)') as { name: string }[]
  if (!cols.some((c) => c.name === 'role')) {
    db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'")
  }
  const owner = db.prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'owner'").get() as { c: number }
  if (owner.c === 0) {
    db.exec("UPDATE admins SET role = 'owner' WHERE id = (SELECT id FROM admins ORDER BY id ASC LIMIT 1)")
  }
}

/**
 * Backfill `disks.slug` for DBs created before the slug column existed. Existing
 * rows get a random hex token so renames never change the URL, and the column is
 * left non-NULL going forward.
 */
function migrateDisksSlug(db: Database.Database): void {
  const cols = db.pragma('table_info(disks)') as { name: string }[]
  if (!cols.some((c) => c.name === 'slug')) {
    db.exec('ALTER TABLE disks ADD COLUMN slug TEXT')
  }
  const missing = db.prepare("SELECT id FROM disks WHERE slug IS NULL OR slug = ''").all() as { id: number }[]
  for (const { id } of missing) {
    db.prepare('UPDATE disks SET slug = ? WHERE id = ?').run(randomBytes(6).toString('hex'), id)
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_disks_slug ON disks(slug)')
}

/**
 * Enforce unique disk names within a space. DBs that predate the UNIQUE
 * (space_id, name) constraint get their duplicates renamed to `name (N)` so the
 * index can be created without data loss.
 */
function migrateDiskSpaceName(db: Database.Database): void {
  const dups = db
    .prepare(
      `SELECT d.id, d.name FROM disks d
     JOIN disks d2 ON d2.space_id = d.space_id AND d2.name = d.name AND d2.id < d.id`,
    )
    .all() as { id: number; name: string }[]
  const seen = new Map<number, number>()
  for (const { id, name } of dups) {
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    db.prepare('UPDATE disks SET name = ? WHERE id = ?').run(`${name} (${n})`, id)
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_disks_space_name ON disks(space_id, name)')
}

/**
 * Bump of the account's session_version is what revokes outstanding cookies.
 * Backfills the column for DBs that predate it; new accounts default to 1.
 */
function migrateSessionVersion(db: Database.Database): void {
  const cols = db.pragma('table_info(admins)') as { name: string }[]
  if (!cols.some((c) => c.name === 'session_version')) {
    db.exec('ALTER TABLE admins ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1')
  }
}

export function closeAdminDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

// ---------------------------------------------------------------------------
// Password hashing — scrypt, 64-bit salt, no external deps
// ---------------------------------------------------------------------------

const KEYLEN = 64
const SALT_LEN = 16

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  try {
    const derived = scryptSync(password, salt, KEYLEN)
    return timingSafeEqual(derived, Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Session tokens — HMAC-SHA256 with a random server key
// ---------------------------------------------------------------------------

let _sessionKey: Buffer | null = null

function sessionKey(): Buffer {
  if (!_sessionKey) _sessionKey = randomBytes(32)
  return _sessionKey
}

import { createHmac } from 'node:crypto'

/** How long a session stays valid before the user has to sign in again. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export function signSession(payload: string): string {
  const expires = Math.floor((Date.now() + SESSION_TTL_MS) / 1000)
  const body = `${payload}:${expires}`
  const hmac = createHmac('sha256', sessionKey()).update(body).digest('hex')
  return `${body}.${hmac}`
}

export function verifySession(token: string): string | null {
  const idx = token.lastIndexOf('.')
  if (idx === -1) return null
  const body = token.slice(0, idx)
  const hmac = token.slice(idx + 1)
  const expected = createHmac('sha256', sessionKey()).update(body).digest('hex')
  try {
    if (!timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch {
    return null
  }
  // `body` is `${id}:${role}:${username}:${expires}`; drop the trailing expiry
  // so callers keep seeing the same `${id}:${role}:${username}` payload.
  const sep = body.lastIndexOf(':')
  if (sep === -1) return null
  const expires = Number(body.slice(sep + 1))
  if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) return null
  return body.slice(0, sep)
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const RATE_WINDOW = 300 // 5 minutes
const RATE_MAX = 10
const RATE_CAPTCHA = 5

export function rateLimitCheck(ip: string): { allowed: boolean; attempts: number; captcha: boolean } {
  const db = adminDb()
  const cutoff = Math.floor(Date.now() / 1000) - RATE_WINDOW
  db.prepare('DELETE FROM login_attempts WHERE ip = ? AND ts < ?').run(ip, cutoff)
  const row = db.prepare('SELECT COUNT(*) as c FROM login_attempts WHERE ip = ?').get(ip) as { c: number }
  const attempts = row.c
  return { allowed: attempts < RATE_MAX, attempts, captcha: attempts >= RATE_CAPTCHA }
}

export function rateLimitRecord(ip: string): void {
  adminDb()
    .prepare('INSERT INTO login_attempts(ip, ts) VALUES (?, ?)')
    .run(ip, Math.floor(Date.now() / 1000))
}

export function rateLimitClear(ip: string): void {
  adminDb().prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip)
}

// ---------------------------------------------------------------------------
// CAPTCHA
// ---------------------------------------------------------------------------

const CAPTCHA_TTL = 120_000 // 2 minutes

export interface CaptchaChallenge {
  id: string
  question: string
}

export function createCaptcha(): CaptchaChallenge {
  const a = Math.floor(Math.random() * 8) + 2
  const b = Math.floor(Math.random() * 8) + 2
  const ops = ['+', '-', '*']
  const op = ops[Math.floor(Math.random() * 3)]
  let answer: number
  let question: string
  switch (op) {
    case '+':
      answer = a + b
      question = `${a} + ${b} = ?`
      break
    case '-':
      answer = Math.max(a, b) - Math.min(a, b)
      question = `${Math.max(a, b)} - ${Math.min(a, b)} = ?`
      break
    default:
      answer = a * b
      question = `${a} × ${b} = ?`
      break
  }
  const id = randomBytes(8).toString('hex')
  const db = adminDb()
  db.prepare('INSERT INTO captcha_challenges (id, answer, expires) VALUES (?, ?, ?)').run(
    id,
    answer,
    Date.now() + CAPTCHA_TTL,
  )
  // Cleanup expired challenges
  db.prepare('DELETE FROM captcha_challenges WHERE expires < ?').run(Date.now())
  return { id, question }
}

export function verifyCaptcha(id: string, answer: number): boolean {
  const row = adminDb()
    .prepare('SELECT answer FROM captcha_challenges WHERE id = ? AND expires > ?')
    .get(id, Date.now()) as { answer: number } | undefined
  if (!row) return false
  adminDb().prepare('DELETE FROM captcha_challenges WHERE id = ?').run(id)
  return row.answer === answer
}

// ---------------------------------------------------------------------------
// Account CRUD
// ---------------------------------------------------------------------------

export interface AdminAccount {
  id: number
  username: string
  role: string
  created_at: string
}

/** An account plus the internal fields the routes need for session checks. */
export interface AdminWithSession extends AdminAccount {
  password_hash?: string
  /** Bumped on password change; stale sessions signed with an older value fail. */
  session_version: number
}

export function getAdminByUsername(username: string): (AdminWithSession & { password_hash: string }) | null {
  const row = adminDb()
    .prepare('SELECT id, username, password_hash, role, created_at, session_version FROM admins WHERE username = ?')
    .get(username) as (AdminWithSession & { password_hash: string }) | undefined
  return row ?? null
}

/** Look up an account by id — used to validate sessions against live state. */
export function getAdminById(id: number): AdminWithSession | null {
  const row = adminDb()
    .prepare('SELECT id, username, role, created_at, session_version FROM admins WHERE id = ?')
    .get(id) as AdminWithSession | undefined
  return row ?? null
}

export function listAdmins(): AdminAccount[] {
  return adminDb().prepare('SELECT id, username, role, created_at FROM admins ORDER BY id').all() as AdminAccount[]
}

export function createAdmin(username: string, password: string, role: string = 'admin'): AdminWithSession {
  const hash = hashPassword(password)
  const db = adminDb()
  const info = db
    .prepare('INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, role, new Date().toISOString())
  return db
    .prepare('SELECT id, username, role, created_at, session_version FROM admins WHERE id = ?')
    .get(info.lastInsertRowid) as AdminWithSession
}

export function deleteAdmin(id: number): boolean {
  // Can't delete the last owner.
  const target = adminDb().prepare('SELECT role FROM admins WHERE id = ?').get(id) as { role: string } | undefined
  if (!target || target.role === 'owner') {
    const owners = adminDb().prepare("SELECT COUNT(*) as c FROM admins WHERE role = 'owner'").get() as { c: number }
    if (target?.role === 'owner' && owners.c <= 1) return false
  }
  return adminDb().prepare('DELETE FROM admins WHERE id = ?').run(id).changes > 0
}

export function changePassword(id: number, newPassword: string): boolean {
  const hash = hashPassword(newPassword)
  // Bumping session_version revokes every cookie this account already holds, so a
  // stolen session dies the moment the owner changes the password.
  return (
    adminDb()
      .prepare('UPDATE admins SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
      .run(hash, id).changes > 0
  )
}

export function hasAnyAdmin(): boolean {
  const row = adminDb().prepare('SELECT COUNT(*) as c FROM admins').get() as { c: number }
  return row.c > 0
}

// ---------------------------------------------------------------------------
// Spaces & Disks CRUD
// ---------------------------------------------------------------------------

export interface Space {
  id: number
  name: string
  sort_order: number
}

export interface Disk {
  id: number
  space_id: number
  name: string
  path: string
  /** Globally-unique random hex token used as the route id. */
  slug: string
  sort_order: number
}

export interface SpaceWithDisks extends Space {
  disks: Disk[]
}

export function listSpaces(): Space[] {
  return adminDb().prepare('SELECT id, name, sort_order FROM spaces ORDER BY sort_order, id').all() as Space[]
}

export function listSpacesWithDisks(): SpaceWithDisks[] {
  const spaces = listSpaces()
  const disks = adminDb()
    .prepare('SELECT id, space_id, name, path, slug, sort_order FROM disks ORDER BY sort_order, id')
    .all() as Disk[]
  const diskMap = new Map<number, Disk[]>()
  for (const d of disks) {
    const list = diskMap.get(d.space_id) ?? []
    list.push(d)
    diskMap.set(d.space_id, list)
  }
  return spaces.map((s) => ({ ...s, disks: diskMap.get(s.id) ?? [] }))
}

/** Look up a disk by its globally-unique route slug. */
export function diskBySlug(slug: string): Disk | null {
  const row = adminDb()
    .prepare('SELECT id, space_id, name, path, slug, sort_order FROM disks WHERE slug = ?')
    .get(slug) as Disk | undefined
  return row ?? null
}

/** Look up a disk by id. Needed to learn a disk's path before it is changed. */
export function diskById(id: number): Disk | null {
  const row = adminDb()
    .prepare('SELECT id, space_id, name, path, slug, sort_order FROM disks WHERE id = ?')
    .get(id) as Disk | undefined
  return row ?? null
}

export function createSpace(name: string): Space {
  const db = adminDb()
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM spaces').get() as { n: number }
  const info = db.prepare('INSERT INTO spaces (name, sort_order) VALUES (?, ?)').run(name, maxOrder.n)
  return db.prepare('SELECT id, name, sort_order FROM spaces WHERE id = ?').get(info.lastInsertRowid) as Space
}

export function updateSpace(id: number, name: string): boolean {
  return adminDb().prepare('UPDATE spaces SET name = ? WHERE id = ?').run(name, id).changes > 0
}

export function deleteSpace(id: number): boolean {
  return adminDb().prepare('DELETE FROM spaces WHERE id = ?').run(id).changes > 0
}

export function createDisk(spaceId: number, name: string, path: string): Disk {
  const valid = validateDiskPath(path)
  if (!valid.ok) throw new Error(valid.reason)
  const db = adminDb()
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM disks WHERE space_id = ?')
    .get(spaceId) as { n: number }
  const info = db
    .prepare('INSERT INTO disks (space_id, name, path, slug, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(spaceId, name, path, randomBytes(6).toString('hex'), maxOrder.n)
  return db
    .prepare('SELECT id, space_id, name, path, slug, sort_order FROM disks WHERE id = ?')
    .get(info.lastInsertRowid) as Disk
}

export function updateDisk(id: number, fields: { name?: string; path?: string }): boolean {
  const sets: string[] = []
  const params: any[] = []
  if (fields.name !== undefined) {
    sets.push('name = ?')
    params.push(fields.name)
  }
  if (fields.path !== undefined) {
    sets.push('path = ?')
    params.push(fields.path)
  }
  if (sets.length === 0) return false
  params.push(id)
  return (
    adminDb()
      .prepare(`UPDATE disks SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params).changes > 0
  )
}

// ---------------------------------------------------------------------------
// Disk path validation & read test
// ---------------------------------------------------------------------------

/**
 * Reject a disk path that could point the report reader outside what the admin
 * intended. A path must be absolute (so it is explicit about what it reads) and
 * must reference an existing directory; the report.db check is separate because
 * a disk can be configured before its first scan.
 */
export function validateDiskPath(path: string): { ok: true } | { ok: false; reason: string } {
  if (typeof path !== 'string' || path.trim().length === 0) {
    return { ok: false, reason: 'path is required' }
  }
  if (!path.startsWith('/')) {
    return { ok: false, reason: 'path must be absolute (start with /)' }
  }
  try {
    if (!existsSync(path)) return { ok: false, reason: 'directory does not exist' }
    if (!statSync(path).isDirectory()) return { ok: false, reason: 'path is not a directory' }
  } catch {
    return { ok: false, reason: 'cannot read directory' }
  }
  return { ok: true }
}

export interface DiskReadTest {
  path: string
  reportFound: boolean
  reportReadable: boolean
  scanRoot?: string
  scanTimestamp?: number
  totalSize?: number
  totalFiles?: number
  totalDirs?: number
  message?: string
}

/**
 * Open a disk's report.db readonly and report what is there. Used by the admin
 * "Test read" button so a mapping can be verified before it is saved.
 */
export function testDiskRead(path: string): DiskReadTest {
  const valid = validateDiskPath(path)
  if (!valid.ok) return { path, reportFound: false, reportReadable: false, message: valid.reason }

  const rp = join(path, 'report.db')
  if (!existsSync(rp)) {
    return { path, reportFound: false, reportReadable: false, message: 'report.db not found (not scanned yet?)' }
  }

  try {
    const db = new Database(rp, { readonly: true, fileMustExist: true })
    const meta = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]
    db.close()
    const m: Record<string, string> = {}
    for (const r of meta) m[r.key] = r.value
    return {
      path,
      reportFound: true,
      reportReadable: true,
      scanRoot: m.scan_root ?? m.scan_path,
      scanTimestamp: Number(m.scan_timestamp) || undefined,
      totalSize: Number(m.total_size) || undefined,
      totalFiles: Number(m.total_files) || undefined,
      totalDirs: Number(m.total_dirs) || undefined,
    }
  } catch {
    return { path, reportFound: true, reportReadable: false, message: 'report.db exists but could not be read' }
  }
}

export function deleteDisk(id: number): boolean {
  return adminDb().prepare('DELETE FROM disks WHERE id = ?').run(id).changes > 0
}

// ---------------------------------------------------------------------------
// Disk Teams CRUD
// ---------------------------------------------------------------------------

export interface DiskTeam {
  id: number
  disk_id: number
  name: string
  users: string[]
}

export function listDiskTeams(diskId: number): DiskTeam[] {
  const rows = adminDb()
    .prepare('SELECT id, disk_id, name, users FROM disk_teams WHERE disk_id = ? ORDER BY name')
    .all(diskId) as { id: number; disk_id: number; name: string; users: string }[]
  return rows.map((r) => ({ ...r, users: JSON.parse(r.users) as string[] }))
}

export function getDiskTeam(id: number): DiskTeam | null {
  const r = adminDb()
    .prepare('SELECT id, disk_id, name, users FROM disk_teams WHERE id = ?')
    .get(id) as { id: number; disk_id: number; name: string; users: string } | undefined
  return r ? { ...r, users: JSON.parse(r.users) as string[] } : null
}

/**
 * Usernames in `users` that are already assigned to another team of the same
 * disk (case-insensitive). One user cannot belong to two teams on one disk: the
 * overview's team lookup is a Map keyed by username, so a duplicate would
 * silently let whichever team saved last win.
 */
export function teamUserClashes(diskId: number, exceptTeamId: number | null, users: string[]): string[] {
  const wanted = new Set(users.map((u) => u.toLowerCase()))
  const rows = adminDb().prepare('SELECT id, users FROM disk_teams WHERE disk_id = ?').all(diskId) as {
    id: number
    users: string
  }[]
  const clashes = new Set<string>()
  for (const r of rows) {
    if (exceptTeamId !== null && r.id === exceptTeamId) continue
    for (const u of JSON.parse(r.users) as string[]) {
      if (wanted.has(u.toLowerCase())) clashes.add(u)
    }
  }
  return [...clashes]
}

export function createDiskTeam(diskId: number, name: string): DiskTeam {
  const db = adminDb()
  const info = db.prepare('INSERT INTO disk_teams (disk_id, name, users) VALUES (?, ?, ?)').run(diskId, name, '[]')
  return db
    .prepare('SELECT id, disk_id, name, users FROM disk_teams WHERE id = ?')
    .get(info.lastInsertRowid) as DiskTeam
}

export function updateDiskTeam(id: number, fields: { name?: string; users?: string[] }): boolean {
  const sets: string[] = []
  const params: any[] = []
  if (fields.name !== undefined) {
    sets.push('name = ?')
    params.push(fields.name)
  }
  if (fields.users !== undefined) {
    sets.push('users = ?')
    params.push(JSON.stringify(fields.users))
  }
  if (sets.length === 0) return false
  params.push(id)
  return (
    adminDb()
      .prepare(`UPDATE disk_teams SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params).changes > 0
  )
}

export function deleteDiskTeam(id: number): boolean {
  return adminDb().prepare('DELETE FROM disk_teams WHERE id = ?').run(id).changes > 0
}

// ---------------------------------------------------------------------------
// Backup & Restore
// ---------------------------------------------------------------------------

const BACKUP_DIR = 'backups'

function backupDir(): string {
  const dir = join(dirname(adminDbPath()), BACKUP_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export interface BackupInfo {
  name: string
  mtime: string
  size: number
}

export async function createBackup(): Promise<BackupInfo> {
  const db = adminDb()
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const name = `admin_backup_${stamp}.db`
  const dest = join(backupDir(), name)
  // better-sqlite3's backup() is async — it streams in chunks and resolves only
  // once the file is complete. Await it before stat'ing the result, otherwise
  // statSync races the still-writing file and throws ENOENT.
  await db.backup(dest)
  const st = statSync(dest)
  return { name, mtime: st.mtime.toISOString(), size: st.size }
}

export function listBackups(): BackupInfo[] {
  const dir = backupDir()
  const files = readdirSync(dir).filter((f) => f.startsWith('admin_backup_') && f.endsWith('.db'))
  files.sort().reverse()
  return files.slice(0, 100).map((name) => {
    const st = statSync(join(dir, name))
    return { name, mtime: st.mtime.toISOString(), size: st.size }
  })
}

export function restoreBackup(name: string): boolean {
  const src = join(backupDir(), name)
  if (!existsSync(src)) return false
  adminDb().close()
  _db = null
  copyFileSync(src, adminDbPath())
  // Re-open through adminDb() rather than a bare connection: a backup can predate
  // columns the current build relies on (role, slug, session_version), and only
  // the adminDb() path applies the DDL and migrations that backfill them.
  adminDb()
  return true
}

export function deleteBackup(name: string): boolean {
  const p = join(backupDir(), name)
  if (!existsSync(p)) return false
  unlinkSync(p)
  return true
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

export interface SummaryStats {
  spaces: number
  disks: number
  teams: number
  teamUsers: number
  accounts: number
}

export function getSummaryStats(): SummaryStats {
  const db = adminDb()
  const spaces = (db.prepare('SELECT COUNT(*) as c FROM spaces').get() as { c: number }).c
  const disks = (db.prepare('SELECT COUNT(*) as c FROM disks').get() as { c: number }).c
  const teamRows = db.prepare('SELECT users FROM disk_teams').all() as { users: string }[]
  const teams = teamRows.length
  let teamUsers = 0
  for (const r of teamRows) {
    try {
      teamUsers += (JSON.parse(r.users) as string[]).length
    } catch {
      /* */
    }
  }
  const accounts = (db.prepare('SELECT COUNT(*) as c FROM admins').get() as { c: number }).c
  return { spaces, disks, teams, teamUsers, accounts }
}

// ---------------------------------------------------------------------------
// Public config (no auth required — used for space/disk listing in the UI)
// ---------------------------------------------------------------------------

export interface PublicConfig {
  spaces: SpaceWithDisks[]
  /** True while there are no admin accounts — first visitor becomes owner. */
  needsSetup: boolean
}

export function getPublicConfig(): PublicConfig {
  return {
    spaces: listSpacesWithDisks(),
    needsSetup: !hasAnyAdmin(),
  }
}
