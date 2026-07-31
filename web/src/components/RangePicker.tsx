// Time-range selector for the history timeline, matching the legacy presets.
//
// Filtering is client-side: the whole timeline is one row per scan, so even a
// five-year history is a few hundred points. Refetching per range would add a
// round trip for no benefit.

export type RangeDays = 7 | 30 | 180 | 365 | 1825 | 'all'

export const RANGES: { value: RangeDays; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 30, label: '30D' },
  { value: 180, label: '6M' },
  { value: 365, label: '1Y' },
  { value: 1825, label: '5Y' },
  { value: 'all', label: 'All' },
]

interface Props {
  value: RangeDays
  onChange: (v: RangeDays) => void
  /** Ranges with no data are disabled rather than hidden, so the set stays stable. */
  available: (v: RangeDays) => boolean
}

export function RangePicker({ value, onChange, available }: Props): JSX.Element {
  return (
    <div className="flex rounded-sm border border-border overflow-hidden" role="group" aria-label="Time range">
      {RANGES.map((r) => {
        const enabled = available(r.value)
        return (
          <button
            type="button"
            className={`min-w-[30px] px-1.5 py-1 text-[10px] font-medium text-center transition-colors ${value === r.value ? 'bg-muted text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground'} ${!enabled ? 'opacity-30 cursor-not-allowed' : ''}`}
            key={String(r.value)}
            aria-pressed={value === r.value}
            disabled={!enabled}
            title={enabled ? `Last ${r.label}` : 'No data in this range'}
            onClick={() => onChange(r.value)}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Keep only points within `days` of the newest one. Measured from the last
 * sample rather than "now", so a target that stopped being scanned still shows
 * its final window instead of going blank.
 */
export function filterByRange<T extends { timestamp: number }>(points: T[], days: RangeDays): T[] {
  if (days === 'all' || points.length === 0) return points
  const last = points[points.length - 1]
  if (!last) return points
  const cutoff = last.timestamp - days * 86_400
  return points.filter((p) => p.timestamp >= cutoff)
}
