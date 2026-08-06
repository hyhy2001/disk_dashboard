import { describe, expect, it } from 'vitest'
import { fingerprintGroups, sameGrouping, usableGroups, type UserGroup } from './groups.js'

describe('fingerprintGroups', () => {
  it('ignores group order, member order and case', () => {
    const a: UserGroup[] = [
      { name: 'Infra', users: ['Root', 'syslog'] },
      { name: 'devs', users: ['alice'] },
    ]
    const b: UserGroup[] = [
      { name: 'devs', users: ['ALICE'] },
      { name: 'infra', users: ['syslog', 'root'] },
    ]
    // The server returns teams sorted by size, so a group that merely grew would
    // otherwise reorder and read as a change it is not.
    expect(fingerprintGroups(a)).toBe(fingerprintGroups(b))
  })

  it('changes when a member moves between groups', () => {
    const before = fingerprintGroups([
      { name: 'infra', users: ['root', 'syslog'] },
      { name: 'devs', users: ['alice'] },
    ])
    const after = fingerprintGroups([
      { name: 'infra', users: ['root'] },
      { name: 'devs', users: ['alice', 'syslog'] },
    ])
    expect(after).not.toBe(before)
  })

  it('changes when a group is renamed, added or removed', () => {
    const base: UserGroup[] = [{ name: 'infra', users: ['root'] }]
    expect(fingerprintGroups([{ name: 'ops', users: ['root'] }])).not.toBe(fingerprintGroups(base))
    expect(fingerprintGroups([...base, { name: 'devs', users: ['alice'] }])).not.toBe(fingerprintGroups(base))
    expect(fingerprintGroups([])).not.toBe(fingerprintGroups(base))
  })

  it('treats a duplicated member as a single one', () => {
    expect(fingerprintGroups([{ name: 'infra', users: ['root', 'root', 'ROOT'] }])).toBe(
      fingerprintGroups([{ name: 'infra', users: ['root'] }]),
    )
  })

  it('is stable across calls and returns a fixed-width hex string', () => {
    const groups: UserGroup[] = [{ name: 'infra', users: ['root'] }]
    const first = fingerprintGroups(groups)
    expect(fingerprintGroups(groups)).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{8}$/)
  })

  it('does not confuse a member boundary with a name containing the separator', () => {
    // 'a,b' as one username must not fingerprint the same as members 'a' and 'b'.
    expect(fingerprintGroups([{ name: 'g', users: ['a,b'] }])).not.toBe(
      fingerprintGroups([{ name: 'g', users: ['a', 'b'] }]),
    )
  })
})

describe('sameGrouping', () => {
  it('is true for equivalent groupings and false once membership differs', () => {
    expect(sameGrouping([{ name: 'a', users: ['x'] }], [{ name: 'A', users: ['X'] }])).toBe(true)
    expect(sameGrouping([{ name: 'a', users: ['x'] }], [{ name: 'a', users: ['y'] }])).toBe(false)
  })
})

describe('usableGroups', () => {
  it('drops unnamed and empty groups, and trims and dedupes members', () => {
    expect(
      usableGroups([
        { name: '  infra  ', users: [' root ', 'root', ''] },
        { name: '   ', users: ['alice'] },
        { name: 'empty', users: [] },
      ]),
    ).toEqual([{ name: 'infra', users: ['root'] }])
  })
})
