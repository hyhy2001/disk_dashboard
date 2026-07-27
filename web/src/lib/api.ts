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

/** `parent` null starts at the scan root. */
export function fetchTreemap(target: string, parent: number | null): Promise<TreemapLevel> {
  const q = parent === null ? '' : `?parent=${parent}`
  return get<TreemapLevel>(`/api/treemap/${encodeURIComponent(target)}${q}`)
}
