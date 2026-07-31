// Export jobs: wire an API list to the CSV writer and report progress.
//
// Kept out of the components because an export outlives the view that started it —
// a viewer can switch tabs mid-download — and because both tabs export the same way
// and should not each own a copy of the toast choreography.

import { exportCsv, fileStamp, safeName, type Row } from './csv.js'
import { fetchPermissions, fetchUserDetail, type DetailQuery, type PermQuery } from './api.js'
import { closeProgress, failure, info, startProgress, success, updateProgress } from './toast.js'
import { formatCount } from './format.js'

/**
 * Rows per fetched page during an export, per list. Legacy's values.
 *
 * Far larger than the UI page because nobody reads these rows — the only thing that
 * matters is total wall time, and per-request overhead dominates at small sizes.
 * Measured on a 1.5M-file report: 500 file rows cost 23ms, 50,000 cost 322ms. So a
 * user's 1.4M files take 29 requests at ~322ms rather than 2,900 at ~23ms.
 *
 * Files get the bigger page because there are always more of them than directories.
 */
const EXPORT_PAGE = { dirs: 20_000, files: 50_000 } as const

/** Permission issues are a smaller list and the endpoint caps at 5000. */
const PERM_EXPORT_PAGE = 5000

function reportOutcome(label: string, result: Awaited<ReturnType<typeof exportCsv>>): void {
  if (result.kind === 'cancelled') {
    info('Export cancelled', 'The save dialog was closed.')
    return
  }

  // A split is worth saying out loud: the viewer is about to get several files and
  // needs to know none of them is the whole thing.
  const files = result.kind === 'downloaded' && result.files > 1 ? ` in ${result.files} parts` : ''
  success(`${label} exported`, `${formatCount(result.rows)} rows → ${result.filename}${files}`)
}

/**
 * Export one user's directory or file list, honouring the active filters.
 *
 * `expectedRows` is the user's unfiltered count from the picker. It drives the
 * progress bar, which is the only way to show real progress: counting the filtered
 * rows first would mean walking the whole range twice. With a filter active the
 * estimate runs high, so the bar is a floor on progress rather than an exact
 * fraction — the row count beside it is always the truth.
 */
export async function exportUserList(
  target: string,
  user: string,
  kind: 'dirs' | 'files',
  filter: DetailQuery,
  expectedRows?: number,
): Promise<void> {
  const label = kind === 'dirs' ? 'Directories' : 'Files'
  const toastId = startProgress(`Exporting ${label.toLowerCase()}`, `${user} on ${target}`)
  const total = expectedRows && expectedRows > 0 ? expectedRows : 0

  try {
    const result = await exportCsv({
      filename: `${kind}_${safeName(user)}_${fileStamp()}`,
      headers: kind === 'dirs' ? ['Path', 'Bytes', 'Files'] : ['Path', 'Bytes', 'Extension'],
      onProgress: (n) => {
        updateProgress(
          toastId,
          total > 0 ? Math.min(1, n / total) : 0,
          total > 0 ? `${formatCount(n)} / ${formatCount(total)} rows` : `${formatCount(n)} rows`,
        )
      },
      fetchPage: async (cursor) => {
        const page = await fetchUserDetail(target, user, {
          ...filter,
          limit: EXPORT_PAGE[kind],
          // Only advance the list being exported; the other one comes back at its
          // first page and is ignored.
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

    reportOutcome(label, result)
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
export async function exportPermissions(target: string, filter: PermQuery, scope: 'filtered' | 'all'): Promise<void> {
  const label = scope === 'all' ? 'All permission issues' : 'Filtered permission issues'
  const toastId = startProgress('Exporting permission issues', target)

  // "All" means every row in the report, so the filter is dropped rather than
  // partially applied — a half-filtered export would be indistinguishable from a
  // full one once saved.
  const effective: PermQuery = scope === 'all' ? {} : filter

  // This endpoint returns the filtered total with every page, so the first page
  // gives an exact denominator for the bar.
  let total = 0

  try {
    const result = await exportCsv({
      filename: `permissions_${safeName(target)}_${fileStamp()}`,
      headers: ['User', 'Path', 'Type', 'Error'],
      onProgress: (n) => {
        updateProgress(
          toastId,
          total > 0 ? Math.min(1, n / total) : 0,
          total > 0 ? `${formatCount(n)} / ${formatCount(total)} rows` : `${formatCount(n)} rows`,
        )
      },
      fetchPage: async (cursor) => {
        const offset = cursor === undefined ? 0 : Number(cursor)
        const page = await fetchPermissions(target, {
          ...effective,
          offset,
          limit: PERM_EXPORT_PAGE,
        })
        total = page.total
        return {
          rows: page.rows.map((r): Row => [r.user, r.path, r.itemType, r.error]),
          nextCursor: page.hasMore ? String(offset + page.rows.length) : null,
        }
      },
    })

    reportOutcome(label, result)
  } catch (err) {
    failure('Export failed', err instanceof Error ? err.message : String(err))
  } finally {
    closeProgress(toastId)
  }
}
