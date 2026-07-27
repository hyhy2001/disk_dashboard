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
   * Stop after this many rows. A guard against an export that would never end;
   * the caller decides what "too big" means.
   */
  maxRows?: number
}

export type ExportResult =
  | { kind: 'streamed'; rows: number; filename: string }
  | { kind: 'downloaded'; rows: number; filename: string }
  | { kind: 'cancelled' }

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
    return { kind: 'streamed', rows, filename: name }
  } catch (err) {
    // Abort so the partial file is not left looking complete.
    await writer.abort().catch(() => undefined)
    throw err
  }
}

/** Accumulate everything, then hand the browser a Blob to download. */
async function blobExport(opts: ExportOptions): Promise<ExportResult> {
  const parts: string[] = [csvLine(opts.headers)]
  let rows = 0
  let cursor: string | undefined

  for (;;) {
    const page = await opts.fetchPage(cursor)
    for (const row of page.rows) {
      parts.push(csvLine(row))
      rows += 1
      if (opts.maxRows !== undefined && rows >= opts.maxRows) break
    }
    opts.onProgress?.(rows)

    if (page.nextCursor === null) break
    if (opts.maxRows !== undefined && rows >= opts.maxRows) break
    cursor = page.nextCursor
  }

  // A BOM so Excel opens UTF-8 paths correctly instead of mangling non-ASCII.
  const blob = new Blob(['﻿', ...parts], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const name = `${opts.filename}.csv`

  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoking immediately can cancel the download in some browsers; one tick is
  // enough for the click to have been processed.
  setTimeout(() => URL.revokeObjectURL(url), 0)

  return { kind: 'downloaded', rows, filename: name }
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
