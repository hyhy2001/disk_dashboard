import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { createAdmin } from '../db/admin.js'
import { cleanup, createTestApp } from './helpers.js'

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
  cleanup()
})

/** Seed an owner and log in, returning the session cookie. */
async function login(app: FastifyInstance, password = 'long-password-1'): Promise<string> {
  createAdmin('bob', password, 'owner')
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    payload: { username: 'bob', password },
  })
  expect(res.statusCode).toBe(200)
  const setCookie = res.headers['set-cookie'] as unknown as string | string[] | undefined
  const raw = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []
  const cookie = raw.find((c) => c.startsWith('du_sess='))
  if (!cookie) throw new Error('no session cookie set')
  return cookie.split(';')[0]!
}

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
