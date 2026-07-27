// Target grouping.
//
// The invariant that matters most: a target present on disk must always appear in
// some group. Losing one would mean a scan silently vanishes from the UI, which
// is worse than showing it under an ugly default heading.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Target } from '../../../shared/api.js'
import { groupTargets, GROUPS_FILE } from './groups.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dash-groups-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function target(name: string): Target {
  return {
    name,
    scanRoot: `/${name}`,
    scanTimestamp: 1_700_000_000,
    totalFiles: 1,
    totalDirs: 1,
    totalSize: 100,
    dbSizeBytes: 10,
    capacity: null,
  }
}

function writeConfig(value: unknown): void {
  writeFileSync(join(dir, GROUPS_FILE), JSON.stringify(value))
}

function writeRaw(text: string): void {
  writeFileSync(join(dir, GROUPS_FILE), text)
}

/** Every input target must be reachable in the output. */
function allNames(groups: { targets: Target[] }[]): string[] {
  return groups.flatMap((g) => g.targets.map((t) => t.name)).sort()
}

describe('groupTargets', () => {
  it('puts everything in one group when no config exists', () => {
    const out = groupTargets(dir, [target('a'), target('b')])

    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('All Targets')
    expect(out[0]?.targets).toHaveLength(2)
  })

  it('returns no groups when there are no targets', () => {
    expect(groupTargets(dir, [])).toEqual([])
  })

  it('groups targets as the config names them, in config order', () => {
    writeConfig([
      { name: 'Storage', targets: ['b'] },
      { name: 'Compute', targets: ['a'] },
    ])
    const out = groupTargets(dir, [target('a'), target('b')])

    expect(out.map((g) => g.name)).toEqual(['Storage', 'Compute'])
    expect(out[0]?.targets.map((t) => t.name)).toEqual(['b'])
  })

  it('collects unmentioned targets under Ungrouped rather than dropping them', () => {
    writeConfig([{ name: 'Storage', targets: ['a'] }])
    const out = groupTargets(dir, [target('a'), target('b'), target('c')])

    expect(out.map((g) => g.name)).toEqual(['Storage', 'Ungrouped'])
    expect(allNames(out)).toEqual(['a', 'b', 'c'])
  })

  it('ignores config entries for targets that have not been scanned', () => {
    writeConfig([{ name: 'Storage', targets: ['a', 'never-scanned'] }])
    const out = groupTargets(dir, [target('a')])

    expect(out).toHaveLength(1)
    expect(out[0]?.targets.map((t) => t.name)).toEqual(['a'])
  })

  it('drops groups that would end up empty', () => {
    writeConfig([
      { name: 'Empty', targets: ['nothing-here'] },
      { name: 'Real', targets: ['a'] },
    ])
    const out = groupTargets(dir, [target('a')])

    expect(out.map((g) => g.name)).toEqual(['Real'])
  })

  it('assigns a target listed twice to the first group only', () => {
    writeConfig([
      { name: 'First', targets: ['a'] },
      { name: 'Second', targets: ['a'] },
    ])
    const out = groupTargets(dir, [target('a')])

    expect(out.map((g) => g.name)).toEqual(['First'])
    expect(allNames(out)).toEqual(['a'])
  })

  it('falls back to a single group when the config is malformed', () => {
    writeRaw('{ this is not json')
    const out = groupTargets(dir, [target('a')])

    // A typo must not hide targets.
    expect(out).toHaveLength(1)
    expect(allNames(out)).toEqual(['a'])
  })

  it('falls back when the config is valid JSON but the wrong shape', () => {
    writeConfig({ Storage: ['a'] })
    const out = groupTargets(dir, [target('a')])

    expect(out[0]?.name).toBe('All Targets')
  })

  it('skips entries with no usable name but keeps the rest', () => {
    writeConfig([{ targets: ['a'] }, { name: '  ', targets: ['b'] }, { name: 'Real', targets: ['c'] }])
    const out = groupTargets(dir, [target('a'), target('b'), target('c')])

    expect(out.map((g) => g.name)).toEqual(['Real', 'Ungrouped'])
    expect(allNames(out)).toEqual(['a', 'b', 'c'])
  })

  it('tolerates a group with a missing targets list', () => {
    writeConfig([{ name: 'Storage' }])
    const out = groupTargets(dir, [target('a')])

    expect(out.map((g) => g.name)).toEqual(['Ungrouped'])
    expect(allNames(out)).toEqual(['a'])
  })

  it('picks up an edited config without a restart', () => {
    writeConfig([{ name: 'Before', targets: ['a'] }])
    expect(groupTargets(dir, [target('a')])[0]?.name).toBe('Before')

    writeConfig([{ name: 'After', targets: ['a'] }])
    expect(groupTargets(dir, [target('a')])[0]?.name).toBe('After')
  })
})
