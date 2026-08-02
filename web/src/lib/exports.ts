// Export jobs: wire an API list to the CSV writer and report progress.
//
// Kept out of the components because an export outlives the view that started it —
// a viewer can switch tabs mid-download — and because both tabs export the same way
// and should not each own a copy of the toast choreography.

import { downloadUrl, exportCsv, fileStamp, safeName, type Row } from './csv.js'
import { fetchPermissions, type DetailQuery, type PermQuery } from './api.js'
import { closeProgress, failure, info, startProgress, success, updateProgress } from './toast.js'
import { formatCount } from './format.js'

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
 * The server streams the CSV directly (`/api/export/…`), so this never pulls
 * JSON pages and re-encodes them — the browser gzips the raw stream to the file
 * the user picks, or downloads it natively. There is no live row count on that
 * path (counting would mean walking the whole range again), so the progress
 * toast shows an indeterminate bar rather than a fraction.
 */
export async function exportUserList(
  target: string,
  user: string,
  kind: 'dirs' | 'files',
  filter: DetailQuery,
): Promise<void> {
  const label = kind === 'dirs' ? 'Directories' : 'Files'

  const params = new URLSearchParams()
  params.set('kind', kind)
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  const url = `/api/export/${encodeURIComponent(target)}/${encodeURIComponent(user)}${qs ? `?${qs}` : ''}`

  const suggested = `${kind}_${safeName(user)}_${fileStamp()}`
  const toastId = startProgress(`Exporting ${label.toLowerCase()}`, `${user} on ${target}`)

  try {
    const result = await downloadUrl({
      url,
      suggestedName: suggested,
      onStatus: (status) => updateProgress(toastId, -1, status),
    })

    if (result.kind === 'cancelled') {
      info('Export cancelled', 'The save dialog was closed.')
      return
    }
    success(`${label} exported`, result.kind === 'streamed' ? `${suggested}.csv.gz` : `${suggested}.csv`)
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
