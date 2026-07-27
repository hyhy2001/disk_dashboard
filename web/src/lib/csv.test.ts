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

/**
 * Neutralise the download side effects and return the click spy.
 *
 * jsdom has no download machinery, and a real object URL would leak between cases.
 */
function stubDownload(): ReturnType<typeof vi.fn> {
  const clicked = vi.fn()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clicked)
  return clicked
}

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
    const clicked = stubDownload()
    const created = vi.mocked(URL.createObjectURL)

    const result = await exportCsv({
      filename: 'perms_Test',
      headers: ['User', 'Path'],
      fetchPage: pager([
        [['root', '/proc/1/fd']],
        [['alice', '/home/alice/.ssh']],
      ]),
    })

    expect(result).toEqual({
      kind: 'downloaded',
      rows: 2,
      filename: 'perms_Test.csv',
      files: 1,
      truncated: false,
    })
    expect(clicked).toHaveBeenCalledOnce()
    expect(created).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('reports progress as pages land', async () => {
    stubDownload()

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

  it('exports every page when no cap is set', async () => {
    stubDownload()

    // The default must be "export everything": a silently short file looks
    // complete, which is worse than a slow export.
    const result = await exportCsv({
      filename: 'x',
      headers: ['a'],
      fetchPage: pager([[['1'], ['2']], [['3']], [['4']]]),
    })

    expect(result).toMatchObject({ rows: 4, truncated: false })
    vi.restoreAllMocks()
  })

  it('stops at maxRows and says so when one is set', async () => {
    stubDownload()

    const result = await exportCsv({
      filename: 'x',
      headers: ['a'],
      fetchPage: pager([[['1'], ['2']], [['3']], [['4']]]),
      maxRows: 2,
    })

    expect(result).toMatchObject({ rows: 2, truncated: true })
    vi.restoreAllMocks()
  })

  it('handles an empty result without failing', async () => {
    stubDownload()

    const result = await exportCsv({ filename: 'x', headers: ['a'], fetchPage: pager([[]]) })
    expect(result).toMatchObject({ rows: 0, files: 1 })
    vi.restoreAllMocks()
  })
})

describe('exportCsv splitting', () => {
  it('keeps one file when the row count fits a chunk', async () => {
    const clicked = stubDownload()

    const result = await exportCsv({
      filename: 'files_root',
      headers: ['Path'],
      chunkRows: 10,
      fetchPage: pager([[['a'], ['b']]]),
    })

    expect(result).toMatchObject({ files: 1, filename: 'files_root.csv' })
    expect(clicked).toHaveBeenCalledOnce()
    vi.restoreAllMocks()
  })

  it('splits into parts past the chunk size', async () => {
    const clicked = stubDownload()

    // Excel stops at 1,048,576 rows, so a bigger CSV loses its tail on open.
    // Legacy split at 500,000; the mechanism is what matters here, not the number.
    const result = await exportCsv({
      filename: 'files_root',
      headers: ['Path'],
      chunkRows: 2,
      fetchPage: pager([[['a'], ['b'], ['c']], [['d'], ['e']]]),
    })

    expect(result).toMatchObject({ kind: 'downloaded', rows: 5, files: 3 })
    expect(clicked).toHaveBeenCalledTimes(3)
    vi.restoreAllMocks()
  })

  it('repeats the header in every part and puts each row in exactly one', async () => {
    // Intercept at the Blob constructor: jsdom's Blob has no text(), so the parts
    // are inspected through what they were built from.
    const texts: string[] = []
    const RealBlob = globalThis.Blob
    vi.stubGlobal(
      'Blob',
      class extends RealBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts)
          texts.push(parts.map(String).join(''))
        }
      },
    )
    stubDownload()

    await exportCsv({
      filename: 'x',
      headers: ['Path'],
      chunkRows: 2,
      // Distinctive values: single letters would collide with the header text.
      fetchPage: pager([[['/one'], ['/two'], ['/three'], ['/four']]]),
    })

    expect(texts).toHaveLength(2)
    // A part without its own header row is not a usable CSV on its own.
    for (const t of texts) expect(t).toContain('Path')
    expect(texts[0]).toContain('/one')
    expect(texts[0]).toContain('/two')
    expect(texts[1]).toContain('/three')
    expect(texts[1]).toContain('/four')
    // No row may be duplicated across parts.
    expect(texts[1]).not.toContain('/one')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
})
