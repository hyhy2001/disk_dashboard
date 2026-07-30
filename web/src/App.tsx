// App shell: sidebar + main area.
//
// Layout follows the shadcn/ui sidebar pattern:
//   - Fixed sidebar with collapsible spaces
//   - Main area with header tabs + content
//
// State that identifies "what am I looking at" lives in the URL.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthInfo, Overview, TargetGroup } from '../../shared/api.js'
import { clearApiCache, fetchGroups, fetchHealth, fetchOverview } from './lib/api.js'
import { NoTargets } from './components/NoTargets.js'
import { DiskColumn } from './components/DiskColumn.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { SyncPill } from './components/SyncPill.js'
import { Toasts } from './components/Toasts.js'
import { Tooltip } from './components/Tooltip.js'
import { CompareTab } from './tabs/CompareTab.js'
import { HistoryTab } from './tabs/HistoryTab.js'
import { InodesTab } from './tabs/InodesTab.js'
import { OverviewTab } from './tabs/OverviewTab.js'
import { PermissionsTab } from './tabs/PermissionsTab.js'
import { TreemapTab } from './tabs/TreemapTab.js'
import { UserTab } from './tabs/UserTab.js'
import { AdminTab } from './tabs/AdminTab.js'
import { ScrollTop } from './components/ScrollTop.js'
import { StatBar } from './components/StatBar.js'
import { ColumnResizer } from './components/ColumnResizer.js'
import { KEYS, loadFilters, readString } from './lib/prefs.js'
import {
  currentRoute,
  DEFAULT_ROUTE,
  DETAIL_TABS,
  writeRoute,
  type DetailTab,
  type Page,
  type Route,
} from './lib/route.js'
import { cn } from './lib/utils.js'
import { Monitor, HardDrive, Shield, Sun, Moon } from 'lucide-react'

type Theme = 'dark' | 'light'

const PAGES: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'detail', label: 'Detail' },
]

const TAB_LABELS: Record<DetailTab, string> = {
  treemap: 'Treemap',
  history: 'History',
  'detail-user': 'Users',
  permissions: 'Perms',
  inodes: 'Inodes',
}

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

export function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readString(KEYS.theme)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })
  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [route, setRoute] = useState<Route>(currentRoute)
  const [groups, setGroups] = useState<TargetGroup[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])
  useEffect(() => { localStorage.setItem(KEYS.theme, theme) }, [theme])
  useEffect(() => { writeRoute(route) }, [route])
  useEffect(() => {
    const onPop = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let live = true
    fetchHealth().then((h) => { if (live) setHealth(h) }).catch(() => undefined)
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    fetchGroups()
      .then((g) => { if (live) setGroups(g) })
      .catch(() => undefined)
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  // Reload groups when a rescan is detected (SyncPill calls this)
  const reloadGroups = useCallback(() => {
    setRefreshing(true)
    clearApiCache()
    fetchGroups()
      .then(setGroups)
      .catch(() => undefined)
      .finally(() => setRefreshing(false))
  }, [])

  const activeGroup = useMemo(() => {
    if (!route.space) return groups[0] ?? null
    return groups.find((g) => g.name === route.space) ?? null
  }, [groups, route.space])

  const active = overview?.target

  useEffect(() => {
    if (!route.disk || !activeGroup) { setOverview(null); return }
    let live = true
    setError(null)
    setOverview(null)
    fetchOverview(route.disk)
      .then((o) => { if (live) setOverview(o) })
      .catch((err: any) => { if (live) setError(err.message) })
    return () => { live = false }
  }, [route.disk, activeGroup])

  const pickSpace = useCallback((name: string) => {
    setRoute((r) => ({ ...r, space: name, disk: null }))
  }, [])

  const pickDisk = useCallback((name: string) => {
    setRoute((r) => ({
      ...r,
      disk: name,
      space: r.space ?? (activeGroup?.name ?? null),
    }))
  }, [activeGroup])

  const setPage = useCallback((page: Page) => {
    setRoute((r) => ({ ...r, page }))
  }, [])

  const setTab = useCallback((tab: DetailTab) => {
    setRoute((r) => ({ ...r, page: 'detail', tab }))
  }, [])

  const shownGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.name.toLowerCase().includes(q))
  }, [groups, search])

  const savedFilters = useMemo(() => loadFilters(), [])

  // Track which space+disk combo was last seen to maintain the disk column
  const lastDiskRef = useRef<string | null>(null)
  if (route.disk) lastDiskRef.current = route.disk

  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ '--sidebar-width': collapsed ? '56px' : '256px' } as React.CSSProperties}>
      <Toasts />
      <Tooltip />

      {/* ── Sidebar ── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-[--sidebar-width] flex-col border-r border-border/50 bg-surface backdrop-blur-lg',
          drawer && 'translate-x-0',
          !drawer && '-translate-x-full md:translate-x-0',
        )}
      >
        {/* Brand */}
        <a className="flex h-14 items-center gap-2.5 border-b border-border/40 px-4" onClick={() => setRoute(DEFAULT_ROUTE)}>
          <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-sm">
            <HardDrive className="size-4 text-white" />
          </div>
          {!collapsed && <span className="font-semibold text-sm tracking-tight">Disk Usage</span>}
        </a>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 pt-3 pb-1.5">
            <div className="relative">
              <input
                type="search"
                placeholder="Search spaces..."
                className="flex h-8 w-full rounded-md border border-border/50 bg-background/50 px-2.5 pl-7 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 focus-visible:border-emerald-500/30 transition-all"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Monitor className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground/50" />
            </div>
          </div>
        )}

        {/* Spaces */}
        <nav className="flex-1 overflow-auto px-2 py-1.5 space-y-0.5">
          {!collapsed && (
            <div className="flex items-center justify-between px-2 py-1.5">
              <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                Spaces
              </h2>
              <span className="text-[10px] tabular-nums text-muted-foreground/40">{groups.length}</span>
            </div>
          )}
          {!collapsed && groups.length === 0 && (
            <p className="px-2 text-[11px] text-muted-foreground italic mt-2">
              No spaces yet.{' '}
              <button
                onClick={() => setRoute({ ...DEFAULT_ROUTE, page: 'admin' })}
                className="underline hover:text-foreground"
              >
                Go to Admin
              </button>
            </p>
          )}
          {shownGroups.map((g) => {
            const active = g.name === activeGroup?.name
            return (
              <button
                key={g.name}
                onClick={() => pickSpace(g.name)}
                className={cn(
                  'relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all duration-150',
                  active
                    ? 'bg-emerald-500/10 text-emerald-400 font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]',
                  collapsed && 'justify-center px-1',
                )}
                title={collapsed ? g.name : undefined}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-emerald-500" />}
                <div className={cn('flex size-4 items-center justify-center rounded', active ? 'bg-emerald-500/20' : 'bg-muted/30')}>
                  <Monitor className="size-3" />
                </div>
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate text-left text-[13px]">{g.name}</span>
                    <span className={cn('text-[10px] tabular-nums', active ? 'text-emerald-400/70' : 'text-muted-foreground/50')}>
                      {g.targets.length}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border/40 px-2 py-2">
          <div className={cn('flex', collapsed ? 'flex-col gap-1' : 'items-center justify-between')}>
            <button
              onClick={() => setRoute({ ...DEFAULT_ROUTE, page: 'admin' })}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors',
                collapsed && 'justify-center px-1',
              )}
              title="Admin"
            >
              <Shield className="size-3.5" />
              {!collapsed && 'Admin'}
            </button>
            <button
              onClick={toggleTheme}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors',
                collapsed && 'justify-center px-1',
              )}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              {!collapsed && (theme === 'dark' ? 'Light' : 'Dark')}
            </button>
          </div>
        </div>
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="absolute -right-3 top-5 z-40 hidden md:flex size-5 items-center justify-center rounded-full border border-border/50 bg-surface/80 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors backdrop-blur-sm"
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </aside>

      {/* ── Disk Column ── */}
      {!collapsed && (
        <div
          className="diskcol hidden md:block w-[--col2-width] shrink-0 border-r border-border overflow-auto glass-sm"
          style={{ marginLeft: 'var(--sidebar-width)', '--col2-width': '260px' } as React.CSSProperties}
        >
          <DiskColumn
            groupName={activeGroup?.name ?? 'All Targets'}
            targets={activeGroup?.targets ?? []}
            selected={route.disk}
            onSelect={pickDisk}
            onToggleSidebar={() => setCollapsed((c) => !c)}
          />
        </div>
      )}

      {/* ── Main ── */}
      <div
        className="flex flex-1 flex-col transition-[margin] duration-200"
        style={{ marginLeft: collapsed ? 'var(--sidebar-width)' : undefined }}
        ref={mainRef}
      >
        <ColumnResizer />

        {/* Header */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 glass-sm">
          {/* Mobile menu button */}
          <button
            className="md:hidden -ml-1 inline-flex size-8 items-center justify-center rounded-sm hover:bg-muted"
            onClick={() => setDrawer((d) => !d)}
          >
            <span className="text-sm">{drawer ? '✕' : '☰'}</span>
          </button>

          {/* Breadcrumb / Title */}
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-sm font-semibold truncate">
              {active?.name ?? activeGroup?.name ?? 'Disk Usage'}
            </h1>
            {active && (
              <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                {active.scanRoot || '—'}
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Page tabs */}
          {route.disk && (
            <nav className="flex items-center gap-1" role="tablist">
              {PAGES.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={route.page === p.id}
                  onClick={() => setPage(p.id)}
                  className={cn(
                    'inline-flex items-center rounded-sm px-2.5 py-1 text-xs font-medium transition-colors active:scale-[0.97]',
                    route.page === p.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </nav>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          </button>
        </header>

        {/* Sync + Capacity */}
        {active && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-1.5 text-xs">
            <SyncPill target={route.disk!} onStale={reloadGroups} refreshing={refreshing} />
            {overview?.capacity && <StatBar capacity={overview.capacity} />}
          </div>
        )}

        {/* Content */}
        <main className="main flex-1 overflow-auto">
          <ErrorBoundary name="content">
          {route.page === 'admin' ? (
            <AdminTab />
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-destructive">Could not load this target</p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : !route.disk ? (
            groups.length === 0 ? (
              <NoTargets health={health} reason={health?.targetsFound === 0 ? 'no-disks' : 'disk-no-report'} />
            ) : (
              <CompareTab
                spaceName={activeGroup?.name ?? 'All Targets'}
                targets={activeGroup?.targets ?? []}
                onSelect={pickDisk}
              />
            )
          ) : loading && !overview ? (
            <div className="p-6 space-y-4 animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-muted animate-pulse" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-48 rounded-sm bg-muted animate-pulse" />
                  <div className="h-3 w-24 rounded-sm bg-muted animate-pulse" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="h-32 rounded-sm bg-muted animate-pulse" />
                <div className="h-32 rounded-sm bg-muted animate-pulse" />
                <div className="h-32 rounded-sm bg-muted animate-pulse" />
              </div>
              <div className="h-64 rounded-sm bg-muted animate-pulse" />
            </div>
          ) : !overview ? (
            <NoTargets health={health} reason="disk-no-report" />
          ) : route.page === 'overview' ? (
            <OverviewTab overview={overview} />
          ) : (
            <div>
              <nav className="flex items-center gap-1 border-b border-border px-4" role="tablist">
                {DETAIL_TABS.map((id) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={route.tab === id}
                    onClick={() => setTab(id)}
                    className={cn(
                      'inline-flex items-center border-b-2 px-3 py-2 text-xs font-medium transition-colors active:scale-[0.97]',
                      route.tab === id
                        ? 'border-primary text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {TAB_LABELS[id]}
                  </button>
                ))}
              </nav>
              {route.tab === 'treemap' ? (
                <TreemapTab target={route.disk} totalSize={overview.target.totalSize} />
              ) : route.tab === 'history' ? (
                <HistoryTab target={route.disk} />
              ) : route.tab === 'detail-user' ? (
                <UserTab target={route.disk} initialUser={savedFilters.detailUser} />
              ) : route.tab === 'permissions' ? (
                <PermissionsTab target={route.disk} />
              ) : (
                <InodesTab target={route.disk} />
              )}
            </div>
          )}
          </ErrorBoundary>
        </main>
      </div>

      <ScrollTop targetRef={mainRef} />
    </div>
  )
}
