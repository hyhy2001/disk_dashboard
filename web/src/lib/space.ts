// Space-level totals for the comparison header.
//
// A space is an arbitrary grouping of targets, and nothing stops two of them from
// living on the same filesystem — the default setup has exactly that, with `/` and
// `/usr` both reporting the same 118 GB device. Adding their capacities up gave a
// header claiming ~220 GB on a ~110 GB machine, which is not a rounding error but
// a number that cannot exist.
//
// duscan does not record a device id, so the filesystem has to be inferred. Two
// snapshots of the same device agree on total *and* available to the byte, and two
// genuinely distinct devices agreeing on both to the byte would be a coincidence
// with no practical consequence (their used figures would match too). That
// fingerprint is what dedupes capacity here.
//
// `scanned` is a different quantity — bytes the walk actually attributed — and two
// targets on one filesystem normally walk disjoint subtrees, so those do add up.
// The exception is a nested pair (`/` and `/usr`): the parent already counted the
// child, so the child is dropped rather than counted twice.

import type { Target } from '../../../shared/api.js'

export interface SpaceTotals {
  /** Capacity of the distinct filesystems behind these targets. */
  total: number
  used: number
  /** Bytes attributed by the scans, without double-counting nested roots. */
  scanned: number
  /** How many targets were folded away as duplicates of another's filesystem. */
  sharedFilesystems: number
}

/** Identity of the filesystem a capacity reading came from. */
function fingerprint(t: Target): string {
  const c = t.capacity
  return c ? `${c.total}:${c.available}` : ''
}

/** Whether `child` sits inside `parent` (or is the same path). */
function isNested(child: string, parent: string): boolean {
  if (child === parent) return true
  const prefix = parent.endsWith('/') ? parent : `${parent}/`
  return child.startsWith(prefix)
}

/**
 * Space capacity that does not exceed the hardware.
 *
 * Targets without a capacity reading contribute nothing; the caller counts those
 * separately so the header can say how many are unknown.
 */
export function spaceTotals(targets: Target[]): SpaceTotals {
  const withCapacity = targets.filter((t) => t.capacity !== null)

  const seen = new Set<string>()
  let total = 0
  let used = 0
  let shared = 0

  for (const t of withCapacity) {
    const key = fingerprint(t)
    if (seen.has(key)) {
      shared += 1
      continue
    }
    seen.add(key)
    total += t.capacity?.total ?? 0
    used += t.capacity?.used ?? 0
  }

  // A root contained by another root on the same filesystem was already walked by
  // that other scan. Comparing only within a filesystem matters: two containers
  // each scanning `/` are separate bytes despite the identical path.
  //
  // Exact duplicates (same filesystem, same root) would each mark the other as
  // covered and drop both, so they are folded to one entry before the test.
  const distinctRoots = new Map<string, Target>()
  for (const t of withCapacity) distinctRoots.set(`${fingerprint(t)}|${t.scanRoot}`, t)
  const roots = [...distinctRoots.values()]

  let scanned = 0
  for (const t of roots) {
    const covered = roots.some(
      (other) => other !== t && fingerprint(other) === fingerprint(t) && isNested(t.scanRoot, other.scanRoot),
    )
    if (!covered) scanned += t.capacity?.scanned ?? 0
  }

  return { total, used, scanned, sharedFilesystems: shared }
}
