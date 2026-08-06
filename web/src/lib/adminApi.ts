// Admin API client — typed fetch wrappers with cache dedup.
//
// Unlike the main API cache (which is immutable-report data), admin endpoints
// mutate state, so caching is kept short and cleared on mutation.

import type { SpaceWithDisks, AdminAccount, DiskTeam } from '../../../shared/api.js'

let _authCache: { data: AuthInfo; ts: number } | null = null

/** Fired when a session expires mid-use, so the UI can drop back to the login view. */
const authInvalidListeners = new Set<() => void>()

/** Subscribe to session expiry. Returns an unsubscribe function. */
export function onAuthInvalid(fn: () => void): () => void {
  authInvalidListeners.add(fn)
  return () => authInvalidListeners.delete(fn)
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (res.status === 401) {
    // The session is gone: the cached "logged in" answer must not outlive it,
    // and the UI should stop pretending the admin area is open.
    clearAuthCache()
    for (const fn of authInvalidListeners) fn()
  }
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
    return _authCache.data
  }
  const res = await fetchJson<{ status: string; data: AuthInfo }>('/api/admin/status')
  _authCache = { data: res.data, ts: Date.now() }
  return res.data
}

export function clearAuthCache(): void {
  _authCache = null
}

export async function login(
  username: string,
  password: string,
  captchaId?: string,
  captchaAnswer?: number,
): Promise<AuthInfo['user']> {
  const body: any = { username, password }
  if (captchaId !== undefined && captchaAnswer !== undefined) {
    body.captchaId = captchaId
    body.captchaAnswer = captchaAnswer
  }
  const res = await fetchJson<{ status: string; data: AuthInfo['user'] }>('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  clearAuthCache()
  return res.data
}

export async function fetchCaptcha(): Promise<{ id: string; question: string }> {
  const res = await fetchJson<{ status: string; data: { id: string; question: string } }>('/api/admin/captcha')
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

/** A disk as the Group Config editor needs it — identity only, no path. */
export interface GroupTarget {
  id: number
  name: string
  slug: string
  spaceName: string
}

/**
 * Disks an admin may configure groups for.
 *
 * Group Config cannot use `fetchSpaces`: that endpoint is owner-only because it
 * carries filesystem paths, so an `admin` account gets a 403 from it.
 */
export async function fetchGroupTargets(): Promise<GroupTarget[]> {
  const res = await fetchJson<{ status: string; data: GroupTarget[] }>('/api/admin/group-targets')
  return res.data
}

/** One space as the Disk Mapping editor submits it. `id` absent means "create". */
export interface LayoutSpaceInput {
  id?: number
  name: string
  disks: { id?: number; name: string; path: string }[]
}

/**
 * Save the whole Disk Mapping layout in one request.
 *
 * Replaces the old loop of per-entity create/update/delete calls, which
 * committed whatever had already succeeded when one of them failed. The server
 * applies this inside a transaction, so a rejected save leaves the mapping
 * exactly as it was. Returns the saved layout, so the editor can reset its
 * baseline from what the server actually stored rather than from what it hoped
 * it sent.
 */
export async function saveSpaceLayout(spaces: LayoutSpaceInput[]): Promise<SpaceWithDisks[]> {
  const res = await fetchJson<{ status: string; data: SpaceWithDisks[] }>('/api/admin/spaces/layout', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ spaces }),
  })
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

export interface DiskReadTest {
  path: string
  reportFound: boolean
  reportReadable: boolean
  scanRoot?: string
  scanTimestamp?: number
  totalSize?: number
  totalFiles?: number
  totalDirs?: number
  message?: string
}

/** Probe a disk path before saving the mapping — readonly on the server. */
export async function testDiskRead(path: string): Promise<DiskReadTest> {
  const res = await fetchJson<{ status: string; data: DiskReadTest }>('/api/admin/disks/test-read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  return res.data
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

export async function importDiskTeams(diskId: number): Promise<{ imported: number; teams: DiskTeam[] }> {
  const res = await fetchJson<{ status: string; data: { imported: number; teams: DiskTeam[] } }>(
    `/api/admin/disks/${diskId}/import-teams`,
    { method: 'POST' },
  )
  return res.data
}

export async function fetchDiskUsers(diskId: number): Promise<string[]> {
  const res = await fetchJson<{ status: string; data: string[] }>(`/api/admin/disks/${diskId}/users`)
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

// ---------------------------------------------------------------------------
// Backup & Restore
// ---------------------------------------------------------------------------

export interface BackupInfo {
  name: string
  mtime: string
  size: number
}

export async function fetchBackups(): Promise<BackupInfo[]> {
  const res = await fetchJson<{ status: string; data: BackupInfo[] }>('/api/admin/backups')
  return res.data
}

export async function createBackup(): Promise<BackupInfo> {
  const res = await fetchJson<{ status: string; data: BackupInfo }>('/api/admin/backups', { method: 'POST' })
  return res.data
}

export async function restoreBackup(name: string): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/backups/${encodeURIComponent(name)}/restore`, { method: 'POST' })
}

export async function deleteBackup(name: string): Promise<void> {
  await fetchJson<{ status: string }>(`/api/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface SummaryStats {
  spaces: number
  disks: number
  teams: number
  teamUsers: number
  accounts: number
}

export async function fetchStats(): Promise<SummaryStats> {
  const res = await fetchJson<{ status: string; data: SummaryStats }>('/api/admin/stats')
  return res.data
}
