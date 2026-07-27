// Shared API contract between server and web.
//
// Every response is wrapped so the client can branch on one field, mirroring the
// legacy `{status, data}` envelope so behaviour stays predictable for anyone who
// has worked with the old dashboard.

export type ApiOk<T> = { status: 'success'; data: T }
export type ApiErr = { status: 'error'; message: string }
export type ApiResponse<T> = ApiOk<T> | ApiErr

/** One scanned target = one duscan report.db on disk. */
export interface Target {
  /** Directory name under reports/, used as the route id. */
  name: string
  /** Filesystem root that was scanned (meta.scan_root). */
  scanRoot: string
  /** Unix seconds of the scan (meta.scan_timestamp). */
  scanTimestamp: number
  totalFiles: number
  totalDirs: number
  totalSize: number
  /** report.db size in bytes — surfaced so the UI can warn on huge datasets. */
  dbSizeBytes: number
}

/** Filesystem capacity as recorded by the scan. */
export interface Capacity {
  total: number
  used: number
  available: number
}

export interface UsageRow {
  name: string
  used: number
}

/** A single point on the capacity/usage timeline (one per scan snapshot). */
export interface HistoryPoint {
  timestamp: number
  /** yyyymmdd, as stored by duscan's hist_snapshots. */
  date: number
  totalSize: number
  usedSize: number
  availableSize: number
}

export interface Overview {
  target: Target
  capacity: Capacity | null
  teams: UsageRow[]
  /** Users belonging to a configured team. */
  users: UsageRow[]
  /** Users with no team mapping (legacy called these "other"). */
  otherUsers: UsageRow[]
  history: HistoryPoint[]
}

/** One directory in the treemap. */
export interface TreemapNode {
  /** treemap_dirs.id — the drill-down key. */
  id: number
  /** Directory basename, not the full path. */
  name: string
  size: number
  fileCount: number
  dirCount: number
  /** Resolved username, or `uid-N` when the uid has no passwd entry. */
  owner: string
  /** Whether drilling into this node would show anything. */
  hasChildren: boolean
  hasFiles: boolean
}

/** One step in the path from the scan root to the current node. */
export interface TreemapCrumb {
  id: number
  name: string
}

/** A file inside the open directory. */
export interface TreemapFile {
  name: string
  size: number
  /** Resolved username, or `uid-N`. */
  owner: string
}

export interface TreemapLevel {
  node: TreemapNode
  /** Root first, current node last. */
  path: TreemapCrumb[]
  /** Largest children, biggest first. */
  children: TreemapNode[]
  /**
   * Largest files directly inside this directory, biggest first. Empty unless
   * the request asked for them.
   */
  files: TreemapFile[]
  /** Total number of files directly inside, for a "showing N of M" label. */
  fileTotal: number
  /**
   * Size under `node` not covered by `children` — the truncated tail plus files
   * living directly in this directory. Needed for the rectangles to fill the
   * parent honestly.
   */
  remainder: number
  /** Whether more children exist past the ones returned. */
  truncated: boolean
  /** Number of children returned so far, for the next offset. */
  childOffset: number
  /** Total subdirectories directly inside, for a "showing N of M" label. */
  childTotal: number
}

export interface HealthInfo {
  ok: boolean
  sqliteVersion: string
  /** Whether this SQLite build can do infix search (FTS5 + trigram). */
  trigramAvailable: boolean
  reportsDir: string
  /**
   * Whether reportsDir exists at all. Distinguishes "misconfigured path" from
   * "configured correctly but nothing scanned yet" — the two look identical in
   * an empty target list.
   */
  reportsDirExists: boolean
  targetsFound: number
}
