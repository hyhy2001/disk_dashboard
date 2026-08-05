import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { addDiskWithReport, cleanup, createTestApp, login } from './helpers.js'

let app: FastifyInstance

afterEach(async () => {
  await app?.close()
  cleanup()
})

describe('report API', () => {
  it('serves health without touching the admin DB', async () => {
    app = createTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('success')
  })

  it('returns 404 for a bogus API path', async () => {
    app = createTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
  })

  it('lists users for a configured disk', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const res = await app.inject({ method: 'GET', url: `/api/users/${slug}` })
    expect(res.statusCode).toBe(200)
    const { data } = res.json()
    // fixture: var/home owners + root's files
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty('name')
    expect(data[0]).toHaveProperty('used')
  })

  it('404s a disk slug with no report', async () => {
    app = createTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/users/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })

  it('clamps a treemap child offset instead of trusting it', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const res = await app.inject({
      method: 'GET',
      url: `/api/treemap/${slug}?childAfterSize=1&childAfterName=x&childSkippedSize=999999`,
    })
    // The cursor names a child that does not exist, which must not error.
    expect(res.statusCode).toBe(200)
  })

  it('rejects a malformed treemap cursor size', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const res = await app.inject({ method: 'GET', url: `/api/treemap/${slug}?childAfterSize=abc` })
    expect(res.statusCode).toBe(400)
  })

  it('documents the report routes in the OpenAPI spec', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const spec = (await app.inject({ method: 'GET', url: '/docs/json', headers: { cookie } })).json()
    const detail = spec.paths['/api/detail/{target}/{user}']
    expect(detail.get.parameters.some((p: any) => p.name === 'target' && p.in === 'path')).toBe(true)
    const search = spec.paths['/api/search/{target}']
    expect(search.get.parameters.some((p: any) => p.name === 'q' && p.in === 'query')).toBe(true)
  })
})
