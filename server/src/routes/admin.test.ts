import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../db/admin.js'
import { cleanup, createTestApp, login } from './helpers.js'

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
  cleanup()
})

describe('docs gate', () => {
  it('serves the docs UI only to an admin session', async () => {
    app = createTestApp()
    const unauth = await app.inject({ method: 'GET', url: '/docs' })
    expect(unauth.statusCode).toBe(401)

    const cookie = await login(app)
    const ok = await app.inject({ method: 'GET', url: '/docs', headers: { cookie } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toContain('text/html')
  })

  it('exposes the OpenAPI JSON to an admin, with expected paths', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const res = await app.inject({ method: 'GET', url: '/docs/json', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const spec = res.json()
    expect(spec.openapi).toMatch(/^3\./)
    expect(Object.keys(spec.paths)).toContain('/api/health')
  })
})

describe('admin auth', () => {
  it('rejects a login with the wrong password', async () => {
    app = createTestApp()
    createAdmin('bob', 'long-password-1', 'owner')
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'bob', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 401 from admin endpoints without a session', async () => {
    app = createTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats' })
    expect(res.statusCode).toBe(401)
  })

  it('serves admin stats with a valid session', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const res = await app.inject({ method: 'GET', url: '/api/admin/stats', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveProperty('spaces')
  })

  it('locks out after too many failed logins', async () => {
    app = createTestApp()
    createAdmin('bob', 'long-password-1', 'owner')
    let last: LightMyRequestResponse
    for (let i = 0; i < 12; i += 1) {
      last = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: 'bob', password: 'wrong-password' },
      })
    }
    expect(last!.statusCode).toBe(429)
  })
})

describe('backup name security', () => {
  it('refuses a traversal name on delete even with a valid session', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/admin/backups/../admin.db',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
  })

  it('refuses a traversal name on restore with a valid session', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/backups/%2e%2e%2fadmin.db/restore',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('backup and restore end-to-end', () => {
  it('creates, lists, restores, and preserves admin data across the restore', async () => {
    app = createTestApp()
    const cookie = await login(app)

    // Seed data that must survive the round trip.
    let res = await app.inject({
      method: 'POST',
      url: '/api/admin/spaces',
      headers: { cookie },
      payload: { name: 'prod' },
    })
    expect(res.statusCode).toBe(201)

    // Create the backup and confirm it is listed.
    res = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } })
    expect(res.statusCode).toBe(201)
    const name = res.json().data.name as string
    expect(name).toMatch(/^admin_backup_\d{4}-\d{2}-\d{2}T\d{4}_[0-9a-f]{4}\.db$/)

    res = await app.inject({ method: 'GET', url: '/api/admin/backups', headers: { cookie } })
    expect(res.json().data.map((b: { name: string }) => b.name)).toContain(name)

    // Mutate after the backup, then restore: the mutation must be reverted.
    res = await app.inject({
      method: 'POST',
      url: '/api/admin/spaces',
      headers: { cookie },
      payload: { name: 'temp' },
    })
    expect(res.statusCode).toBe(201)

    res = await app.inject({
      method: 'POST',
      url: `/api/admin/backups/${encodeURIComponent(name)}/restore`,
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)

    res = await app.inject({ method: 'GET', url: '/api/admin/spaces', headers: { cookie } })
    const spaces = res.json().data as { name: string }[]
    expect(spaces.map((s) => s.name)).toEqual(['prod'])
  })

  it('still accepts a fresh login after a restore reopens the DB', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const res = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: { cookie } })
    const name = res.json().data.name as string
    await app.inject({ method: 'POST', url: `/api/admin/backups/${encodeURIComponent(name)}/restore`, headers: { cookie } })

    // The restored DB must be a working, reopenable SQLite file.
    const login2 = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: 'bob', password: 'long-password-1' },
    })
    expect(login2.statusCode).toBe(200)
  })
})
