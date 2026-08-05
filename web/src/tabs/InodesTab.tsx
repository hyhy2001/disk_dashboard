// Inodes tab — filesystem-level and per-user inode counts.

import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { InodeStats } from '../../../shared/api.js'
import { fetchInodes } from '../lib/api.js'
import { formatCount, formatPercent, formatTimestamp } from '../lib/format.js'
import { usageTone } from '../lib/usage.js'
import { Input } from '@/components/ui/input.js'
import { cn } from '@/lib/utils.js'

interface Props {
  target: string
}

/** Case-insensitive substring filter over account names. */
export function filterUsers(users: InodeStats['users'], query: string): InodeStats['users'] {
  const q = query.trim().toLowerCase()
  if (!q) return users
  return users.filter((u) => u.name.toLowerCase().includes(q))
}

/**
 * Cap on account cards rendered at once. The filter can still match thousands of
 * accounts; rendering every card would swamp the tab for the sake of a tail that
 * is just as reachable by typing more of the name.
 */
const MAX_USERS = 200

function tone(pct: number): string {
  const t = usageTone(pct)
  return t === 'critical' ? 'text-[var(--rose-400)]' : t === 'warning' ? 'text-[var(--amber-400)]' : 'text-[var(--emerald-500)]'
}

function InodeRing({ total, used, scanned }: { total: number; used: number; scanned: number }) {
  const sz = 148
  const sw = sz * 0.14
  const r = (sz - sw) / 2
  const circ = 2 * Math.PI * r
  const walked = Math.min(scanned, used)
  const gap = Math.max(0, used - walked)
  const free = Math.max(0, total - used)
  const slices = [
    { name: 'Scanned', value: walked, color: 'var(--emerald-500)' },
    { name: 'Used, not scanned', value: gap, color: 'var(--amber-400)' },
    { name: 'Free', value: free, color: 'var(--sky-400)' },
  ].filter((s) => s.value > 0)
  let off = 0
  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox={`0 0 ${sz} ${sz}`}
        className="w-[148px] h-[148px] shrink-0"
        role="img"
        aria-label={`${formatPercent(used, total)} of ${formatCount(total)} inodes used`}
      >
        <g transform={`rotate(-90 ${sz / 2} ${sz / 2})`}>
          {slices.map((s) => {
            const len = (s.value / total) * circ
            const el = (
              <circle
                key={s.name}
                cx={sz / 2}
                cy={sz / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={sw}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-off}
              >
                <title>{`${s.name}: ${formatCount(s.value)}`}</title>
              </circle>
            )
            off += len
            return el
          })}
        </g>
        <text
          className="fill-foreground"
          x={sz / 2}
          y={sz / 2 - 4}
          textAnchor="middle"
          fontSize={sz * 0.15}
          fontWeight={600}
        >
          {formatPercent(used, total)}
        </text>
        <text className="fill-muted-foreground" x={sz / 2} y={sz / 2 + 14} textAnchor="middle" fontSize={sz * 0.08}>
          used
        </text>
      </svg>
      <div className="space-y-1 text-[13px]">
        {slices.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span className="size-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <span className="tabular-nums ml-auto">{formatCount(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function InodesTab({ target }: Props): JSX.Element {
  const [data, setData] = useState<InodeStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const ctrl = new AbortController()
    setError(null)
    setData(null)
    fetchInodes(target, ctrl.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      })
    return () => ctrl.abort()
  }, [target])

  useEffect(() => {
    setQuery('')
  }, [target])

  // The list is re-filtered after the input settles, so typing stays responsive
  // even against a report with thousands of accounts.
  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => filterUsers(data?.users ?? [], deferredQuery), [data, deferredQuery])
  const shown = filtered.slice(0, MAX_USERS)
  const truncated = filtered.length > shown.length
  // Hooks must all run before the early returns below, or the hook count would
  // differ between the loading and loaded renders.
  const walked = useMemo(() => (data?.users ?? []).reduce((s, u) => s + u.inodes, 0), [data])

  if (error)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-2">
          <p className="text-sm font-semibold text-destructive">Could not load inode usage</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  if (!data) return <div className="h-64 w-full rounded-md bg-muted animate-pulse m-4" />

  const { total, used, free, scanned } = data
  const usedPct = total !== null && used !== null ? (used / total) * 100 : null
  const unscanned = used !== null ? Math.max(0, used - scanned) : null

  return (
    <div className="flex flex-1 flex-col lg:flex-row h-full min-h-0">
      {/* ── System panel ── */}
      <section className="lg:w-[340px] lg:shrink-0 lg:border-r lg:border-border p-4 space-y-4 overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">System inodes</h2>
          <span className="text-[12px] text-muted-foreground">
            {data.timestamp > 0 ? formatTimestamp(data.timestamp) : 'no snapshot'}
          </span>
        </div>

        {total === null ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">No filesystem inode figures</p>
            <p>
              {data.systemAvailable
                ? 'This filesystem does not report a fixed inode table (btrfs, XFS dynamic, NFS).'
                : 'Rescan the target to fill these in.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Total', value: formatCount(total) },
                {
                  label: 'Used',
                  value: formatCount(used ?? 0),
                  tone: usedPct !== null ? tone(usedPct) : '',
                  title: usedPct !== null ? `${usedPct.toFixed(1)}%` : '',
                },
                {
                  label: 'Scanned',
                  value: formatCount(scanned),
                  good: true,
                  title: unscanned !== null && unscanned > 0 ? `${formatCount(unscanned)} not walked` : 'All covered',
                },
                { label: 'Free', value: formatCount(free ?? 0), good: true },
              ].map((f) => (
                <div key={f.label} className="rounded-sm border border-border p-2.5" title={f.title}>
                  <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{f.label}</p>
                  <p className={cn('text-lg font-bold tabular-nums', f.tone, f.good && 'text-[var(--emerald-500)]')}>
                    {f.value}
                  </p>
                </div>
              ))}
            </div>
            <InodeRing total={total} used={used ?? 0} scanned={scanned} />
          </>
        )}
      </section>

      {/* ── User panel ── */}
      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">Per-user inodes</h2>
          <span className="text-[12px] text-muted-foreground">
            {formatCount(shown.length)}
            {filtered.length !== shown.length ? ` of ${formatCount(filtered.length)}` : ''} account
            {filtered.length !== 1 ? 's' : ''}
          </span>
          {truncated && (
            <span className="text-[12px] text-muted-foreground/70 italic">showing first {formatCount(MAX_USERS)} — narrow the search</span>
          )}
          <div className="flex-1 hidden md:block" />
          <Input
            placeholder="Search users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-7 w-48 text-xs"
          />
        </div>
        <div className="flex-1 overflow-auto p-2">
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4 text-center">
              {data.users.length === 0
                ? 'No account owns any file in this report.'
                : `No account matches "${query.trim()}".`}
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {shown.map((u) => {
                const walkPct = walked > 0 ? (u.inodes / walked) * 100 : 0
                return (
                  <div key={u.name} className="rounded-sm border border-border p-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-medium truncate" title={u.name}>
                        {u.name}
                      </span>
                      <span className="text-sm font-bold tabular-nums">{formatCount(u.inodes)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted mb-2">
                      <div
                        className="h-full rounded-full bg-primary/60"
                        style={{ width: `${Math.min(100, walkPct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
                      <span>{formatPercent(u.inodes, walked)} of scanned</span>
                      <span>{formatCount(u.dirs)} dirs</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
