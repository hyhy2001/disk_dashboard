// Change between the two most recent snapshots: current value plus a signed
// delta, as legacy showed above the timeline.
//
// Growth is coloured as a warning, not a success — on a disk-usage dashboard,
// "went up" is the direction that eventually pages someone.

import type { HistoryPoint } from '../../../shared/api.js'
import { formatSize } from '../lib/format.js'

interface Props {
  points: HistoryPoint[]
}

export function DeltaBadge({ points }: Props): JSX.Element | null {
  if (points.length === 0) return null

  const latest = points[points.length - 1] as HistoryPoint
  const prev = points.length > 1 ? (points[points.length - 2] as HistoryPoint) : undefined

  if (!prev) {
    return <span className="text-sm font-semibold tabular-nums">{formatSize(latest.usedSize)}</span>
  }

  const diff = latest.usedSize - prev.usedSize
  const pct = prev.usedSize > 0 ? (diff / prev.usedSize) * 100 : 0
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'

  return (
    <span className="flex items-center gap-2">
      <span className="text-sm font-semibold tabular-nums">{formatSize(latest.usedSize)}</span>
      <span
        className={`inline-flex items-center gap-0.5 rounded-sm px-1.5 py-0.5 text-[12px] font-medium ${
          dir === 'up'
            ? 'bg-rose-500/15 text-rose-400'
            : dir === 'down'
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '='} {formatSize(Math.abs(diff))}
        {prev.usedSize > 0 && ` (${diff >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%)`}
      </span>
    </span>
  )
}
