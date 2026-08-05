import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearApiCache, fetchSearch } from './api.js'

function okResponse(): Response {
  return new Response(JSON.stringify({ status: 'ok', data: { hits: [], hasMore: false } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  clearApiCache()
  vi.restoreAllMocks()
})

describe('fetchSearch', () => {
  it('shares one in-flight request for identical queries', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse()))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const [a, b] = await Promise.all([fetchSearch('t', 'foo'), fetchSearch('t', 'foo')])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('fetches separately for different queries', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(okResponse()))
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await Promise.all([fetchSearch('t', 'foo'), fetchSearch('t', 'bar')])

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not remember a failed request as in-flight', async () => {
    let calls = 0
    const fetchMock = vi.fn(async () => {
      calls += 1
      return new Response(JSON.stringify({ status: 'error', message: 'boom' }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(fetchSearch('t', 'foo')).rejects.toThrow('boom')
    await expect(fetchSearch('t', 'foo')).rejects.toThrow('boom')

    expect(calls).toBe(2)
  })
})
