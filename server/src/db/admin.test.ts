import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  changePassword,
  closeAdminDb,
  createAdmin,
  createBackup,
  createDisk,
  createDiskTeam,
  createSpace,
  deleteAdmin,
  deleteBackup,
  DUMMY_HASH,
  getAdminById,
  importDiskTeams,
  listBackups,
  listDiskTeams,
  listSpaces,
  listSpacesWithDisks,
  restoreBackup,
  safeBackupName,
  saveLayout,
  signSession,
  teamUserClashes,
  updateDisk,
  updateDiskTeam,
  validateDiskPath,
  verifyPassword,
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

/** A real directory under an already-created temp db dir. */
function realPathIn(base: string, name: string): string {
  const p = join(base, name)
  mkdirSync(p, { recursive: true })
  return p
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
    expect(info.name).toMatch(/^admin_backup_\d{4}-\d{2}-\d{2}T\d{4}_[0-9a-f]{4}\.db$/)
    expect(info.size).toBeGreaterThan(0)

    const dest = join(base, 'backups', info.name)
    const st = statSync(dest)
    expect(st.size).toBe(info.size)
    expect(listBackups().some((b) => b.name === info.name)).toBe(true)
  })
})

describe('backup name validation', () => {
  it('accepts a name produced by createBackup', () => {
    expect(safeBackupName('admin_backup_2026-08-05T1200_1a2b.db')).toBe(true)
  })

  it('rejects names that could escape the backup directory', () => {
    expect(safeBackupName('../admin.db')).toBe(false)
    expect(safeBackupName('..%2Fadmin.db')).toBe(false)
    expect(safeBackupName('admin_backup_2026-08-05T120000.db.gz')).toBe(false)
    expect(safeBackupName('admin_backup_2026-08-05T120000_1a2b.db/extra')).toBe(false)
  })

  it('refuses to delete a file outside the backup directory via a traversal name', () => {
    const base = withTempDb()
    createSpace('prod') // forces the admin DB to be created on disk
    const liveDb = join(base, 'admin.db')
    expect(existsSync(liveDb)).toBe(true)
    expect(deleteBackup('../admin.db')).toBe(false)
    expect(existsSync(liveDb)).toBe(true)
  })

  it('refuses to restore a traversal name', () => {
    withTempDb()
    expect(restoreBackup('../admin.db')).toBe(false)
  })
})

describe('login timing mitigation', () => {
  it('DUMMY_HASH is a real scrypt hash that verifyPassword accepts as input', () => {
    // Must not throw or short-circuit: a missing account should take the same
    // scrypt work as a real one.
    expect(verifyPassword('wrong-password', DUMMY_HASH)).toBe(false)
    expect(DUMMY_HASH).toContain(':')
  })
})

describe('importDiskTeams', () => {
  it("replaces a disk's teams with the imported set in one pass", () => {
    const base = withTempDb()
    const diskPath = join(base, 'vol1')
    mkdirSync(diskPath, { recursive: true })
    const sp = createSpace('prod')
    const disk = createDisk(sp.id, 'data', diskPath)

    const imported = importDiskTeams(disk.id, [
      { name: 'team-a', users: ['root', 'www'] },
      { name: 'team-b', users: [] },
    ])
    expect(imported).toBe(2)
    const teams = listDiskTeams(disk.id)
    expect(teams.map((t) => t.name).sort()).toEqual(['team-a', 'team-b'])
    expect(teams.find((t) => t.name === 'team-a')?.users).toEqual(['root', 'www'])
  })
})

describe('restoreBackup', () => {
  it('keeps a safety copy of the live admin DB before restoring', async () => {
    withTempDb()
    createSpace('prod')
    const backup = await createBackup()
    const before = listBackups().length

    expect(restoreBackup(backup.name)).toBe(true)
    expect(listBackups().length).toBe(before + 1) // the safety copy
  })
})

describe('disk team user clashes', () => {
  it('rejects a username already assigned to another team on the same disk', () => {
    withTempDb()
    const sp = createSpace('prod')
    const disk = createDisk(sp.id, 'data', realPath('data'))
    const t1 = createDiskTeam(disk.id, 'dev')
    const t2 = createDiskTeam(disk.id, 'ops')

    // Give 'alice' to ops first; claiming her in dev must clash.
    updateDiskTeam(t2.id, { users: ['alice', 'bob'] })
    expect(teamUserClashes(disk.id, t1.id, ['alice', 'carol'])).toEqual(['alice'])

    // Re-saving the same team keeps its own members (no self-clash).
    expect(teamUserClashes(disk.id, t2.id, ['alice', 'bob'])).toEqual([])

    // Case-insensitive, and a user on another disk's team never clashes here.
    const other = createDisk(sp.id, 'other', realPath('other'))
    const t3 = createDiskTeam(other.id, 'ops')
    updateDiskTeam(t3.id, { users: ['carol'] })
    // alice lives on `disk` (t2), so claiming carol on `other` must not clash.
    expect(teamUserClashes(other.id, t3.id, ['carol'])).toEqual([])
  })
})

describe('saveLayout', () => {
  it('applies renames, additions and removals in one shot', () => {
    const base = withTempDb()
    const sp = createSpace('prod')
    const keep = createDisk(sp.id, 'data', realPathIn(base, 'data'))
    createDisk(sp.id, 'scratch', realPathIn(base, 'scratch'))
    const gone = createSpace('staging')

    const after = saveLayout([
      {
        id: sp.id,
        name: 'production',
        disks: [
          { id: keep.id, name: 'primary', path: keep.path },
          { name: 'archive', path: realPathIn(base, 'archive') },
        ],
      },
    ])

    expect(after.map((s) => s.name)).toEqual(['production'])
    expect(after[0]?.disks.map((d) => d.name)).toEqual(['primary', 'archive'])
    expect(listSpaces().some((s) => s.id === gone.id)).toBe(false)
  })

  it('leaves the mapping untouched when any disk fails validation', () => {
    const base = withTempDb()
    const sp = createSpace('prod')
    const disk = createDisk(sp.id, 'data', realPathIn(base, 'data'))
    const before = JSON.stringify(listSpacesWithDisks())

    expect(() =>
      saveLayout([
        {
          id: sp.id,
          name: 'renamed',
          disks: [
            { id: disk.id, name: 'data', path: disk.path },
            { name: 'bad', path: join(base, 'does-not-exist') },
          ],
        },
      ]),
    ).toThrow()

    // The rename would have landed first under the old per-entity save loop.
    expect(JSON.stringify(listSpacesWithDisks())).toBe(before)
  })

  it('rejects duplicate disk names within a space before writing', () => {
    const base = withTempDb()
    const sp = createSpace('prod')

    expect(() =>
      saveLayout([
        {
          id: sp.id,
          name: 'prod',
          disks: [
            { name: 'data', path: realPathIn(base, 'a') },
            { name: 'DATA', path: realPathIn(base, 'b') },
          ],
        },
      ]),
    ).toThrow(/two disks named/)
    expect(listSpacesWithDisks()[0]?.disks).toHaveLength(0)
  })

  it('rejects a blank space name', () => {
    withTempDb()
    expect(() => saveLayout([{ name: '  ', disks: [] }])).toThrow(/needs a name/)
  })
})
