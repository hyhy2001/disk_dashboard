// CSV formatting and paging.
//
// Two things matter here and neither is obvious: paths contain characters that
// break naive CSV, and a leading `=` in a filename is a spreadsheet formula. Both
// are real inputs — duscan reports whatever is on the filesystem.

import { describe, expect, it, vi } from 'vitest'
import { csvCell, csvLine, exportCsv, fileStamp, safeName, type Row } from './csv.js'

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('/var/log')).toBe('/var/log')
    expect(csvCell(1234)).toBe('1234')
  })

  it('quotes a value containing a comma', () => {
    expect(csvCell('/home/a,b')).toBe('"/home/a,b"')
  })

  it('doubles an embedded quote', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('quotes a value containing a newline', () => {
    // Filenames really can contain newlines on Linux.
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  it('neutralises a formula-leading value', () => {
    // Opened in Excel, an unescaped =cmd cell is executable.
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-2')).toBe("'-2")
    expect(csvCell('@ref')).toBe("'@ref")
  })

  it('does not mistake a negative number cell for a formula risk it cannot quote', () => {
    // Still prefixed, but the result must remain a single valid CSV field.
    expect(csvCell(-5)).toBe("'-5")
  })
})

describe('csvLine', () => {
  it('joins cells with commas and a CRLF', () => {
    expect(csvLine(['a', 'b', 1])).toBe('a,b,1\r\n')
  })
})

describe('fileStamp', () => {
  it('formats as YYYYMMDD_HHMMSS with padding', () => {
    expect(fileStamp(new Date(2026, 6, 27, 9, 5, 3))).toBe('20260727_090503')
  })
})

describe('safeName', () => {
  it('replaces awkward characters', () => {
    expect(safeName('a b/c')).toBe('a_b_c')
  })

  it('falls back rather than returning an empty name', () => {
    expect(safeName('///')).toBe('_')
    expect(safeName('')).toBe('export')
  })
})

/** Build a fetcher that serves `pages` in order. */
function pager(pages: Row[][]): (cursor: string | undefined) => Promise<{
  rows: Row[]
  nextCursor: string | null
}> {
  return async (cursor) => {
    const index = cursor === undefined ? 0 : Number(cursor)
    return {
      rows: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    }
  }
}

describe('exportCsv (blob fallback)', () => {
  it('walks every page and reports the row count', async () => {
    const clicked = vi.fn()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clicked)

    const result = await exportCsv({
      filename: 'perms_Test',
      headers: ['User', 'Path'],
      fetchPage: pager([
        [['root', '/proc/1/fd']],
        [['alice', '/home/alice/.ssh']],
      ]),
    })

    expect(result).toEqual({ kind: 'downloaded', rows: 2, filename: 'perms_Test.csv' })
    expect(clicked).toHaveBeenCalledOnce()
    expect(created).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('reports progress as pages land', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const seen: number[] = []
    await exportCsv({
      filename: 'x',
      headers: ['a'],
      fetchPage: pager([[['1'], ['2']], [['3']]]),
      onProgress: (n) => seen.push(n),
    })

    expect(seen).toEqual([2, 3])
    vi.restoreAllMocks()
  })

  it('stops at maxRows instead of draining every page', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const result = await exportCsv({
      filename: 'x',
      headers: ['a'],
      fetchPage: pager([[['1'], ['2']], [['3']], [['4']]]),
      maxRows: 2,
    })

    expect(result).toMatchObject({ rows: 2 })
    vi.restoreAllMocks()
  })

  it('handles an empty result without failing', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const result = await exportCsv({ filename: 'x', headers: ['a'], fetchPage: pager([[]]) })
    expect(result).toMatchObject({ rows: 0 })
    vi.restoreAllMocks()
  })
})
