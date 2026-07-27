// Export jobs: wire an API list to the CSV writer and report progress.
//
// Kept out of the components because an export outlives the view that started it —
// a viewer can switch tabs mid-download — and because both tabs export the same way
// and should not each own a copy of the toast choreography.

import { exportCsv, fileStamp, safeName, type Row } from './csv.js'
import { fetchPermissions, fetchUserDetail, type DetailQuery, type PermQuery } from './api.js'
import { closeProgress, failure, info, startProgress, success, updateProgress } from './toast.js'
import { formatCount } from './format.js'

/** Rows per fetched page during an export. Larger than the UI page: no one reads these. */
const EXPORT_PAGE = 5000

/**
 * Cap on exported rows.
 *
 * A user with 20M files would otherwise produce a multi-GB CSV and a download that
 * never ends. The cap is high enough that no realistic analysis hits it, and the
 * toast says when it was applied so a truncated file is never mistaken for a
 * complete one.
 */
const MAX_ROWS = 2_000_000

function reportOutcome(
  label: string,
  result: Awaited<ReturnType<typeof exportCsv>>,
  capped: boolean,
): void {
  if (result.kind === 'cancelled') {
    info('Export cancelled', 'The save dialog was closed.')
    return
  }

  const detail = `${formatCount(result.rows)} rows → ${result.filename}`
  if (capped) {
    // A cap is not a failure, but it changes what the file means.
    success(`${label} exported (truncated)`, `${detail}. Stopped at the ${formatCount(MAX_ROWS)} row limit.`)
  } else {
    success(`${label} exported`, detail)
  }
}

/** Export one user's directory or file list, honouring the active filters. */
export async function exportUserList(
  target: string,
  user: string,
  kind: 'dirs' | 'files',
  filter: DetailQuery,
): Promise<void> {
  const label = kind === 'dirs' ? 'Directories' : 'Files'
  const toastId = startProgress(`Exporting ${label.toLowerCase()}`, `${user} on ${target}`)
  let rows = 0

  try {
    const result = await exportCsv({
      filename: `${kind}_${safeName(user)}_${fileStamp()}`,
      headers: kind === 'dirs' ? ['Path', 'Bytes', 'Files'] : ['Path', 'Bytes', 'Extension'],
      maxRows: MAX_ROWS,
      onProgress: (n) => {
        rows = n
        // No total is known up front — counting first would double the work — so
        // the bar is driven against the cap and the label carries the real number.
        updateProgress(toastId, Math.min(1, n / MAX_ROWS), `${formatCount(n)} rows`)
      },
      fetchPage: async (cursor) => {
        const page = await fetchUserDetail(target, user, {
          ...filter,
          limit: EXPORT_PAGE,
          // Only advance the list being exported; the other one is fetched at its
          // first page and ignored.
          ...(kind === 'dirs'
            ? cursor !== undefined
              ? { dirCursor: cursor }
              : {}
            : cursor !== undefined
              ? { fileCursor: cursor }
              : {}),
        })

        if (kind === 'dirs') {
          return {
            rows: page.dirs.rows.map((d): Row => [d.path, d.used, d.files]),
            nextCursor: page.dirs.nextCursor,
          }
        }
        return {
          rows: page.files.rows.map((f): Row => [f.path, f.size, f.ext]),
          nextCursor: page.files.nextCursor,
        }
      },
    })

    reportOutcome(label, result, rows >= MAX_ROWS)
  } catch (err) {
    failure('Export failed', err instanceof Error ? err.message : String(err))
  } finally {
    closeProgress(toastId)
  }
}

/**
 * Export permission issues.
 *
 * This list is offset-paginated server-side, so the cursor here is just the next
 * offset encoded as a string — the CSV writer does not care what a cursor means.
 */
export async function exportPermissions(
  target: string,
  filter: PermQuery,
  scope: 'filtered' | 'all',
): Promise<void> {
  const label = scope === 'all' ? 'All permission issues' : 'Filtered permission issues'
  const toastId = startProgress('Exporting permission issues', target)
  let rows = 0

  // "All" means every row in the report, so the filter is dropped rather than
  // partially applied — a half-filtered export would be indistinguishable from a
  // full one once saved.
  const effective: PermQuery = scope === 'all' ? {} : filter

  try {
    const result = await exportCsv({
      filename: `permissions_${safeName(target)}_${fileStamp()}`,
      headers: ['User', 'Path', 'Type', 'Error'],
      maxRows: MAX_ROWS,
      onProgress: (n) => {
        rows = n
        updateProgress(toastId, Math.min(1, n / MAX_ROWS), `${formatCount(n)} rows`)
      },
      fetchPage: async (cursor) => {
        const offset = cursor === undefined ? 0 : Number(cursor)
        const page = await fetchPermissions(target, {
          ...effective,
          offset,
          limit: 1000,
        })
        return {
          rows: page.rows.map((r): Row => [r.user, r.path, r.itemType, r.error]),
          nextCursor: page.hasMore ? String(offset + page.rows.length) : null,
        }
      },
    })

    reportOutcome(label, result, rows >= MAX_ROWS)
  } catch (err) {
    failure('Export failed', err instanceof Error ? err.message : String(err))
  } finally {
    closeProgress(toastId)
  }
}
