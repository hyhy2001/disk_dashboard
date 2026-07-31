import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeAdminDb,
  createDisk,
  createSpace,
  updateDisk,
  validateDiskPath,
  testDiskRead,
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
