// Column 1: the groups (legacy called these teams, or "spaces").
//
// Each row shows how many disks the group holds and their combined scanned size,
// so a group can be judged before opening it.

import type { TargetGroup } from '../../../shared/api.js'
import { formatSize } from '../lib/format.js'

interface Props {
  groups: TargetGroup[]
  selected: string | null
  onSelect: (name: string) => void
}

export function GroupList({ groups, selected, onSelect }: Props): JSX.Element {
  if (groups.length === 0) {
    return <p className="empty">No groups.</p>
  }

  return (
    <>
      {groups.map((g) => {
        const size = g.targets.reduce((sum, t) => sum + t.totalSize, 0)
        return (
          <button
            type="button"
            className="group"
            key={g.name}
            aria-current={g.name === selected}
            onClick={() => onSelect(g.name)}
          >
            <span className="group__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </span>
            <span className="group__body">
              <span className="group__name">{g.name}</span>
              <span className="group__meta">
                {g.targets.length} disk{g.targets.length === 1 ? '' : 's'} · {formatSize(size)}
              </span>
            </span>
          </button>
        )
      })}
    </>
  )
}
