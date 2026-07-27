// Typed fetch wrapper. The server always answers with the {status, data}
// envelope, including on 4xx, so one unwrap handles every endpoint.

import type {
  ApiResponse,
  HealthInfo,
  Overview,
  Target,
  TreemapLevel,
} from '../../../shared/api.js'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })

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

export function fetchTargets(): Promise<Target[]> {
  return get<Target[]>('/api/targets')
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
}

export function fetchTreemap(target: string, q: TreemapQuery): Promise<TreemapLevel> {
  const params = new URLSearchParams()
  if (q.parent !== null) params.set('parent', String(q.parent))
  if (q.childOffset) params.set('childOffset', String(q.childOffset))
  if (q.withFiles) params.set('files', '1')
  if (q.fileOffset) params.set('fileOffset', String(q.fileOffset))

  const qs = params.toString()
  return get<TreemapLevel>(
    `/api/treemap/${encodeURIComponent(target)}${qs ? `?${qs}` : ''}`,
  )
}
