// Persisted UI preferences.
//
// One module owns every localStorage key so they can be seen at a glance and none
// gets shadowed by a typo. Values are read through a validator, because anything
// in localStorage may have been written by an older build — or edited by hand — and
// a bad value must not crash the boot.

import type { UserGroupSet } from './groups.js'

/** Every key this app writes. Keeping them in one object prevents silent typos. */
export const KEYS = {
  theme: 'duscan-theme',
  treemapView: 'duscan-treemap-view',
  sidebarCollapsed: 'duscan-sidebar-collapsed',
  diskColumnWidth: 'duscan-diskcol-width',
  filters: 'duscan-filters',
  compareMode: 'duscan-compare-mode',
  diskView: 'duscan-disk-view',
  userGroups: 'duscan-user-groups',
} as const

/**
 * Read and validate a JSON value.
 *
 * A parse failure or a value the guard rejects both return the fallback, so a
 * corrupt entry behaves exactly like a missing one.
 */
export function readJson<T>(key: string, guard: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return guard(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing and a full quota both throw here. Losing a preference is
    // not worth failing the interaction that triggered the write.
  }
}

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // See writeJson.
  }
}

export function readNumber(key: string, fallback: number): number {
  const raw = readString(key)
  // '' and whitespace both coerce to 0 via Number(), which would masquerade as a
  // real stored zero — treat them as missing.
  if (raw === null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Filter state that survives a reload, per legacy's storageos_filters_v1.
 *
 * Deliberately not per-target: a viewer comparing two disks wants the same date
 * range and the same selected users on both. Selected users are stored by name, so
 * a name absent from the new target is simply ignored when applied.
 */
export interface FilterState {
  /** Preset window in days, or 0 for "all". */
  rangeDays: number
  /** yyyy-mm-dd, empty for "unset". */
  dateStart: string
  dateEnd: string
  selectedUsers: string[]
  /** Log scale on the History user chart. */
  logScale: boolean
  /** Last user opened in the Detail User tab. */
  detailUser: string | null
}

export const DEFAULT_FILTERS: FilterState = {
  rangeDays: 30,
  dateStart: '',
  dateEnd: '',
  selectedUsers: [],
  logScale: false,
  detailUser: null,
}

/** Dates are stored as '' or yyyy-mm-dd; anything else was hand-edited. */
function isStoredDate(value: string): boolean {
  return value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function isFilterState(v: unknown): v is FilterState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.rangeDays === 'number' &&
    Number.isInteger(o.rangeDays) &&
    o.rangeDays >= 0 &&
    // ~10 years in days. Anything larger is a hand-edited value, and a negative
    // window would flip the history filter into the future.
    o.rangeDays <= 3660 &&
    typeof o.dateStart === 'string' &&
    isStoredDate(o.dateStart) &&
    typeof o.dateEnd === 'string' &&
    isStoredDate(o.dateEnd) &&
    Array.isArray(o.selectedUsers) &&
    o.selectedUsers.every((u) => typeof u === 'string') &&
    typeof o.logScale === 'boolean' &&
    (o.detailUser === null || typeof o.detailUser === 'string')
  )
}

export function loadFilters(): FilterState {
  return readJson(KEYS.filters, isFilterState, DEFAULT_FILTERS)
}

/** Merge a partial update into the stored filters and persist the result. */
export function saveFilters(patch: Partial<FilterState>): FilterState {
  const next = { ...loadFilters(), ...patch }
  writeJson(KEYS.filters, next)
  return next
}

// ---------------------------------------------------------------------------
// Viewer's own groups
// ---------------------------------------------------------------------------

/**
 * Per-disk group overrides, keyed by disk slug.
 *
 * Keyed by disk because a grouping is only meaningful against one report's user
 * list — unlike filters, which are deliberately shared across targets.
 */
type UserGroupStore = Record<string, UserGroupSet>

function isUserGroupSet(v: unknown): v is UserGroupSet {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.officialFingerprint !== 'string') return false
  if (!Array.isArray(o.groups)) return false
  return o.groups.every((g) => {
    if (typeof g !== 'object' || g === null) return false
    const group = g as Record<string, unknown>
    return (
      typeof group.name === 'string' && Array.isArray(group.users) && group.users.every((u) => typeof u === 'string')
    )
  })
}

function isUserGroupStore(v: unknown): v is UserGroupStore {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  return Object.values(v as Record<string, unknown>).every(isUserGroupSet)
}

function loadStore(): UserGroupStore {
  return readJson(KEYS.userGroups, isUserGroupStore, {})
}

/** The viewer's groups for one disk, or null when they have not defined any. */
export function loadUserGroups(slug: string): UserGroupSet | null {
  return loadStore()[slug] ?? null
}

export function saveUserGroups(slug: string, set: UserGroupSet): void {
  writeJson(KEYS.userGroups, { ...loadStore(), [slug]: set })
}

/** Forget this disk's override, dropping the viewer back to the official layer. */
export function clearUserGroups(slug: string): void {
  const store = loadStore()
  // Rebuilt without the key rather than set to undefined: JSON.stringify would
  // keep an `undefined` entry out anyway, but leaving it makes `slug in store`
  // true, which reads as "has an override" to anything checking that way.
  const next: UserGroupStore = {}
  for (const [key, value] of Object.entries(store)) {
    if (key !== slug) next[key] = value
  }
  writeJson(KEYS.userGroups, next)
}

/** Every disk the viewer has grouped, for a "clear all" affordance. */
export function listUserGroupSlugs(): string[] {
  return Object.keys(loadStore())
}
