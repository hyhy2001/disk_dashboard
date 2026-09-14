import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

// loadConfig() reads process.env directly, so each case sets only the variable it
// cares about and the hook clears them again — a leaked var would make the next
// case assert against someone else's input.
const KEYS = ['DASHBOARD_API_RATE_LIMIT', 'DASHBOARD_PORT', 'DASHBOARD_TRUST_PROXY']

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

// fastify 5.12.1 dropped the numeric form of `trustProxy` (GHSA-3m5p-2c4r-xxw2):
// a bare hop count cannot verify the immediate peer, so a direct client could
// spoof X-Forwarded-For by supplying enough hops. loadConfig() must not hand a
// number to fastify any more, and must not quietly reinterpret one either.
describe('trustProxy', () => {
  it('is off unless the variable says otherwise', () => {
    expect(loadConfig().trustProxy).toBe(false)
    process.env.DASHBOARD_TRUST_PROXY = ''
    expect(loadConfig().trustProxy).toBe(false)
    process.env.DASHBOARD_TRUST_PROXY = 'false'
    expect(loadConfig().trustProxy).toBe(false)
  })

  // 0 has always been a way of writing "off"; it is not a hop count.
  it('still reads 0 as off', () => {
    process.env.DASHBOARD_TRUST_PROXY = '0'
    expect(loadConfig().trustProxy).toBe(false)
  })

  it('accepts true in any case', () => {
    process.env.DASHBOARD_TRUST_PROXY = 'true'
    expect(loadConfig().trustProxy).toBe(true)
    process.env.DASHBOARD_TRUST_PROXY = 'TRUE'
    expect(loadConfig().trustProxy).toBe(true)
  })

  // The replacement for hop counts is naming the proxies that may be believed.
  // The string goes to fastify verbatim, which splits it on commas and compiles
  // each token with @fastify/proxy-addr — re-validating it here would be a second,
  // weaker copy of that parser.
  it('passes a trusted-address list through untouched', () => {
    process.env.DASHBOARD_TRUST_PROXY = '127.0.0.1'
    expect(loadConfig().trustProxy).toBe('127.0.0.1')
    process.env.DASHBOARD_TRUST_PROXY = '10.0.0.0/8,127.0.0.1'
    expect(loadConfig().trustProxy).toBe('10.0.0.0/8,127.0.0.1')
    process.env.DASHBOARD_TRUST_PROXY = 'loopback'
    expect(loadConfig().trustProxy).toBe('loopback')
  })

  // Passing '2' straight through would compile fine and then trust nothing, so
  // an operator upgrading from a hop count would silently lose their proxy IP:
  // every client behind nginx would collapse onto one address and share a single
  // login rate-limit bucket. Refusing to start says what to do instead.
  it('rejects a hop count instead of silently failing closed', () => {
    process.env.DASHBOARD_TRUST_PROXY = '2'
    expect(() => loadConfig()).toThrow(/hop count/i)
    process.env.DASHBOARD_TRUST_PROXY = '1'
    expect(() => loadConfig()).toThrow(/hop count/i)
  })
})
