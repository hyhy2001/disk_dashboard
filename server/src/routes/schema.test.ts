import { describe, expect, it } from 'vitest'
import { envelope, intQuery, stringParam } from './schema.js'

describe('schema helpers', () => {
  it('wraps a data schema in the {status, data} envelope', () => {
    const s = envelope({ type: 'array', items: { type: 'string' } })
    expect(s.properties.status).toEqual({ const: 'success' })
    expect(s.required).toContain('data')
  })

  it('builds a string path param', () => {
    expect(stringParam('target')).toEqual({ type: 'object', properties: { target: { type: 'string' } }, required: ['target'] })
  })

  it('accepts both integer and string for a numeric query', () => {
    expect(intQuery('limit', 'rows per page').anyOf).toHaveLength(2)
  })
})
