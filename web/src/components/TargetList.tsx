// Left column: every scanned target, newest scan first (the server sorts).

import type { Target } from '../../../shared/api.js'
import { formatSize, formatTimestamp } from '../lib/format.js'

interface Props {
  targets: Target[]
  selected: string | null
  onSelect: (name: string) => void
}

export function TargetList({ targets, selected, onSelect }: Props): JSX.Element {
  return (
    <>
      <h2 className="col__title">Targets ({targets.length})</h2>
      {targets.length === 0 ? (
        <p className="empty">No matching target.</p>
      ) : (
        targets.map((t) => (
          <button
            type="button"
            className="target"
            key={t.name}
            aria-current={t.name === selected}
            onClick={() => onSelect(t.name)}
          >
            <span className="target__name">{t.name}</span>
            <span className="target__meta">{t.scanRoot || '—'}</span>
            <span className="target__meta">
              {formatSize(t.totalSize)} · {formatTimestamp(t.scanTimestamp)}
            </span>
          </button>
        ))
      )}
    </>
  )
}
