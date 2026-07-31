// Grouping of targets into teams, read from a config file.
//
// duscan's reports directory is flat: every target is an independent
// reports/<name>/report.db, and the `team` concept inside a report describes who
// consumes space *on that target*, not which targets belong together. The legacy
// dashboard got its two-level Team → Disk navigation from a hand-maintained
// disks.json, so this reproduces that with the same shape.
//
// The file is optional and re-read when it changes on disk, so adding a target to
// a group does not need a restart. A missing or malformed file is not fatal —
// every target simply lands in one default group, which is exactly the behaviour
// a single-team deployment wants anyway.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Target, TargetGroup } from '../../../shared/api.js'

export const GROUPS_FILE = 'teams.json'

/** Group used for targets no config mentions. */
const UNGROUPED = 'Ungrouped'

interface RawGroup {
  name?: unknown
  targets?: unknown
}

/** Parsed config: group name → target names, in file order. */
type Mapping = { name: string; targets: string[] }[]

let cache: { stamp: string; mapping: Mapping } | null = null

function parse(text: string): Mapping {
  const data: unknown = JSON.parse(text)
  if (!Array.isArray(data)) throw new Error('expected a JSON array of groups')

  const out: Mapping = []
  for (const entry of data as RawGroup[]) {
    if (typeof entry?.name !== 'string' || !entry.name.trim()) continue
    const targets = Array.isArray(entry.targets) ? entry.targets.filter((t): t is string => typeof t === 'string') : []
    out.push({ name: entry.name.trim(), targets })
  }
  return out
}

/**
 * Read the group config, or null when there is none. Errors are swallowed and
 * reported as "no config" — a typo in the file must not take the dashboard down,
 * and /api/health surfaces whether a config was actually loaded.
 */
export function readMapping(reportsDir: string): Mapping | null {
  const path = join(reportsDir, GROUPS_FILE)
  if (!existsSync(path)) {
    cache = null
    return null
  }

  try {
    const s = statSync(path)
    const stamp = `${s.mtimeMs}:${s.size}`
    if (cache?.stamp === stamp) return cache.mapping

    const mapping = parse(readFileSync(path, 'utf8'))
    cache = { stamp, mapping }
    return mapping
  } catch {
    cache = null
    return null
  }
}

/**
 * Arrange discovered targets into groups.
 *
 * Config order is preserved so the sidebar reflects however the operator chose to
 * order their teams; targets within a group keep the newest-scan-first order they
 * arrived in. Any target the config does not mention is appended under
 * "Ungrouped" rather than hidden — a target that exists on disk must always be
 * reachable, or a scan would silently go missing from the UI.
 */
export function groupTargets(reportsDir: string, targets: Target[]): TargetGroup[] {
  const mapping = readMapping(reportsDir)
  const byName = new Map(targets.map((t) => [t.name, t]))

  if (!mapping || mapping.length === 0) {
    // No config: one group holding everything, so the UI still has a level to
    // render without special-casing.
    return targets.length === 0 ? [] : [{ name: 'All Targets', targets }]
  }

  const groups: TargetGroup[] = []
  const claimed = new Set<string>()

  for (const g of mapping) {
    const members: Target[] = []
    for (const name of g.targets) {
      const t = byName.get(name)
      // A config naming a target that has not been scanned yet is normal, not an
      // error; it just contributes nothing until the scan runs.
      if (t && !claimed.has(name)) {
        members.push(t)
        claimed.add(name)
      }
    }
    if (members.length > 0) groups.push({ name: g.name, targets: members })
  }

  const rest = targets.filter((t) => !claimed.has(t.name))
  if (rest.length > 0) groups.push({ name: UNGROUPED, targets: rest })

  return groups
}
