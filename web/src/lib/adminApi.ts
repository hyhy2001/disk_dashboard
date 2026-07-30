// Admin API client — typed fetch wrappers with cache dedup.
//
// Unlike the main API cache (which is immutable-report data), admin endpoints
// mutate state, so caching is kept short and cleared on mutation.

import type { SpaceWithDisks, AdminAccount, AuthStatus, DiskTeam } from '../../../shared/api.js'

let _authCache: { data: AuthStatus; ts: number } | null = null

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((body as any).message ?? res.statusText)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthInfo {
  loggedIn: boolean
  user: { id: number; username: string; role: string } | null
  needsSetup: boolean
  rateLimit: { captcha: boolean; attempts: number }
}

export async function fetchAuthStatus(): Promise<AuthInfo> {
  if (_authCache && Date.now() - _authCache.ts < 5000) {
    return _authCache.data as unknown as AuthInfo
  }
  const res = await fetchJson<{ status: string; data: AuthInfo }>('/api/admin/status')
  _authCache = { data: res.data as unknown as AuthStatus, ts: Date.now() }
  return res.data
}

export function clearAuthCache(): void { _authCache = null }

export async function login(username: string, password: string): Promise<AuthInfo['user']> {
  const res = await fetchJson<{ status: string; data: AuthInfo['user'] }>('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  clearAuthCache()
  return res.data
}

export async function logout(): Promise<void> {
  await fetchJson<{ status: string }>('/api/admin/logout', { method: 'POST' })
  clearAuthCache()
}

export async function setup(username: string, password: string): Promise<AuthInfo['user']> {
  const res = await fetchJson<{ status: string; data: AuthInfo['user'] }>('/api/admin/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  clearAuthCache()
  return res.data
}

// ---------------------------------------------------------------------------
// Accounts (owner only)
// ---------------------------------------------------------------------------

export async function fetchAccounts(): Promise<AdminAccount[]> {
  const res = await fetchJson<{ status: string; data: AdminAccount[] }>('/api/admin/accounts')
  return res.data
}

export async function createAccount(username: string, password: string, role: string): Promise<AdminAccount> {
  const res = await fetchJson<{ status: string; data: AdminAccount }>('/api/admin/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, role }),
  })
  return res.data
}

export async function deleteAccount(id: number): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/accounts/${id}`, { method: 'DELETE' })
}

export async function resetAccountPassword(id: number, password: string): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/accounts/${id}/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
  await fetchJson<{ status: string }>('/api/admin/me/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  })
}

// ---------------------------------------------------------------------------
// Spaces & Disks
// ---------------------------------------------------------------------------

export async function fetchSpaces(): Promise<SpaceWithDisks[]> {
  const res = await fetchJson<{ status: string; data: SpaceWithDisks[] }>('/api/admin/spaces')
  return res.data
}

export async function createSpace(name: string): Promise<SpaceWithDisks> {
  const res = await fetchJson<{ status: string; data: any }>('/api/admin/spaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return { ...res.data, disks: [] }
}

export async function updateSpace(id: number, name: string): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/spaces/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteSpace(id: number): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/spaces/${id}`, { method: 'DELETE' })
}

export async function createDisk(spaceId: number, name: string, path: string): Promise<any> {
  const res = await fetchJson<{ status: string; data: any }>('/api/admin/disks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ space_id: spaceId, name, path }),
  })
  return res.data
}

export async function updateDisk(id: number, fields: { name?: string; path?: string }): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/disks/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

export async function deleteDisk(id: number): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/disks/${id}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Disk Teams
// ---------------------------------------------------------------------------

export async function fetchDiskTeams(diskId: number): Promise<DiskTeam[]> {
  const res = await fetchJson<{ status: string; data: DiskTeam[] }>(`/api/admin/disks/${diskId}/teams`)
  return res.data
}

export async function createDiskTeam(diskId: number, name: string): Promise<DiskTeam> {
  const res = await fetchJson<{ status: string; data: DiskTeam }>(`/api/admin/disks/${diskId}/teams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return res.data
}

export async function updateDiskTeam(id: number, fields: { name?: string; users?: string[] }): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/teams/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  })
}

export async function deleteDiskTeam(id: number): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/teams/${id}`, { method: 'DELETE' })
}
