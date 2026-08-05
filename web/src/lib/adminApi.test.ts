import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAuthCache, fetchAccounts, fetchAuthStatus, onAuthInvalid } from './adminApi.js'

const LOGGED_IN = {
  status: 'ok',
  data: {
    loggedIn: true,
    user: { id: 1, username: 'admin', role: 'owner' },
    needsSetup: false,
    rateLimit: { captcha: false, attempts: 0 },
  },
}

const LOGGED_OUT = {
  status: 'ok',
  data: {
    loggedIn: false,
    user: null,
    needsSetup: false,
    rateLimit: { captcha: false, attempts: 0 },
  },
}

afterEach(() => {
  clearAuthCache()
  vi.restoreAllMocks()
})

describe('adminApi session expiry', () => {
  it('clears the auth cache and notifies listeners when a request returns 401', async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(LOGGED_IN), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'session expired' }), { status: 401 }),
        ),
      )

    const listener = vi.fn()
    const unsub = onAuthInvalid(listener)

    await fetchAuthStatus() // prime the cache as logged-in
    await expect(fetchAccounts()).rejects.toThrow('session expired')

    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('does not notify listeners for ordinary errors', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 })),
    )
    const listener = vi.fn()
    const unsub = onAuthInvalid(listener)

    await expect(fetchAccounts()).rejects.toThrow('forbidden')
    expect(listener).not.toHaveBeenCalled()
    unsub()
  })

  it('refetches auth status after the cache is cleared instead of serving stale state', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls += 1
      return Promise.resolve(
        new Response(JSON.stringify(calls === 1 ? LOGGED_IN : LOGGED_OUT), { status: 200 }),
      )
    })

    expect((await fetchAuthStatus()).loggedIn).toBe(true)
    expect(calls).toBe(1)

    // The 5s cache would normally serve this; a clear forces a fresh read.
    await fetchAuthStatus()
    expect(calls).toBe(1)

    clearAuthCache()
    expect((await fetchAuthStatus()).loggedIn).toBe(false)
    expect(calls).toBe(2)
  })
})
