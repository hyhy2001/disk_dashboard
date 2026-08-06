// The viewer's own group layer.
//
// Three layers decide how users are grouped on a disk, each overriding the one
// before it:
//
//   original  the scanner's own teams, baked into report.db
//   official  what an owner or admin configured, stored in admin.db, shared by everyone
//   user      what this viewer arranged for themselves, stored in this browser only
//
// This module owns the third. It holds definitions and comparison only: the
// actual rollup happens on the server (POST /api/overview/:target/regroup),
// because the overview payload caps its user lists and a client-side sum would
// silently undercount large groups.

/** One group as the viewer defined it. */
export interface UserGroup {
  name: string
  users: string[]
}

/**
 * A viewer's groups for one disk, plus the official layer they were built from.
 *
 * The fingerprint is what lets the UI notice that an admin has since changed the
 * official grouping. Without it, a viewer would keep working from a base that no
 * longer exists and never be told.
 */
export interface UserGroupSet {
  groups: UserGroup[]
  officialFingerprint: string
}

/**
 * A stable fingerprint of a grouping, independent of ordering.
 *
 * Group order, member order and letter case all vary without the grouping
 * actually differing — the server returns teams sorted by size, so simply
 * reordering two users could change a naive hash and raise a false alarm.
 * Everything is normalised before hashing so only real membership changes count.
 */
export function fingerprintGroups(groups: readonly UserGroup[]): string {
  const canonical = groups
    .map((g) => ({
      name: g.name.trim().toLowerCase(),
      users: [...new Set(g.users.map((u) => u.trim().toLowerCase()))].filter(Boolean).sort(),
    }))
    .filter((g) => g.name)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

  // Length-prefixed rather than delimiter-joined: a username may legally contain
  // any character, including whatever separator we picked, so `['a,b']` and
  // `['a', 'b']` would otherwise hash alike and a real regrouping would go
  // unnoticed.
  return hash(canonical.map((g) => `${part(g.name)}${g.users.map(part).join('')}`).join(''))
}

/** Encode one field as `<byte length>:<value>`, so no value can forge a boundary. */
function part(value: string): string {
  return `${value.length}:${value}`
}

/**
 * FNV-1a, 32-bit, hex.
 *
 * Not cryptographic and does not need to be: this only answers "did the official
 * grouping change since I last looked", where the cost of a collision is a
 * missed notice, not a security failure. Inlined rather than pulled from a
 * dependency because it is eight lines.
 */
function hash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    // Multiply by the FNV prime (16777619) using shifts, staying inside 32 bits.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** True when two groupings describe the same membership, whatever their order. */
export function sameGrouping(a: readonly UserGroup[], b: readonly UserGroup[]): boolean {
  return fingerprintGroups(a) === fingerprintGroups(b)
}

/**
 * Reconstruct group membership from an overview payload.
 *
 * Only as complete as the payload: `users` is capped at the server's render
 * limit, so on a large disk this sees the biggest accounts and not the tail.
 * That is fine for seeding the editor and for the change fingerprint — both
 * compare like against like — but it is why totals are never computed from it.
 */
export function teamsToGroups(overview: {
  teams: { name: string }[]
  users: { name: string; team?: string }[]
}): UserGroup[] {
  const byTeam = new Map<string, string[]>()
  for (const team of overview.teams) byTeam.set(team.name, [])
  for (const user of overview.users) {
    if (!user.team) continue
    const members = byTeam.get(user.team)
    if (members) members.push(user.name)
    else byTeam.set(user.team, [user.name])
  }
  return [...byTeam.entries()].map(([name, users]) => ({ name, users }))
}

/**
 * Drop groups that would not survive a round trip: unnamed, or empty.
 *
 * An empty group is legal on the server (it renders as a zero row) but keeping
 * one in a viewer's saved set is just clutter they cannot see the effect of.
 */
export function usableGroups(groups: readonly UserGroup[]): UserGroup[] {
  return groups
    .map((g) => ({ name: g.name.trim(), users: [...new Set(g.users.map((u) => u.trim()).filter(Boolean))] }))
    .filter((g) => g.name && g.users.length > 0)
}
