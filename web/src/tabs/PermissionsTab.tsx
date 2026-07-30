// Permission Issues tab — paths the scan could not read.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PermPage } from '../../../shared/api.js'
import { fetchPermissions } from '../lib/api.js'
import { copyPath } from '../lib/clipboard.js'
import { exportPermissions } from '../lib/exports.js'
import { formatCount } from '../lib/format.js'
import { NumberPager } from '../components/Pager.js'
import { useFitRows } from '../lib/useFitRows.js'
import { Button } from '@/components/ui/button.js'
import { Badge } from '@/components/ui/badge.js'
import { Input } from '@/components/ui/input.js'
import { cn } from '@/lib/utils.js'
import { Filter, File, Folder, Download, Copy } from 'lucide-react'

interface Props { target: string }

const ROW_HEIGHT = 28
const UNKNOWN = '__unknown__'

const TYPES = [
  { label: 'All', value: '' },
  { label: 'Files', value: 'file' },
  { label: 'Directories', value: 'directory' },
]

export function PermissionsTab({ target }: Props): JSX.Element {
  const [data, setData] = useState<PermPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [itemType, setItemType] = useState('')
  const [pathQuery, setPathQuery] = useState('')
  const [pathApplied, setPathApplied] = useState('')
  const [users, setUsers] = useState<string[]>([])
  const [userQuery, setUserQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const fit = useFitRows({ rowHeight: ROW_HEIGHT, min: 8, max: 100, reserve: 64 })
  const pageSize = fit.rows

  useEffect(() => { const id = setTimeout(() => setPathApplied(pathQuery), 350); return () => clearTimeout(id) }, [pathQuery])
  useEffect(() => { setPage(1) }, [itemType, pathApplied, users, pageSize])

  useEffect(() => {
    if (!fit.measured) return
    const ctrl = new AbortController()
    setLoading(true); setError(null)
    fetchPermissions(target, {
      offset: (page - 1) * pageSize, limit: pageSize,
      ...(users.length > 0 ? { users: users.join(',') } : {}),
      ...(itemType ? { itemType } : {}),
      ...(pathApplied ? { path: pathApplied } : {}),
    }, ctrl.signal)
      .then(r => { setData(r); setLoading(false) })
      .catch((err: unknown) => { if (!ctrl.signal.aborted) { setError(err instanceof Error ? err.message : String(err)); setData(null); setLoading(false) } })
    return () => ctrl.abort()
  }, [target, page, users, itemType, pathApplied, pageSize, fit.measured])

  const toggleUser = useCallback((name: string) => {
    setUsers(cur => cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name])
  }, [])

  const runExport = useCallback((scope: 'filtered' | 'all') => {
    setExporting(true)
    exportPermissions(target, {
      ...(users.length > 0 ? { users: users.join(',') } : {}),
      ...(itemType ? { itemType } : {}),
      ...(pathApplied ? { path: pathApplied } : {}),
    }, scope).finally(() => setExporting(false))
  }, [target, users, itemType, pathApplied])

  const shownUsers = useMemo(() => {
    if (!data) return []
    const q = userQuery.trim().toLowerCase()
    if (!q) return data.userCounts
    return data.userCounts.filter(u => u.name.toLowerCase().includes(q))
  }, [data, userQuery])

  if (error || !data || data.userCounts.length === 0) {
    return (
      <div ref={fit.ref} className="flex-1 flex items-center justify-center p-8">
        {error ? (
          <div className="text-center space-y-2">
            <p className="text-sm font-semibold text-destructive">Could not load permission issues</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : !data ? (
          <div className="h-64 w-full rounded-md bg-muted animate-pulse" />
        ) : (
          <div className="text-center space-y-2 max-w-md">
            <p className="text-sm font-semibold">No permission issues</p>
            <p className="text-xs text-muted-foreground">The scan read every path it visited. Nothing on this target was skipped for permissions.</p>
          </div>
        )}
      </div>
    )
  }

  const pageCount = Math.max(1, Math.ceil(data.total / pageSize))
  const totalIssues = data.userCounts.reduce((s, u) => s + u.count, 0)
  const namedUsers = data.userCounts.filter(u => u.name !== UNKNOWN)

  return (
    <div className="flex flex-col h-full">
      {/* ── Summary stats ── */}
      <div className="flex items-center gap-4 border-b border-border px-4 py-2.5">
        <div className="text-center"><p className="text-lg font-bold tabular-nums">{formatCount(totalIssues)}</p><p className="text-[10px] text-muted-foreground">Unreadable paths</p></div>
        <div className="text-center"><p className="text-lg font-bold tabular-nums">{formatCount(namedUsers.length)}</p><p className="text-[10px] text-muted-foreground">Users affected</p></div>
        <div className="text-center"><p className="text-lg font-bold tabular-nums">{formatCount(data.userCounts.find(u => u.name === UNKNOWN)?.count ?? 0)}</p><p className="text-[10px] text-muted-foreground">No owning user</p></div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => runExport('filtered')} disabled={exporting}><Download className="size-3 mr-1" />Filtered</Button>
        <Button variant="outline" size="sm" onClick={() => runExport('all')} disabled={exporting}><Download className="size-3 mr-1" />All</Button>
      </div>

      {/* ── Error type chips ── */}
      {data.errorCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
          {data.errorCounts.slice(0, 6).map(e => (
            <Badge key={e.error} variant="secondary" className="text-[10px] gap-1">{e.error}<span className="font-bold">{formatCount(e.count)}</span></Badge>
          ))}
        </div>
      )}

      {/* ── Main: filters + list ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Filters sidebar */}
        <aside className={cn('w-[220px] shrink-0 border-r border-border overflow-auto p-3 space-y-3', !filtersOpen && 'hidden')}>
          <div className="flex gap-1" role="group">
            {TYPES.map(t => (
              <button key={t.value} onClick={() => setItemType(t.value)}
                className={cn('flex-1 rounded-sm py-1 text-[10px] font-medium transition-colors',
                  itemType === t.value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                {t.label}
              </button>
            ))}
          </div>
          <Input placeholder="Filter by path…" value={pathQuery} onChange={e => setPathQuery(e.target.value)} className="h-7 text-xs" />
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Users <span className="font-normal">{users.length === 0 ? 'all' : `${users.length} selected`}</span></h3>
          <Input placeholder="Search user…" value={userQuery} onChange={e => setUserQuery(e.target.value)} className="h-7 text-xs" />
          <div className="space-y-0.5 max-h-[300px] overflow-auto">
            {shownUsers.map(u => {
              const on = users.includes(u.name)
              return (
                <button key={u.name} onClick={() => toggleUser(u.name)}
                  className={cn('flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] transition-colors text-left',
                    on ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-muted-foreground',
                    u.name === UNKNOWN && 'italic')}>
                  <span className="w-3 text-[10px]">{on ? '✓' : ''}</span>
                  <span className="flex-1 truncate">{u.name === UNKNOWN ? 'no owning user' : u.name}</span>
                  <span className="tabular-nums text-[10px]">{formatCount(u.count)}</span>
                </button>
              )
            })}
          </div>
          <Button variant="ghost" size="sm" className="w-full text-[10px]" onClick={() => setUsers([])}>Clear all</Button>
        </aside>

        {/* Issue list */}
        <section className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <Button variant="ghost" size="sm" className="text-[10px]" onClick={() => setFiltersOpen(v => !v)}>
              <Filter className="size-3 mr-1" />Filters{users.length > 0 || itemType || pathApplied ? ' • active' : ''}
            </Button>
            <span className="text-[10px] text-muted-foreground">{formatCount(data.total)} matching · page {page} of {formatCount(pageCount)}</span>
          </div>

          <div ref={fit.ref} className="flex-1 overflow-auto">
            {data.rows.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">No issue matches the current filters.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {data.rows.map((r, i) => (
                  <div key={`${r.path}-${i}`} className="flex items-center gap-2 px-4 py-1.5 hover:bg-muted/30 transition-colors text-xs">
                    {r.itemType === 'directory' ? <Folder className="size-3 text-muted-foreground shrink-0" /> : <File className="size-3 text-muted-foreground shrink-0" />}
                    <Badge variant="secondary" className={cn('text-[9px] shrink-0', r.user === UNKNOWN && 'opacity-50')}>{r.user === UNKNOWN ? 'unknown' : r.user}</Badge>
                    <button onClick={() => void copyPath(r.path)} className="flex-1 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors" title={`${r.path} — click to copy`}>
                      <Copy className="size-2.5 inline mr-1 opacity-0 group-hover:opacity-100" />{r.path}
                    </button>
                    <span className="text-[10px] text-muted-foreground shrink-0">{r.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <NumberPager page={page} pageCount={pageCount} onGo={setPage} busy={loading} />
        </section>
      </div>
    </div>
  )
}
