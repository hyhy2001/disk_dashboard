// Persisted UI preferences.
//
// One module owns every localStorage key so they can be seen at a glance and none
// gets shadowed by a typo. Values are read through a validator, because anything
// in localStorage may have been written by an older build — or edited by hand — and
// a bad value must not crash the boot.

/** Every key this app writes. Keeping them in one object prevents silent typos. */
export const KEYS = {
  theme: 'duscan-theme',
  treemapView: 'duscan-treemap-view',
  sidebarCollapsed: 'duscan-sidebar-collapsed',
  diskColumnWidth: 'duscan-diskcol-width',
  filters: 'duscan-filters',
  compareMode: 'duscan-compare-mode',
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
  if (raw === null) return fallback
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

function isFilterState(v: unknown): v is FilterState {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.rangeDays === 'number' &&
    typeof o.dateStart === 'string' &&
    typeof o.dateEnd === 'string' &&
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
