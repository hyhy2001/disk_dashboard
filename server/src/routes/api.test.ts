import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { evictReport } from '../db/reports.js'
import { addDiskWithReport, cleanup, createTestApp, login, testDir } from './helpers.js'

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

  it('accepts a search without a query term', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const res = await app.inject({ method: 'GET', url: `/api/search/${slug}` })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.hits).toEqual([])
    expect(res.json().data.hasMore).toBe(false)
  })

  it('documents the report routes in the OpenAPI spec', async () => {
    app = createTestApp()
    const cookie = await login(app)
    const spec = (await app.inject({ method: 'GET', url: '/docs/json', headers: { cookie } })).json()
    const detail = spec.paths['/api/detail/{target}/{user}']
    expect(detail.get.parameters.some((p: any) => p.name === 'target' && p.in === 'path')).toBe(true)
    const search = spec.paths['/api/search/{target}']
    expect(search.get.parameters.some((p: any) => p.name === 'q' && p.in === 'query')).toBe(true)
    const ov = spec.paths['/api/overview/{target}'].get.responses['200'].content['application/json'].schema
    expect(ov.properties.data.properties.capacity).toBeTruthy()
  })
})

describe('viewer regroup', () => {
  it('produces exactly the totals the admin layer would, for the same groups', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const groups = [{ name: 'infra', users: ['root', 'syslog'] }]

    // The viewer's layer: definition travels with the request, nothing stored.
    const viewer = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups },
    })
    expect(viewer.statusCode).toBe(200)

    // The admin layer: same membership, persisted in admin.db.
    const cookie = await login(app)
    const diskId = (
      (await app.inject({ method: 'GET', url: '/api/admin/spaces', headers: { cookie } })).json().data as {
        disks: { id: number }[]
      }[]
    )[0]!.disks[0]!.id
    const team = await app.inject({
      method: 'POST',
      url: `/api/admin/disks/${diskId}/teams`,
      headers: { cookie },
      payload: { name: 'infra' },
    })
    await app.inject({
      method: 'PUT',
      url: `/api/admin/teams/${(team.json().data as { id: number }).id}`,
      headers: { cookie },
      payload: { users: ['root', 'syslog'] },
    })
    const official = await app.inject({ method: 'GET', url: `/api/overview/${slug}` })

    // Byte-identical: the two layers must never disagree about the same grouping.
    expect(viewer.json().data.teams).toEqual(official.json().data.teams)
    expect(viewer.json().data.users).toEqual(official.json().data.users)
    expect(viewer.json().data.otherUsers).toEqual(official.json().data.otherUsers)
  })

  it('ignores the admin layer rather than stacking on top of it', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const cookie = await login(app)
    const diskId = (
      (await app.inject({ method: 'GET', url: '/api/admin/spaces', headers: { cookie } })).json().data as {
        disks: { id: number }[]
      }[]
    )[0]!.disks[0]!.id
    const team = await app.inject({
      method: 'POST',
      url: `/api/admin/disks/${diskId}/teams`,
      headers: { cookie },
      payload: { name: 'official-only' },
    })
    await app.inject({
      method: 'PUT',
      url: `/api/admin/teams/${(team.json().data as { id: number }).id}`,
      headers: { cookie },
      payload: { users: ['root', 'alice', 'syslog'] },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups: [{ name: 'mine', users: ['alice'] }] },
    })
    const names = (res.json().data.teams as { name: string }[]).map((t) => t.name)
    expect(names).toEqual(['mine'])
    expect(names).not.toContain('official-only')
  })

  it('needs no session and writes nothing', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const before = (await app.inject({ method: 'GET', url: `/api/overview/${slug}` })).body

    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups: [{ name: 'temp', users: ['alice'] }] },
    })
    expect(res.statusCode).toBe(200)

    // The stored view is untouched — the viewer's grouping is not persisted.
    expect((await app.inject({ method: 'GET', url: `/api/overview/${slug}` })).body).toBe(before)
  })

  it('falls back to the untouched report when given no groups', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.teams).toBeDefined()
  })

  it('rejects an oversized membership list instead of building the map', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    // Each group is under the per-group cap; the total is what must be caught.
    const groups = Array.from({ length: 3 }, (_, i) => ({
      name: `g${i}`,
      users: Array.from({ length: 9000 }, (_, n) => `u${i}-${n}`),
    }))
    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups },
    })
    expect(res.statusCode).toBe(422)
  })

  it('rejects more groups than the schema allows', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()
    const groups = Array.from({ length: 201 }, (_, i) => ({ name: `g${i}`, users: [] }))
    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups },
    })
    expect(res.statusCode).toBe(400)
  })

  it('counts every member on a disk with more users than the render cap', async () => {
    app = createTestApp()
    const slug = await addDiskWithReport()

    // USER_LIMIT is 25 and the API only ever returns that many rows. Give the
    // group 40 members, each 1000 bytes, all ranked below the cap by size — a
    // client adding up the rows it received would report 25000 at most. Only a
    // server-side rollup over the full table can reach 40000.
    const reportPath = join(testDir(), 'vol1', 'report.db')
    const db = new Database(reportPath)
    const insert = db.prepare(
      'INSERT INTO detail_users (uid, username, team_id, total_files, total_dirs, total_size) VALUES (?, ?, NULL, 0, 0, ?)',
    )
    const members: string[] = []
    for (let i = 0; i < 40; i += 1) {
      const name = `bulk${i}`
      insert.run(5000 + i, name, 1000)
      members.push(name)
    }
    db.close()
    evictReport(reportPath, slug)

    const res = await app.inject({
      method: 'POST',
      url: `/api/overview/${slug}/regroup`,
      payload: { groups: [{ name: 'bulk', users: members }] },
    })
    expect(res.statusCode).toBe(200)
    const bulk = (res.json().data.teams as { name: string; used: number }[]).find((t) => t.name === 'bulk')
    expect(bulk?.used).toBe(40000)
    // The rendered list is still capped — only the rollup sees everyone.
    expect((res.json().data.users as unknown[]).length).toBeLessThanOrEqual(25)
  })

  it('refuses a traversal target name', async () => {
    app = createTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/overview/..%2Fadmin/regroup',
      payload: { groups: [] },
    })
    expect([400, 404]).toContain(res.statusCode)
  })
})
