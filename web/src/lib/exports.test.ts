import { describe, expect, it } from 'vitest'
import { exportQuery } from './exports.js'

describe('exportQuery', () => {
  it('forwards the kind and the active filter terms', () => {
    const qs = exportQuery('dirs', { query: 'var', ext: 'log', minSize: 100 })
    expect(qs).toContain('kind=dirs')
    expect(qs).toContain('query=var')
    expect(qs).toContain('ext=log')
    expect(qs).toContain('minSize=100')
  })

  it('never forwards cursors or page limits, which would truncate an export', () => {
    const qs = exportQuery('files', { query: 'var', dirCursor: 'abc', fileCursor: 'def', limit: 10 })
    expect(qs).not.toContain('dirCursor')
    expect(qs).not.toContain('fileCursor')
    expect(qs).not.toContain('limit')
  })
})
