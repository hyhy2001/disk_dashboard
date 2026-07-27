// Typed fetch wrapper. The server always answers with the {status, data}
// envelope, including on 4xx, so one unwrap handles every endpoint.

import type {
  ApiResponse,
  DetailUser,
  HealthInfo,
  HistorySeries,
  Overview,
  PermPage,
  ScanStatus,
  SearchResult,
  Target,
  TargetGroup,
  TreemapLevel,
  UserDetail,
} from '../../../shared/api.js'

/**
 * Cache of resolved GETs, and of GETs still in flight, keyed by URL.
 *
 * Two distinct wins, both taken from legacy's treemap cache:
 *
 *   - Re-fetch avoidance. Drilling into a directory and back out asks for a level
 *     that was already loaded. Report data is immutable between scans, so the
 *     answer cannot have changed.
 *   - In-flight dedup. Two components asking for the same URL in the same tick
 *     share one request instead of racing.
 *
 * Only endpoints passed `cache: true` participate. Anything reporting live state —
 * /api/status above all — must not, or the pill would never notice a rescan.
 */
const cache = new Map<string, unknown>()
const inflight = new Map<string, Promise<unknown>>()

/**
 * Drop cached responses. Called when a rescan is detected, since the report file
 * behind every one of them has been replaced.
 */
export function clearApiCache(): void {
  cache.clear()
  inflight.clear()
}

async function get<T>(path: string, signal?: AbortSignal, cacheable = false): Promise<T> {
  if (cacheable) {
    const hit = cache.get(path)
    if (hit !== undefined) return hit as T
    const pending = inflight.get(path)
    if (pending) return pending as Promise<T>
  }

  const run = async (): Promise<T> => {
    const res = await fetch(path, {
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    })

    let body: ApiResponse<T>
    try {
      body = (await res.json()) as ApiResponse<T>
    } catch {
      // A non-JSON body means the request never reached a route handler (proxy
      // down, HTML error page); surface the status rather than a parse error.
      throw new Error(`${path} returned ${res.status} ${res.statusText}`)
    }

    if (body.status === 'error') throw new Error(body.message)
    return body.data
  }

  if (!cacheable) return run()

  const promise = run()
    .then((data) => {
      cache.set(path, data)
      return data
    })
    .finally(() => {
      // Clear regardless of outcome: a failed request must not be remembered as
      // in-flight forever, and a retry should actually retry.
      inflight.delete(path)
    })

  inflight.set(path, promise)
  return promise
}

export function fetchTargets(): Promise<Target[]> {
  return get<Target[]>('/api/targets')
}

export function fetchGroups(): Promise<TargetGroup[]> {
  return get<TargetGroup[]>('/api/groups')
}

export function fetchOverview(target: string): Promise<Overview> {
  return get<Overview>(`/api/overview/${encodeURIComponent(target)}`)
}

export function fetchHealth(): Promise<HealthInfo> {
  return get<HealthInfo>('/api/health')
}

export interface TreemapQuery {
  /** null starts at the scan root. */
  parent: number | null
  childOffset?: number
  /** Files cost an extra query server-side, so only the list view asks. */
  withFiles?: boolean
  fileOffset?: number
  /** Rows per page. Only the client knows how tall its list box is. */
  limit?: number
}

export function fetchTreemap(target: string, q: TreemapQuery): Promise<TreemapLevel> {
  const params = new URLSearchParams()
  if (q.parent !== null) params.set('parent', String(q.parent))
  if (q.childOffset) params.set('childOffset', String(q.childOffset))
  if (q.withFiles) params.set('files', '1')
  if (q.fileOffset) params.set('fileOffset', String(q.fileOffset))
  if (q.limit) params.set('limit', String(q.limit))

  const qs = params.toString()
  // Cached: drilling in and back out re-requests a level already loaded, and a
  // report's tree cannot change without the file being replaced.
  return get<TreemapLevel>(
    `/api/treemap/${encodeURIComponent(target)}${qs ? `?${qs}` : ''}`,
    undefined,
    true,
  )
}

export function fetchUsers(target: string): Promise<DetailUser[]> {
  // Cached: the picker refetches this on every visit to the Detail User tab.
  return get<DetailUser[]>(`/api/users/${encodeURIComponent(target)}`, undefined, true)
}

/**
 * Filters as the UI holds them: free text and extensions arrive as typed strings
 * so the input can round-trip exactly what the user wrote, and the server does the
 * splitting.
 */
export interface DetailQuery {
  dirCursor?: string
  fileCursor?: string
  limit?: number
  /** Comma or tab separated path terms. */
  query?: string
  /** Comma or tab separated extensions. */
  ext?: string
  minSize?: number
  maxSize?: number
}

/** Append only the params that carry a value, keeping URLs (and caches) stable. */
function withParams(base: string, entries: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === '' || value === 0) continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

export function fetchUserDetail(
  target: string,
  user: string,
  q: DetailQuery = {},
  signal?: AbortSignal,
): Promise<UserDetail> {
  const base = `/api/detail/${encodeURIComponent(target)}/${encodeURIComponent(user)}`
  return get<UserDetail>(withParams(base, { ...q }), signal)
}

export interface PermQuery {
  offset?: number
  limit?: number
  /** Comma separated usernames. */
  users?: string
  itemType?: string
  path?: string
}

export function fetchPermissions(
  target: string,
  q: PermQuery = {},
  signal?: AbortSignal,
): Promise<PermPage> {
  const base = `/api/permissions/${encodeURIComponent(target)}`
  return get<PermPage>(withParams(base, { ...q }), signal)
}

export function fetchHistory(target: string, signal?: AbortSignal): Promise<HistorySeries> {
  // Cached: the whole series is one payload and the tab re-mounts on every visit.
  return get<HistorySeries>(`/api/history/${encodeURIComponent(target)}`, signal, true)
}

export function fetchSearch(
  target: string,
  query: string,
  kind?: 'dir' | 'file',
  signal?: AbortSignal,
): Promise<SearchResult> {
  const base = `/api/search/${encodeURIComponent(target)}`
  return get<SearchResult>(withParams(base, { q: query, ...(kind ? { kind } : {}) }), signal)
}

/**
 * Report freshness. Never cached — this is the one endpoint whose whole purpose is
 * to report change, so a cached answer would freeze the sync pill permanently.
 */
export function fetchStatus(target: string, signal?: AbortSignal): Promise<ScanStatus> {
  return get<ScanStatus>(`/api/status/${encodeURIComponent(target)}`, signal)
}
