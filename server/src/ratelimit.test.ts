import { afterEach, describe, expect, it, vi } from 'vitest'
import { RateLimiter } from './ratelimit.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('RateLimiter', () => {
  it('allows requests up to the cap within a window', () => {
    const rl = new RateLimiter(60_000, 3)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('a')).toBe(false)
  })

  it('treats different keys independently', () => {
    const rl = new RateLimiter(60_000, 2)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('b')).toBe(true)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('a')).toBe(false)
    expect(rl.allow('b')).toBe(true)
  })

  it('resets after the window elapses', () => {
    vi.useFakeTimers()
    const rl = new RateLimiter(60_000, 1)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('a')).toBe(false)
    vi.advanceTimersByTime(61_000)
    expect(rl.allow('a')).toBe(true)
  })
})
