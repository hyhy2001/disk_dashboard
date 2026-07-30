// Column 2: disk cards with usage pill and mini capacity bar.

import { useMemo, useState } from 'react'
import type { Target } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'
import { cn } from '@/lib/utils.js'

/** Age of a scan in seconds, or null if unknown. */
function scanAge(t: Target): number | null {
  if (!t.scanTimestamp || t.scanTimestamp === 0) return null
  return Math.floor(Date.now() / 1000) - t.scanTimestamp
}

function statusColor(age: number | null): string {
  if (age === null) return 'bg-muted-foreground/30'
  if (age < 3600 * 6) return 'bg-emerald-500'       // < 6h
  if (age < 3600 * 24) return 'bg-amber-400'         // 6-24h
  return 'bg-rose-500'                                // > 24h
}

function relativeTime(age: number | null): string {
  if (age === null) return 'never'
  if (age < 60) return `${age}s`
  if (age < 3600) return `${Math.floor(age / 60)}m`
  if (age < 86400) return `${Math.floor(age / 3600)}h`
  return `${Math.floor(age / 86400)}d`
}

/** Used capacity percentage for a target, or null when unknown. */
export function usedPercent(t: Target): number | null {
  if (!t.capacity || t.capacity.total <= 0) return null
  return ((t.capacity.total - t.capacity.available) / t.capacity.total) * 100
}

export type DiskSort = 'alpha-asc' | 'alpha-desc' | 'usage-desc' | 'free-desc'

const SORT_LABELS: Record<DiskSort, string> = {
  'alpha-asc': 'Name A–Z', 'alpha-desc': 'Name Z–A',
  'usage-desc': 'Used Capacity (%)', 'free-desc': 'Free Space',
}

interface Props {
  groupName: string
  targets: Target[]
  selected: string | null
  onSelect: (name: string) => void
  onToggleSidebar: () => void
}

function DiskCard({ t, active, onSelect }: { t: Target; active: boolean; onSelect: () => void }) {
  const pct = t.capacity && t.capacity.total > 0
    ? ((t.capacity.total - t.capacity.available) / t.capacity.total * 100)
    : 0
  const scanned = t.capacity ? (t.totalSize / t.capacity.total * 100) : 0
  const used = t.capacity ? (pct - scanned) : 0
  const barColor = pct >= 85 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative w-full rounded-lg border p-3.5 text-left transition-all duration-150',
        active
          ? 'border-emerald-500/40 bg-emerald-500/[0.06] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.15)]'
          : 'border-border/60 bg-surface/50 hover:border-border hover:bg-white/[0.03] shadow-sm',
        'active:scale-[0.98]',
      )}
      aria-current={active ? 'true' : undefined}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-emerald-500" />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn('inline-block size-1.5 rounded-full shrink-0', statusColor(scanAge(t)))} />
            <p className="text-sm font-semibold truncate">{t.name}</p>
          </div>
          <p className="text-[11px] text-muted-foreground/60 font-mono truncate mt-0.5">{t.scanRoot}</p>
        </div>
        {pct > 0 && (
          <span className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums',
            pct >= 85 ? 'bg-rose-500/15 text-rose-400' : pct >= 70 ? 'bg-amber-400/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400',
          )}>
            {pct.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground/60">
        <span>{formatSize(t.totalSize)}</span>
        <span className="text-[8px]">·</span>
        <span>{formatCount(t.totalFiles)} files</span>
        <span className="text-[8px]">·</span>
        <span>{formatCount(t.totalDirs)} dirs</span>
        <span className="ml-auto text-[10px] text-muted-foreground/40">{relativeTime(scanAge(t))}</span>
      </div>

      {t.capacity && (
        <div className="mt-2.5 flex h-2 rounded-full overflow-hidden bg-muted/50 ring-1 ring-inset ring-white/[0.04]">
          <div className={cn('transition-all', barColor)} style={{ width: `${Math.max(0, scanned)}%` }} />
          <div className="bg-white/[0.06]" style={{ width: `${Math.max(0, used)}%` }} />
        </div>
      )}
    </button>
  )
}

export function DiskColumn({ groupName, targets, selected, onSelect, onToggleSidebar: _onToggleSidebar }: Props) {
  const [sort, setSort] = useState<DiskSort>('usage-desc')

  const sorted = useMemo(() => {
    const arr = [...targets]
    switch (sort) {
      case 'alpha-asc': arr.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'alpha-desc': arr.sort((a, b) => b.name.localeCompare(a.name)); break
      case 'usage-desc':
        arr.sort((a, b) => {
          const ap = a.capacity?.total ? (a.capacity.total - a.capacity.available) / a.capacity.total : 0
          const bp = b.capacity?.total ? (b.capacity.total - b.capacity.available) / b.capacity.total : 0
          return bp - ap || a.name.localeCompare(b.name)
        })
        break
      case 'free-desc':
        arr.sort((a, b) => ((b.capacity?.available ?? 0) - (a.capacity?.available ?? 0)) || a.name.localeCompare(b.name))
        break
    }
    return arr
  }, [targets, sort])

  return (
    <div className="flex h-full flex-col bg-surface/30">
      <div className="flex items-center justify-between border-b border-border/40 px-3.5 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold truncate">{groupName}</h2>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{targets.length} disk{targets.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={sort}
            onChange={e => setSort(e.target.value as DiskSort)}
            className="h-6 rounded-md border border-border/40 bg-transparent px-1.5 text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          >
            {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2.5 py-2 space-y-2">
        {sorted.map(t => (
          <DiskCard key={t.name} t={t} active={t.name === selected} onSelect={() => onSelect(t.name)} />
        ))}
      </div>
    </div>
  )
}
