// Target discovery and the path-traversal guard.
//
// isSafeTargetName is the only thing standing between a URL segment and a
// filesystem join, so its rejection cases are tested explicitly.

import { describe, expect, it } from 'vitest'
import { isSafeTargetName, reportPath } from './reports.js'

describe('isSafeTargetName', () => {
  it('accepts ordinary target names', () => {
    for (const name of ['Test', 'usr', 'ABC', 'disk-1', 'node_2', 'v1.2.3']) {
      expect(isSafeTargetName(name)).toBe(true)
    }
  })

  it('rejects traversal and separators', () => {
    for (const name of [
      '..',
      '.',
      '../etc',
      '../../etc/passwd',
      'a/b',
      'a\\b',
      '/abs',
      './rel',
    ]) {
      expect(isSafeTargetName(name)).toBe(false)
    }
  })

  it('rejects names with characters that are not plain identifiers', () => {
    for (const name of ['', ' ', 'a b', 'a;b', 'a\0b', 'a$b', "a'b", 'a\nb', 'tôi']) {
      expect(isSafeTargetName(name)).toBe(false)
    }
  })
})

describe('reportPath', () => {
  it('joins the target directory and report file name', () => {
    expect(reportPath('/reports', 'Test')).toBe('/reports/Test/report.db')
  })
})
