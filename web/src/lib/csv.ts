// CSV export, streamed where the browser allows it.
//
// Exports here can be large — a user with 500k files produces tens of megabytes of
// CSV — so buffering the whole thing in a string before download would spike
// memory and risk a tab crash. Two strategies, picked by capability:
//
//   1. File System Access API + CompressionStream: rows are fetched page by page,
//      encoded, gzipped and written straight to the file the user chose. Peak
//      memory is one page.
//   2. Blob fallback: everything is accumulated, then downloaded uncompressed.
//      Only Chromium ships (1) today, so this is what Firefox and Safari get.
//
// Both paths pull pages through the same callback, so the caller writes its query
// once and does not care which strategy ran.

/** Rows must be renderable as an array of cell values. */
export type Row = (string | number)[]

/**
 * Fetch one page of rows.
 *
 * `cursor` is whatever the previous call returned; undefined asks for the first
 * page. Returning a null cursor ends the export.
 */
export type PageFetcher = (
  cursor: string | undefined,
) => Promise<{ rows: Row[]; nextCursor: string | null }>

export interface ExportOptions {
  /** File name without an extension; the strategy appends .csv or .csv.gz. */
  filename: string
  headers: string[]
  fetchPage: PageFetcher
  /** Called with the running row count so the caller can drive a progress toast. */
  onProgress?: (rows: number) => void
  /**
   * Rows per output file on the fallback path.
   *
   * Spreadsheets stop at 1,048,576 rows, so a bigger export has to be split or it
   * silently loses the tail when opened. Legacy split at 500,000 and so do we. The
   * streaming path does not need this: a .csv.gz is not opened in Excel directly.
   */
  chunkRows?: number

  /**
   * Absolute ceiling, as a runaway guard only.
   *
   * Left undefined by default: truncating an export is worse than a slow one,
   * because a short file looks complete. Set it only where an unbounded walk would
   * genuinely never end.
   */
  maxRows?: number
}

export type ExportResult =
  | { kind: 'streamed'; rows: number; filename: string; truncated: boolean }
  /** `files` is >1 when the row count forced a split. */
  | { kind: 'downloaded'; rows: number; filename: string; files: number; truncated: boolean }
  | { kind: 'cancelled' }

/** Legacy's split point, and the reason for it: Excel's row ceiling. */
export const DEFAULT_CHUNK_ROWS = 500_000

/**
 * Quote a CSV cell.
 *
 * Paths are the main payload and they legitimately contain commas, quotes and
 * newlines, so quoting is not optional. A leading `=`, `+`, `-` or `@` is prefixed
 * with a quote-escape too: spreadsheets treat those as formulas, which turns a
 * filename like `=cmd|...` into code execution on open.
 */
export function csvCell(value: string | number): string {
  const s = String(value)
  const risky = /^[=+\-@\t\r]/.test(s)
  const body = risky ? `'${s}` : s
  if (/[",\n\r]/.test(body)) return `"${body.replace(/"/g, '""')}"`
  return body
}

export function csvLine(row: Row): string {
  return `${row.map(csvCell).join(',')}\r\n`
}

/** Whether the streaming path is available. */
export function canStream(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showSaveFilePicker' in window &&
    typeof globalThis.CompressionStream === 'function'
  )
}

/** Minimal shape of the File System Access API bits used here. */
interface SaveFilePickerOptions {
  suggestedName?: string
  types?: { description: string; accept: Record<string, string[]> }[]
}
interface FileSystemWritableStream {
  getWriter(): WritableStreamDefaultWriter<Uint8Array>
}
type SavePicker = (opts: SaveFilePickerOptions) => Promise<{
  createWritable(): Promise<FileSystemWritableStream>
}>

/**
 * Stream to a gzipped file the user picks.
 *
 * The next page is requested *while* the current one is being compressed, so the
 * network wait and the CPU work overlap. On a slow link that roughly halves the
 * wall time versus fetch-then-compress in lockstep.
 */
async function streamExport(opts: ExportOptions): Promise<ExportResult> {
  const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker
  const name = `${opts.filename}.csv.gz`

  let handle: Awaited<ReturnType<SavePicker>>
  try {
    handle = await picker({
      suggestedName: name,
      types: [{ description: 'Gzipped CSV', accept: { 'application/gzip': ['.gz'] } }],
    })
  } catch {
    // The only expected rejection is the user closing the dialog.
    return { kind: 'cancelled' }
  }

  const gzip = new CompressionStream('gzip')
  const writable = await handle.createWritable()
  // Pipe the compressor's output into the file while we feed its input below.
  const piped = gzip.readable.pipeTo(writable as unknown as WritableStream<Uint8Array>)

  const encoder = new TextEncoder()
  const writer = gzip.writable.getWriter()
  let rows = 0

  try {
    await writer.write(encoder.encode(csvLine(opts.headers)))

    type PageResult = { rows: Row[]; nextCursor: string | null }
    let cursor: string | undefined
    // Annotated explicitly: the loop assigns to `pending` from a value derived
    // from awaiting `pending`, which inference reads as circular.
    let pending: Promise<PageResult> | null = opts.fetchPage(undefined)

    while (pending) {
      const page: PageResult = await pending
      cursor = page.nextCursor ?? undefined

      // Kick off the next fetch before compressing this page.
      const more: boolean =
        page.nextCursor !== null && (opts.maxRows === undefined || rows < opts.maxRows)
      pending = more ? opts.fetchPage(cursor) : null

      let chunk = ''
      for (const row of page.rows) {
        chunk += csvLine(row)
        rows += 1
        if (opts.maxRows !== undefined && rows >= opts.maxRows) break
      }
      if (chunk) await writer.write(encoder.encode(chunk))
      opts.onProgress?.(rows)

      if (opts.maxRows !== undefined && rows >= opts.maxRows) break
    }

    await writer.close()
    await piped
    return {
      kind: 'streamed',
      rows,
      filename: name,
      truncated: opts.maxRows !== undefined && rows >= opts.maxRows,
    }
  } catch (err) {
    // Abort so the partial file is not left looking complete.
    await writer.abort().catch(() => undefined)
    throw err
  }
}

/** Trigger a browser download for one Blob. */
function download(name: string, body: string[]): void {
  // A BOM so Excel opens UTF-8 paths correctly instead of mangling non-ASCII.
  const blob = new Blob(['﻿', ...body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoking immediately can cancel the download in some browsers; one tick is
  // enough for the click to have been processed.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Accumulate rows and hand the browser one or more Blobs.
 *
 * Used where CompressionStream and the save picker are unavailable — Firefox and
 * Safari today. Two consequences follow from having to buffer:
 *
 *   - Output is split every `chunkRows` rows into `_part1.csv`, `_part2.csv`, …
 *     Legacy did the same, because a single CSV past Excel's 1,048,576-row limit
 *     silently loses its tail when opened.
 *   - Each part is released as soon as it is written, so peak memory is one part
 *     rather than the whole export.
 *
 * Legacy zipped the parts with JSZip. Emitting them as separate downloads avoids a
 * dependency for a fallback path; the tradeoff is several save prompts instead of
 * one archive.
 */
async function blobExport(opts: ExportOptions): Promise<ExportResult> {
  const chunkRows = opts.chunkRows ?? DEFAULT_CHUNK_ROWS
  const header = csvLine(opts.headers)

  let body: string[] = [header]
  let rowsInPart = 0
  let rows = 0
  let part = 0
  let cursor: string | undefined
  const pending: { name: string; body: string[] }[] = []

  /** Close the current part, holding it until we know whether it is the only one. */
  const flush = (): void => {
    if (rowsInPart === 0) return
    part += 1
    pending.push({ name: `part${part}`, body })
    body = [header]
    rowsInPart = 0
  }

  outer: for (;;) {
    const page = await opts.fetchPage(cursor)

    for (const row of page.rows) {
      body.push(csvLine(row))
      rows += 1
      rowsInPart += 1
      if (rowsInPart >= chunkRows) flush()
      if (opts.maxRows !== undefined && rows >= opts.maxRows) {
        opts.onProgress?.(rows)
        break outer
      }
    }
    opts.onProgress?.(rows)

    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  flush()

  // Name only once the count is known: a lone file should not be called _part1.
  if (pending.length === 0) {
    download(`${opts.filename}.csv`, [header])
    return { kind: 'downloaded', rows: 0, filename: `${opts.filename}.csv`, files: 1, truncated: false }
  }

  const single = pending.length === 1
  for (const p of pending) {
    download(single ? `${opts.filename}.csv` : `${opts.filename}_${p.name}.csv`, p.body)
  }

  return {
    kind: 'downloaded',
    rows,
    filename: single ? `${opts.filename}.csv` : `${opts.filename}_part1..${pending.length}.csv`,
    files: pending.length,
    truncated: opts.maxRows !== undefined && rows >= opts.maxRows,
  }
}

/** Export rows as CSV, streaming when the browser supports it. */
export function exportCsv(opts: ExportOptions): Promise<ExportResult> {
  return canStream() ? streamExport(opts) : blobExport(opts)
}

/** A timestamp suffix for export filenames: 20260727_143022. */
export function fileStamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  )
}

/** Strip characters that are awkward in a filename. */
export function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 64) || 'export'
}
