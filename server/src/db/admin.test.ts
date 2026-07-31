import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAdminDb, createDisk, createSpace, updateDisk } from './admin.js'

let dir: string | null = null

afterEach(() => {
  closeAdminDb()
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
    dir = null
  }
  delete process.env.DASHBOARD_ADMIN_DB
})

function withTempDb(): void {
  dir = mkdtempSync(join(tmpdir(), 'admin-'))
  process.env.DASHBOARD_ADMIN_DB = join(dir, 'admin.db')
}

describe('admin disk uniqueness', () => {
  it('rejects a second disk with the same name in the same space', () => {
    withTempDb()
    const sp = createSpace('ops')
    createDisk(sp.id, 'users', '/srv/users')
    expect(() => createDisk(sp.id, 'users', '/srv/users-copy')).toThrow(/UNIQUE constraint failed/)
  })

  it('allows the same disk name in different spaces', () => {
    withTempDb()
    const a = createSpace('a')
    const b = createSpace('b')
    expect(() => createDisk(a.id, 'users', '/srv/a').id).not.toThrow()
    const second = createDisk(b.id, 'users', '/srv/b')
    expect(second.name).toBe('users')
  })

  it('rejects renaming a disk onto a sibling name', () => {
    withTempDb()
    const sp = createSpace('ops')
    const d1 = createDisk(sp.id, 'users', '/srv/users')
    createDisk(sp.id, 'apps', '/srv/apps')
    expect(() => updateDisk(d1.id, { name: 'apps' })).toThrow(/UNIQUE constraint failed/)
  })
})
