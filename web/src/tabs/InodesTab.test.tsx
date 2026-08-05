import { describe, expect, it } from 'vitest'
import { filterUsers } from './InodesTab.js'

const users = [
  { name: 'root', inodes: 100, dirs: 10 },
  { name: 'www-data', inodes: 50, dirs: 5 },
  { name: 'MySQL', inodes: 30, dirs: 3 },
]

describe('filterUsers', () => {
  it('returns everything for an empty query', () => {
    expect(filterUsers(users, '')).toEqual(users)
    expect(filterUsers(users, '   ')).toEqual(users)
  })

  it('matches case-insensitively on a substring', () => {
    expect(filterUsers(users, 'mysql').map((u) => u.name)).toEqual(['MySQL'])
    expect(filterUsers(users, 'WWW').map((u) => u.name)).toEqual(['www-data'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterUsers(users, 'nope')).toEqual([])
  })
})
