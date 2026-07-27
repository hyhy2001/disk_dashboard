// Queries backing the Overview tab.
//
// Two sources feed this view and they answer different questions:
//   - detail_users  = the *current* scan, authoritative for "who uses what now"
//   - hist_*        = one row per past scan, the only source for the timeline
//
// Team display names live in hist_team_usage (detail_users only stores team_id),
// so the team rollup reads the newest snapshot rather than re-deriving names.
//
// Every query here is bounded: aggregates run over detail_users / hist_* which
// hold one row per user or per scan, never over detail_files (70M+ rows). That is
// deliberate — the Overview must stay O(users), not O(files).

import type Database from 'better-sqlite3'
import type { Capacity, HistoryPoint, Overview, Target, UsageRow } from '../../../shared/api.js'

/** Top-N cap for the user lists. The UI charts a leaderboard, not every account. */
const USER_LIMIT = 25

interface SnapshotRow {
  id: number
  scan_date: number
  scanned_at: number | null
  total: number | null
  used: number | null
  available: number | null
}

/**
 * Capacity + timeline from hist_snapshots, newest scan last so the client can
 * plot it without re-sorting.
 */
function readHistory(db: Database.Database): {
  capacity: Capacity | null
  history: HistoryPoint[]
  latestId: number | null
} {
  const rows = db
    .prepare(
      `SELECT id, scan_date, scanned_at, total, used, available
         FROM hist_snapshots
        ORDER BY scan_date ASC`,
    )
    .all() as SnapshotRow[]

  const history: HistoryPoint[] = rows.map((r) => ({
    timestamp: r.scanned_at ?? 0,
    date: r.scan_date,
    totalSize: r.total ?? 0,
    usedSize: r.used ?? 0,
    availableSize: r.available ?? 0,
  }))

  const last = rows.length > 0 ? rows[rows.length - 1] : undefined
  if (!last) return { capacity: null, history, latestId: null }

  // A snapshot with no total means the scan could not stat the filesystem
  // (an LSF path that vanished, say). Report null rather than a bogus 0/0/0.
  const capacity: Capacity | null =
    last.total === null || last.total === 0
      ? null
      : { total: last.total, used: last.used ?? 0, available: last.available ?? 0 }

  return { capacity, history, latestId: last.id }
}

/** Team rollup for the newest snapshot, largest first. */
function readTeams(db: Database.Database, snapshotId: number | null): UsageRow[] {
  if (snapshotId === null) return []
  const rows = db
    .prepare(
      `SELECT name, size
         FROM hist_team_usage
        WHERE snapshot_id = ?
          AND size > 0
        ORDER BY size DESC`,
    )
    .all(snapshotId) as { name: string | null; size: number | null }[]

  return rows.map((r) => ({ name: r.name ?? 'unknown', used: r.size ?? 0 }))
}

/**
 * Top users from the current scan, split by whether they map to a team.
 * `hasTeam` selects the group: legacy called the unmapped ones "other".
 */
function readUsers(db: Database.Database, hasTeam: boolean): UsageRow[] {
  const teamClause = hasTeam
    ? "team_id IS NOT NULL AND team_id <> ''"
    : "(team_id IS NULL OR team_id = '')"

  const rows = db
    .prepare(
      `SELECT username, total_size
         FROM detail_users
        WHERE ${teamClause}
          AND total_size > 0
        ORDER BY total_size DESC
        LIMIT ?`,
    )
    .all(USER_LIMIT) as { username: string; total_size: number }[]

  return rows.map((r) => ({ name: r.username, used: r.total_size }))
}

/** Assemble the whole Overview payload for one target. */
export function readOverview(db: Database.Database, target: Target): Overview {
  const { capacity, history, latestId } = readHistory(db)
  return {
    target,
    capacity,
    teams: readTeams(db, latestId),
    users: readUsers(db, true),
    otherUsers: readUsers(db, false),
    history,
  }
}
