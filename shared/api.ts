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
  /**
   * Filesystem capacity from the newest snapshot, or null when the scan could not
   * stat the filesystem. Carried on the target rather than only in the Overview
   * payload because the disk cards and the group comparison need real used% for
   * every target at once, without fetching each one's overview.
   */
  capacity: Capacity | null
}

/**
 * A named set of targets, driving the sidebar's Team → Disk navigation.
 *
 * Grouping comes from an optional teams.json beside the reports directory;
 * without one, every target lands in a single group.
 */
export interface TargetGroup {
  name: string
  targets: Target[]
}

/** Filesystem capacity as recorded by the scan. */
export interface Capacity {
  total: number
  used: number
  available: number
  /** Bytes the scan walked. See HistoryPoint.scannedSize. */
  scanned: number
}

export interface UsageRow {
  name: string
  used: number
  /**
   * Team this row belongs to, when known. Present on user rows so the client can
   * filter the user chart by a team picked from the donut; absent on team rows.
   */
  team?: string
}

/** A single point on the capacity/usage timeline (one per scan snapshot). */
export interface HistoryPoint {
  timestamp: number
  /** yyyymmdd, as stored by duscan's hist_snapshots. */
  date: number
  totalSize: number
  usedSize: number
  availableSize: number
  /**
   * Bytes the scan actually walked, which is normally *less* than usedSize:
   * anything the scanner could not descend into is counted by the filesystem
   * but not by duscan. The gap is the useful signal — it is unattributed usage.
   */
  scannedSize: number
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

/** One account in the Detail User picker. */
export interface DetailUser {
  name: string
  used: number
  files: number
  dirs: number
  /** Count of paths this user could not read, from detail_users. */
  permissionIssues: number
  /** True when the user has rows in detail_dirs/detail_files to drill into. */
  hasDetail: boolean
}

/** A directory attributed to one user, largest first. */
export interface UserDir {
  /** detail_dirs.id — part of the keyset cursor. */
  id: number
  path: string
  used: number
  files: number
}

/** A file attributed to one user, largest first. */
export interface UserFile {
  path: string
  size: number
  /** Extension without a dot, or '' when the name has none. */
  ext: string
}

/**
 * Filters shared by the dirs and files queries. Every field is optional; an
 * absent field means "no constraint".
 */
export interface DetailFilter {
  /** Substring terms, OR-ed together, matched case-insensitively on the path. */
  query?: string[]
  /** Extensions without dots, OR-ed together. Files only. */
  ext?: string[]
  minSize?: number
  maxSize?: number
}

/** One page of a keyset-paginated list. */
export interface Page<T> {
  rows: T[]
  /** Opaque cursor for the next page, or null at the end. */
  nextCursor: string | null
  /** Whether another page exists. */
  hasMore: boolean
  /** Sum of `used`/`size` over the rows on this page. */
  pageTotal: number
}

export interface UserDetail {
  user: string
  /** The user's whole footprint, for percentage denominators. */
  userTotal: number
  dirs: Page<UserDir>
  files: Page<UserFile>
  /**
   * True when an extension filter is active. Directory sizes cannot be filtered
   * by extension without summing files, so legacy hides the dirs card instead of
   * showing numbers that ignore the filter.
   */
  dirsSuppressed: boolean
}

/** One unreadable path recorded during the scan. */
export interface PermIssue {
  user: string
  path: string
  /** 'file' or 'directory', as duscan records it. */
  itemType: string
  error: string
}

export interface PermPage {
  rows: PermIssue[]
  /** Rows matching the current filter, across all pages. */
  total: number
  offset: number
  hasMore: boolean
  /** Issue count per user across the whole report, for the filter chips. */
  userCounts: { name: string; count: number }[]
  /** Issue count per distinct error message, for the summary row. */
  errorCounts: { error: string; count: number }[]
}

/** Per-user usage across every snapshot, for the History trend lines. */
export interface UserTrend {
  name: string
  /** One entry per snapshot the user appears in, oldest first. */
  points: { date: number; timestamp: number; used: number }[]
}

export interface HistorySeries {
  /** Whole-target timeline, same shape the Overview chart uses. */
  snapshots: HistoryPoint[]
  /** Every user seen in any snapshot, largest current usage first. */
  users: UserTrend[]
}

/** A directory or file matched by the global search. */
export interface SearchHit {
  /** treemap_dirs.id for a directory, or its parent for a file. */
  id: number
  name: string
  /** Full path, built by walking parents. */
  path: string
  size: number
  kind: 'dir' | 'file'
  owner: string
}

export interface SearchResult {
  hits: SearchHit[]
  hasMore: boolean
  /** Which name tables were searched, so the UI can label a partial result. */
  searched: { dirs: boolean; files: boolean }
}

/**
 * Freshness of a target's report, polled by the sync pill.
 *
 * The dashboard cannot start a scan — it only reads reports — so this reports
 * observed state rather than driving it. `stamp` changes exactly when the report
 * file is replaced, which is what tells the client its data is stale.
 */
export interface ScanStatus {
  target: string
  /** mtimeMs:size of report.db. Compare to detect a rescan. */
  stamp: string
  /** Unix seconds of the scan inside the report. */
  scanTimestamp: number
  /** Unix ms the report file was last written. */
  reportMtime: number
  /**
   * Set when duscan left a status file beside the report: the stage it is on.
   * Absent means no scan is in progress as far as the dashboard can tell.
   */
  stage?: string
  message?: string
  running: boolean
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
  /**
   * Whether a readable teams.json was found. False means either no file or an
   * unparseable one — both fall back to a single group, so this is the only way
   * to tell a typo from an intentional absence.
   */
  groupConfigLoaded: boolean
}
