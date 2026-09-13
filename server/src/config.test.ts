import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

// loadConfig() reads process.env directly, so each case sets only the variable it
// cares about and the hook clears them again — a leaked var would make the next
// case assert against someone else's input.
const KEYS = ['DASHBOARD_API_RATE_LIMIT', 'DASHBOARD_PORT']

afterEach(() => {
  for (const key of KEYS) delete process.env[key]
})

describe('apiRateLimit', () => {
  it('falls back to 1800 when the variable is unset', () => {
    expect(loadConfig().apiRateLimit).toBe(1800)
  })

  it('accepts a positive cap', () => {
    process.env.DASHBOARD_API_RATE_LIMIT = '600'
    expect(loadConfig().apiRateLimit).toBe(600)
  })

  // The documented meaning of 0 is "no limiter": index.ts builds one only when
  // apiRateLimit > 0. It has to survive parsing, or that branch is unreachable
  // and the setting silently does nothing.
  it('treats 0 as disabled rather than falling back to the default', () => {
    process.env.DASHBOARD_API_RATE_LIMIT = '0'
    expect(loadConfig().apiRateLimit).toBe(0)
  })

  it('rejects a negative cap and garbage, keeping the default', () => {
    process.env.DASHBOARD_API_RATE_LIMIT = '-5'
    expect(loadConfig().apiRateLimit).toBe(1800)
    process.env.DASHBOARD_API_RATE_LIMIT = 'abc'
    expect(loadConfig().apiRateLimit).toBe(1800)
  })
})

describe('port', () => {
  it('falls back to the dev API port when the variable is unset', () => {
    expect(loadConfig().port).toBe(5310)
  })

  // 0 would mean "let the OS pick a port", which nginx cannot proxy to. Only the
  // rate limit has a meaningful zero; widening the shared parser must not leak
  // into here.
  it('still rejects 0, because an ephemeral port is never intended', () => {
    process.env.DASHBOARD_PORT = '0'
    expect(loadConfig().port).toBe(5310)
  })

  it('accepts a positive port', () => {
    process.env.DASHBOARD_PORT = '5311'
    expect(loadConfig().port).toBe(5311)
  })
})
