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
import { KEYS, readString, writeString } from '../lib/prefs.js'
import { cn } from '@/lib/utils.js'

/** Age of a scan in seconds, or null if unknown. */
function scanAge(t: Target): number | null {
  if (!t.scanTimestamp || t.scanTimestamp === 0) return null
  return Math.floor(Date.now() / 1000) - t.scanTimestamp
}

function statusColor(age: number | null): string {
  if (age === null) return 'bg-muted-foreground/30'
  if (age < 3600 * 6) return 'bg-emerald-500' // < 6h
  if (age < 3600 * 24) return 'bg-amber-400' // 6-24h
  return 'bg-rose-500' // > 24h
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

export type DiskView = 'grid' | 'list'

const SORT_LABELS: Record<DiskSort, string> = {
  'alpha-asc': 'Name A–Z',
  'alpha-desc': 'Name Z–A',
  'usage-desc': 'Used Capacity (%)',
  'free-desc': 'Free Space',
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

/** Scan detail lines for the card tooltip, mirroring legacy's tooltip. */
function scanDetail(status: ScanStatus | undefined): string[] {
  if (!status) return []
  const lines: string[] = []
  const stage = status.stage ? (STAGE_LABEL[status.stage] ?? status.stage) : undefined
  if (stage) lines.push(`Stage: ${stage}`)
  if (status.message) lines.push(`Status: ${status.message}`)
  if (status.pid !== undefined) lines.push(`PID: ${status.pid}`)
  if (status.startedAt) {
    lines.push(`Started: ${new Date(status.startedAt * 1000).toLocaleTimeString('en-GB')}`)
  }
  if (status.elapsedSec !== undefined) {
    lines.push(`Elapsed: ${status.elapsedSec}s`)
  } else if (status.startedAt && status.updatedAt) {
    const elapsed = Math.max(0, status.updatedAt - status.startedAt)
    if (elapsed > 0) lines.push(`Elapsed: ${elapsed}s`)
  }
  return lines
}

function DiskCard({
  t,
  status,
  active,
  onSelect,
  view,
}: {
  t: Target
  status?: ScanStatus
  active: boolean
  onSelect: () => void
  view: DiskView
}) {
  const cap = t.capacity
  const pct = cap && cap.total > 0 ? ((cap.total - cap.available) / cap.total) * 100 : 0
  const scannedPct = cap ? (cap.scanned / cap.total) * 100 : 0
  // Bytes the filesystem counts as used but the scan did not walk (or could not
  // descend into) — the unattributed gap legacy surfaced as its own segment.
  const unattributedPct = cap ? Math.max(0, pct - scannedPct) : 0
  const barColor = pct >= 85 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-500'

  const running = status?.running === true
  const failed = status?.stage === 'error'
  const dotColor = running ? 'bg-amber-400 animate-pulse' : failed ? 'bg-rose-500' : statusColor(scanAge(t))

  const stageText = running
    ? ((status?.stage ? STAGE_LABEL[status.stage] : undefined) ?? 'Working')
    : failed
      ? (status?.message ?? 'Scan failed')
      : null

  const detail = scanDetail(status)
  const tooltip = [...detail, `Path: ${t.scanRoot || '—'}`].join('\n')

  if (view === 'list') {
    return (
      <button
        onClick={onSelect}
        data-tooltip={tooltip}
        data-tooltip-pos="top"
        className={cn(
          'relative flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-all duration-150',
          active
            ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
            : 'border-transparent hover:border-border/60 hover:bg-white/[0.03]',
        )}
        aria-current={active ? 'true' : undefined}
      >
        {active && <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-emerald-500" />}
        <span className={cn('inline-block size-1.5 rounded-full shrink-0', dotColor)} />
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{t.name}</span>
        {pct > 0 && (
          <span
            className={cn(
              'shrink-0 text-[13px] font-bold tabular-nums',
              pct >= 85 ? 'text-rose-400' : pct >= 70 ? 'text-amber-400' : 'text-emerald-400',
            )}
          >
            {pct.toFixed(0)}%
          </span>
        )}
        {stageText && <span className={cn('inline-block size-1 rounded-full shrink-0', failed ? 'bg-rose-500' : 'bg-amber-400 animate-pulse')} />}
      </button>
    )
  }

  return (
    <button
      onClick={onSelect}
      data-tooltip={tooltip}
      data-tooltip-pos="top"
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
          <p className="text-[13px] text-muted-foreground/70 font-mono truncate mt-0.5">{t.scanRoot}</p>
        </div>
        {pct > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums',
              pct >= 85
                ? 'bg-rose-500/15 text-rose-400'
                : pct >= 70
                  ? 'bg-amber-400/15 text-amber-400'
                  : 'bg-emerald-500/15 text-emerald-400',
            )}
          >
            {pct.toFixed(0)}%
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[13px] tabular-nums text-muted-foreground/60">
        <span>{formatSize(t.totalSize)}</span>
        <span className="text-[10px]">·</span>
        <span>{formatCount(t.totalFiles)} files</span>
        <span className="text-[10px]">·</span>
        <span>{formatCount(t.totalDirs)} dirs</span>
        <span className="ml-auto text-[12px] text-muted-foreground/60">{relativeTime(scanAge(t))}</span>
      </div>

      {cap && (
        <>
          <div className="mt-2.5 flex h-2 rounded-full overflow-hidden bg-muted/50 ring-1 ring-inset ring-white/[0.04]">
            <div
              className={cn('transition-all', barColor)}
              style={{ width: `${Math.max(0, Math.min(100, scannedPct))}%` }}
            />
            {/* Unattributed usage: used but not walked by the scan. Gray so the
                gap between "scanned" and "used" reads at a glance. */}
            <div
              className="bg-gray-500/60 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, unattributedPct))}%` }}
            />
          </div>

          {/* Headline figures, matching legacy's extended-disk-stats. */}
          <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-border/40 pt-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Total</p>
              <p className="text-[13px] font-semibold tabular-nums truncate">{formatSize(cap.total)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Used</p>
              <p className="text-[13px] font-semibold tabular-nums truncate">{formatSize(cap.used)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Scanned</p>
              <p className="text-[13px] font-semibold tabular-nums truncate">{formatSize(cap.scanned)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Free</p>
              <p className="text-[13px] font-semibold tabular-nums truncate">{formatSize(cap.available)}</p>
            </div>
          </div>
        </>
      )}

      {stageText && (
        <p
          className={cn(
            'mt-1.5 flex items-center gap-1 text-[12px] font-medium',
            failed ? 'text-rose-400' : 'text-amber-400',
          )}
        >
          <span className="inline-block size-1 rounded-full bg-current animate-pulse" />
          {stageText}
        </p>
      )}
    </button>
  )
}

export function DiskColumn({
  groupName,
  targets,
  statuses,
  selected,
  onSelect,
  onToggleSidebar: _onToggleSidebar,
}: Props) {
  const [sort, setSort] = useState<DiskSort>('usage-desc')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<DiskView>(() => {
    const saved = readString(KEYS.diskView)
    return saved === 'list' ? 'list' : 'grid'
  })

  const setAndSaveView = (next: DiskView): void => {
    setView(next)
    writeString(KEYS.diskView, next)
  }

  const sorted = useMemo(() => {
    const arr = [...targets]
    switch (sort) {
      case 'alpha-asc':
        arr.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'alpha-desc':
        arr.sort((a, b) => b.name.localeCompare(a.name))
        break
      case 'usage-desc':
        arr.sort((a, b) => {
          const ap = a.capacity?.total ? (a.capacity.total - a.capacity.available) / a.capacity.total : 0
          const bp = b.capacity?.total ? (b.capacity.total - b.capacity.available) / b.capacity.total : 0
          return bp - ap || a.name.localeCompare(b.name)
        })
        break
      case 'free-desc':
        arr.sort((a, b) => (b.capacity?.available ?? 0) - (a.capacity?.available ?? 0) || a.name.localeCompare(b.name))
        break
    }
    return arr
  }, [targets, sort])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((t) => t.name.toLowerCase().includes(q) || t.scanRoot.toLowerCase().includes(q))
  }, [sorted, query])

  return (
    <div className="flex h-full flex-col bg-surface/30">
      <div className="border-b border-border/40 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{groupName}</h2>
            <p className="text-[12px] text-muted-foreground/60 mt-0.5">
              {visible.length} of {targets.length} disk{targets.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAndSaveView(view === 'grid' ? 'list' : 'grid')}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={view === 'grid' ? 'Compact list' : 'Card grid'}
              aria-pressed={view === 'list'}
            >
              {view === 'grid' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>
              )}
            </button>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as DiskSort)}
              className="h-6 rounded-md border border-border/40 bg-transparent px-1.5 text-[12px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="relative mt-2">
          <svg
            aria-hidden="true"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search disks..."
            aria-label="Search disks"
            className="h-7 w-full rounded-md border border-border/40 bg-transparent pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
      </div>
      <div className={cn('flex-1 overflow-auto px-2.5 py-2', view === 'grid' ? 'space-y-2' : 'space-y-0.5')}>
        {visible.map((t) => (
          <DiskCard
            key={t.slug}
            t={t}
            status={statuses[t.slug]}
            active={t.slug === selected}
            onSelect={() => onSelect(t.slug)}
            view={view}
          />
        ))}
        {visible.length === 0 && (
          <p className="px-2 py-4 text-center text-[13px] text-muted-foreground italic">No disks match “{query}”.</p>
        )}
      </div>
    </div>
  )
}
