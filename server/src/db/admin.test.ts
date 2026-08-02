import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changePassword,
  closeAdminDb,
  createAdmin,
  createBackup,
  createDisk,
  createSpace,
  deleteAdmin,
  getAdminById,
  listBackups,
  signSession,
  updateDisk,
  validateDiskPath,
  testDiskRead,
  verifySession,
} from './admin.js'

let dir: string | null = null

afterEach(() => {
  closeAdminDb()
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
  delete process.env.DASHBOARD_ADMIN_DB
})

function withTempDb(): string {
  dir = mkdtempSync(join(tmpdir(), 'admin-'))
  process.env.DASHBOARD_ADMIN_DB = join(dir, 'admin.db')
  return dir
}

/** A real directory under the temp db dir, so path validation passes. */
function realPath(name: string): string {
  const base = withTempDb()
  const p = join(base, name)
  mkdirSync(p, { recursive: true })
  return p
}

describe('admin disk uniqueness', () => {
  it('rejects a second disk with the same name in the same space', () => {
    withTempDb()
    const sp = createSpace('ops')
    createDisk(sp.id, 'users', realPath('users'))
    expect(() => createDisk(sp.id, 'users', realPath('users-copy'))).toThrow(/UNIQUE constraint failed/)
  })

  it('allows the same disk name in different spaces', () => {
    withTempDb()
    const a = createSpace('a')
    const b = createSpace('b')
    expect(() => createDisk(a.id, 'users', realPath('a-users')).id).not.toThrow()
    const second = createDisk(b.id, 'users', realPath('b-users'))
    expect(second.name).toBe('users')
  })

  it('rejects renaming a disk onto a sibling name', () => {
    withTempDb()
    const sp = createSpace('ops')
    const d1 = createDisk(sp.id, 'users', realPath('users'))
    createDisk(sp.id, 'apps', realPath('apps'))
    expect(() => updateDisk(d1.id, { name: 'apps' })).toThrow(/UNIQUE constraint failed/)
  })
})

describe('validateDiskPath', () => {
  it('rejects relative paths', () => {
    expect(validateDiskPath('reports/users')).toEqual({ ok: false, reason: 'path must be absolute (start with /)' })
  })

  it('rejects a path that does not exist', () => {
    expect(validateDiskPath('/definitely/not/here')).toEqual({ ok: false, reason: 'directory does not exist' })
  })

  it('accepts an existing directory', () => {
    const p = realPath('ok-dir')
    expect(validateDiskPath(p)).toEqual({ ok: true })
  })
})

describe('testDiskRead', () => {
  it('reports a missing report.db', () => {
    const p = realPath('empty')
    const r = testDiskRead(p)
    expect(r.reportFound).toBe(false)
    expect(r.reportReadable).toBe(false)
  })
})

describe('session revocation', () => {
  it('signs and verifies a token carrying the session version', () => {
    withTempDb()
    const admin = createAdmin('bob', 'long-password-1', 'owner')
    const token = signSession(`${admin.id}:${admin.role}:${admin.username}:${admin.session_version}`)
    expect(verifySession(token)).toBe(`${admin.id}:${admin.role}:${admin.username}:${admin.session_version}`)
  })

  it('bumps the version on password change, killing old cookies', () => {
    withTempDb()
    const admin = createAdmin('bob', 'long-password-1', 'owner')
    const oldVersion = admin.session_version
    const token = signSession(`${admin.id}:${admin.role}:${admin.username}:${oldVersion}`)
    expect(verifySession(token)).not.toBeNull()

    expect(changePassword(admin.id, 'a-new-longer-password-here')).toBe(true)
    const refreshed = getAdminById(admin.id)!
    expect(refreshed.session_version).toBe(oldVersion + 1)

    // The payload still verifies cryptographically (the HMAC is unchanged) but
    // carries the stale version, which is exactly what the route's live-state
    // check rejects. Simulating that check here keeps the assertion at the
    // layer this file tests.
    const staleVersion = Number(verifySession(token)!.split(':')[3])
    expect(staleVersion).not.toBe(refreshed.session_version)
  })

  it('leaves a deleted account with no row to validate against', () => {
    withTempDb()
    const owner = createAdmin('bob', 'long-password-1', 'owner')
    const admin = createAdmin('carol', 'long-password-2', 'admin')
    expect(deleteAdmin(admin.id)).toBe(true)
    expect(getAdminById(admin.id)).toBeNull()
    expect(getAdminById(owner.id)).not.toBeNull()
  })

  it('writes a complete backup file (async backup awaited)', async () => {
    const base = withTempDb()
    const diskPath = join(base, 'vol1')
    mkdirSync(diskPath, { recursive: true })
    const sp = createSpace('prod')
    createDisk(sp.id, 'data', diskPath)

    const info = await createBackup()
        expect(info.name).toMatch(/^admin_backup_\d{4}-\d{2}-\d{2}T\d{4}\.db$/)
    expect(info.size).toBeGreaterThan(0)

    const dest = join(base, 'backups', info.name)
    const st = statSync(dest)
    expect(st.size).toBe(info.size)
    expect(listBackups().some((b) => b.name === info.name)).toBe(true)
  })
})
