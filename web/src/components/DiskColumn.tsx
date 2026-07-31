// Column 2: disk cards with usage pill and mini capacity bar.
//
// Matches legacy's team-disk-card: each card shows a freshness/scan dot, the
// used% pill, a segmented bar (scanned / unattributed / free), and the four
// headline figures (Total · Used · Scanned · Free). Scan status comes from the
// App-level /api/statuses poll (one request per interval for every card), so a
// running scan shows up on the owning card instead of only on the active disk's
// SyncPill.

import { useMemo, useState } from 'react'
import type { ScanStatus, Target } from '../../../shared/api.js'
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
  /** Scan status per target slug, from the App-level poll. */
  statuses: Record<string, ScanStatus>
  /** Selected disk slug, or null. */
  selected: string | null
  onSelect: (slug: string) => void
  onToggleSidebar: () => void
}

const STAGE_LABEL: Record<string, string> = {
  scan: 'Scanning files',
  report: 'Building report',
  detail: 'Building user detail',
  treemap: 'Building treemap',
  sync: 'Writing report',
  done: 'Completed',
  error: 'Scan failed',
}

function DiskCard({
  t,
  status,
  active,
  onSelect,
}: {
  t: Target
  status?: ScanStatus
  active: boolean
  onSelect: () => void
}) {
  const cap = t.capacity
  const pct = cap && cap.total > 0 ? ((cap.total - cap.available) / cap.total * 100) : 0
  const scannedPct = cap ? (cap.scanned / cap.total * 100) : 0
  // Bytes the filesystem counts as used but the scan did not walk (or could not
  // descend into) — the unattributed gap legacy surfaced as its own segment.
  const unattributedPct = cap ? Math.max(0, pct - scannedPct) : 0
  const barColor = pct >= 85 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'

  const running = status?.running === true
  const failed = status?.stage === 'error'
  const dotColor = running
    ? 'bg-amber-400 animate-pulse'
    : failed
      ? 'bg-rose-500'
      : statusColor(scanAge(t))

  const stageText = running
    ? (status?.stage ? STAGE_LABEL[status.stage] : undefined) ?? 'Working'
    : failed
      ? status?.message ?? 'Scan failed'
      : null

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
            <span className={cn('inline-block size-1.5 rounded-full shrink-0', dotColor)} />
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

      {cap && (
        <>
          <div className="mt-2.5 flex h-2 rounded-full overflow-hidden bg-muted/50 ring-1 ring-inset ring-white/[0.04]">
            <div className={cn('transition-all', barColor)} style={{ width: `${Math.max(0, Math.min(100, scannedPct))}%` }} />
            {/* Unattributed usage: used but not walked by the scan. Gray so the
                gap between "scanned" and "used" reads at a glance. */}
            <div className="bg-gray-500/60 transition-all" style={{ width: `${Math.max(0, Math.min(100, unattributedPct))}%` }} />
          </div>

          {/* Headline figures, matching legacy's extended-disk-stats. */}
          <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-border/40 pt-2">
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40">Total</p>
              <p className="text-[11px] font-semibold tabular-nums truncate">{formatSize(cap.total)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40">Used</p>
              <p className="text-[11px] font-semibold tabular-nums truncate">{formatSize(cap.used)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40">Scanned</p>
              <p className="text-[11px] font-semibold tabular-nums truncate">{formatSize(cap.scanned)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground/40">Free</p>
              <p className="text-[11px] font-semibold tabular-nums truncate">{formatSize(cap.available)}</p>
            </div>
          </div>
        </>
      )}

      {stageText && (
        <p className={cn(
          'mt-1.5 flex items-center gap-1 text-[10px] font-medium',
          failed ? 'text-rose-400' : 'text-amber-400',
        )}>
          <span className="inline-block size-1 rounded-full bg-current animate-pulse" />
          {stageText}
        </p>
      )}
    </button>
  )
}

export function DiskColumn({ groupName, targets, statuses, selected, onSelect, onToggleSidebar: _onToggleSidebar }: Props) {
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
          <DiskCard key={t.slug} t={t} status={statuses[t.slug]} active={t.slug === selected} onSelect={() => onSelect(t.slug)} />
        ))}      </div>
    </div>
  )
}
