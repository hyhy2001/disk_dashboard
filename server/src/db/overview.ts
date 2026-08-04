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
export const USER_LIMIT = 25

interface SnapshotRow {
  id: number
  scan_date: number
  scanned_at: number | null
  total: number | null
  used: number | null
  available: number | null
  /** Derived: SUM of the snapshot's per-user sizes. */
  scanned: number
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
  // hist_snapshots records what the *filesystem* reported (total/used/available).
  // What the scan actually walked is the sum of its per-user rows — verified to
  // equal meta.total_size exactly on every target, so it is the right source for
  // a per-snapshot "scanned" series. Grouping over hist_user_usage is cheap: one
  // row per user per scan.
  const rows = db
    .prepare(
      `SELECT s.id, s.scan_date, s.scanned_at, s.total, s.used, s.available,
              COALESCE((SELECT SUM(u.size) FROM hist_user_usage u
                         WHERE u.snapshot_id = s.id), 0) AS scanned
         FROM hist_snapshots s
        ORDER BY s.scan_date ASC`,
    )
    .all() as SnapshotRow[]

  const history: HistoryPoint[] = rows.map((r) => ({
    timestamp: r.scanned_at ?? 0,
    date: r.scan_date,
    totalSize: r.total ?? 0,
    usedSize: r.used ?? 0,
    availableSize: r.available ?? 0,
    scannedSize: r.scanned,
  }))

  const last = rows.length > 0 ? rows[rows.length - 1] : undefined
  if (!last) return { capacity: null, history, latestId: null }

  // A snapshot with no total means the scan could not stat the filesystem
  // (an LSF path that vanished, say). Report null rather than a bogus 0/0/0.
  const capacity: Capacity | null =
    last.total === null || last.total === 0
      ? null
      : {
          total: last.total,
          used: last.used ?? 0,
          available: last.available ?? 0,
          scanned: last.scanned,
        }

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
function readUsers(db: Database.Database, hasTeam: boolean, snapshotId: number | null): UsageRow[] {
  const teamClause = hasTeam ? "u.team_id IS NOT NULL AND u.team_id <> ''" : "(u.team_id IS NULL OR u.team_id = '')"

  // detail_users.team_id is declared TEXT (holding a stringified integer, see
  // duscan cli/src/main.rs where team_map is built with tid.to_string()), while
  // hist_team_usage.team_id is declared INTEGER. The join still matches because
  // SQLite applies column affinity to a comparison between two columns of
  // different affinity: the TEXT side is converted to a number, so '1' = 1 is
  // true. Do not "fix" this with a CAST — it changes nothing and hides the
  // reason. Scoped to the newest snapshot to avoid duplicate name rows.
  const rows = db
    .prepare(
      `SELECT u.username, u.total_size, t.name AS team
         FROM detail_users u
    LEFT JOIN hist_team_usage t
           ON t.team_id = u.team_id AND t.snapshot_id = ?
        WHERE ${teamClause}
          AND u.total_size > 0
        ORDER BY u.total_size DESC
        LIMIT ?`,
    )
    .all(snapshotId, USER_LIMIT) as {
    username: string
    total_size: number
    team: string | null
  }[]

  return rows.map((r) => ({
    name: r.username,
    used: r.total_size,
    ...(r.team ? { team: r.team } : {}),
  }))
}

/** Assemble the whole Overview payload for one target. */
export function readOverview(db: Database.Database, target: Target): Overview {
  const { capacity, history, latestId } = readHistory(db)
  return {
    target,
    capacity,
    teams: readTeams(db, latestId),
    users: readUsers(db, true, latestId),
    otherUsers: readUsers(db, false, latestId),
    history,
  }
}

/** One admin-configured team: name plus the usernames it owns. */
export interface AdminTeam {
  name: string
  users: string[]
}

/**
 * Reassign every scanned user to its admin team, returning the team rollup and
 * the split user lists. Given the FULL user rows (never a capped leaderboard) —
 * a per-group USER_LIMIT cap here would silently drop team members on disks
 * with more accounts than the cap, skewing the team totals.
 */
export function assignAdminTeams(
  rows: { username: string; total_size: number }[],
  adminTeams: AdminTeam[],
): { teams: UsageRow[]; users: UsageRow[]; otherUsers: UsageRow[] } {
  const userTeam = new Map<string, string>()
  for (const t of adminTeams) {
    for (const u of t.users) userTeam.set(u.toLowerCase(), t.name)
  }

  const teamUsage = new Map<string, number>()
  const teamUsers: UsageRow[] = []
  const otherUsers: UsageRow[] = []

  for (const u of rows) {
    const team = userTeam.get(u.username.toLowerCase())
    if (team) {
      teamUsage.set(team, (teamUsage.get(team) ?? 0) + u.total_size)
      teamUsers.push({ name: u.username, used: u.total_size, team })
    } else {
      otherUsers.push({ name: u.username, used: u.total_size })
    }
  }

  // Admin teams that own no scanned users still appear (as 0), so a misconfigured
  // or not-yet-created account stays visible instead of vanishing.
  for (const t of adminTeams) {
    if (!teamUsage.has(t.name)) teamUsage.set(t.name, 0)
  }

  const teams: UsageRow[] = Array.from(teamUsage.entries())
    .map(([name, used]) => ({ name, used }))
    .sort((a, b) => b.used - a.used)

  return { teams, users: teamUsers, otherUsers }
}
