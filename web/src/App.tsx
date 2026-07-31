// App shell: sidebar + main area.
//
// Layout follows the shadcn/ui sidebar pattern:
//   - Fixed sidebar with collapsible spaces
//   - Main area with header tabs + content
//
// State that identifies "what am I looking at" lives in the URL.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthInfo, Overview, ScanStatus, TargetGroup } from '../../shared/api.js'
import { clearApiCache, fetchGroups, fetchHealth, fetchOverview, fetchStatuses } from './lib/api.js'
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
import { AdminButton } from './components/AdminMenu.js'
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
import { Monitor, HardDrive, Sun, Moon, Settings, FileText, X } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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

  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1280 && window.innerWidth >= 768)
  const [drawer, setDrawer] = useState(false)
  const [route, setRoute] = useState<Route>(currentRoute)
  const [groups, setGroups] = useState<TargetGroup[]>([])
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showChangeLog, setShowChangeLog] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLButtonElement>(null)

  // Scan status for every target, polled once here and shared by the disk column
  // cards and the SyncPill. One request per interval instead of one per consumer,
  // so the SyncPill no longer runs its own /api/status/:target loop.
  const [statuses, setStatuses] = useState<Record<string, ScanStatus>>({})

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])
  useEffect(() => {
    localStorage.setItem(KEYS.theme, theme)
  }, [theme])
  useEffect(() => {
    writeRoute(route)
  }, [route])
  useEffect(() => {
    const onPop = () => setRoute(currentRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Auto-collapse the sidebar on narrow windows, and restore the user's manual
  // choice once there is room again. Below 768px the sidebar is a drawer, so it
  // must stay full-width for the drawer to open usable.
  //
  // Only reacts when the width crosses a threshold, so a manual expand at e.g.
  // 900px is not undone by a one-pixel drag within the same band.
  const manualCollapsedRef = useRef<boolean | null>(null)
  useEffect(() => {
    let band: 'narrow' | 'mid' | 'wide' =
      window.innerWidth < 768 ? 'narrow' : window.innerWidth < 1280 ? 'mid' : 'wide'
    const onResize = () => {
      const next: typeof band =
        window.innerWidth < 768 ? 'narrow' : window.innerWidth < 1280 ? 'mid' : 'wide'
      if (next === band) return
      band = next
      if (next === 'narrow') {
        setCollapsed(false)
      } else if (next === 'mid') {
        setCollapsed(true)
      } else {
        setCollapsed(manualCollapsedRef.current === true)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let live = true
    fetchHealth()
      .then((h) => {
        if (live) setHealth(h)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // Poll scan status for all targets as one request. Skipped while the tab is
  // hidden, and aborted on unmount so a slow poll cannot setState after the app
  // is gone. The result is handed to the disk column and the SyncPill alike.
  useEffect(() => {
    const controller = new AbortController()

    const run = async (): Promise<void> => {
      if (document.hidden) return
      try {
        const list = await fetchStatuses(controller.signal)
        setStatuses(Object.fromEntries(list.map((s) => [s.target, s])))
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) return
      }
    }

    void run()
    const id = setInterval(() => void run(), 3000)
    const onVisible = () => {
      if (!document.hidden) void run()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    let live = true
    fetchGroups()
      .then((g) => {
        if (live) setGroups(g)
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
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

  // Redirect old bookmarks that used the disk display name in the URL instead of
  // the slug. After the slug migration any name-based path 404s, so if the disk
  // segment matches no slug but exactly one display name in the active space,
  // rewrite it in place — the tab then loads as if the slug had been typed.
  useEffect(() => {
    if (!route.disk || !activeGroup) return
    if (activeGroup.targets.some((t) => t.slug === route.disk)) return
    const byName = activeGroup.targets.filter((t) => t.name === route.disk)
    if (byName.length !== 1) return
    setRoute((r) => ({ ...r, disk: byName[0]!.slug }))
  }, [route.disk, activeGroup])

  const active = overview?.target

  useEffect(() => {
    if (!route.disk || !activeGroup) {
      setOverview(null)
      return
    }
    let live = true
    setError(null)
    setOverview(null)
    fetchOverview(route.disk)
      .then((o) => {
        if (live) setOverview(o)
      })
      .catch((err: any) => {
        if (live) setError(err.message)
      })
    return () => {
      live = false
    }
  }, [route.disk, activeGroup])

  const pickSpace = useCallback((name: string) => {
    setRoute((r) => ({ ...r, space: name, disk: null }))
  }, [])

  const pickDisk = useCallback(
    (slug: string) => {
      setRoute((r) => ({
        ...r,
        disk: slug,
        space: r.space ?? activeGroup?.name ?? null,
      }))
    },
    [activeGroup],
  )

  const setPage = useCallback((page: Page) => {
    setRoute((r) => ({ ...r, page }))
  }, [])

  const setTab = useCallback((tab: DetailTab) => {
    setRoute((r) => ({ ...r, page: 'detail', tab }))
  }, [])

  useEffect(() => {
    if (!showSettings) return
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.parentElement?.contains(e.target as Node)) setShowSettings(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSettings])

  useEffect(() => {
    const el = document.getElementById('page-load-time')
    if (!el) return
    const show = () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const ms = nav ? Math.round(nav.loadEventEnd - nav.startTime) : 0
      if (ms <= 0) return
      const target = el.querySelector('[data-ms]')
      if (target) target.textContent = `${ms}ms`
    }
    if (document.readyState === 'complete') show()
    else window.addEventListener('load', show)
    return () => window.removeEventListener('load', show)
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
    <>
      <Toasts />
      <Tooltip />
      <div
        className="flex h-screen overflow-hidden bg-background"
        style={{ '--sidebar-width': collapsed ? '56px' : '256px' } as React.CSSProperties}
      >
        {/* ── Sidebar ── */}
        {/* Drawer backdrop: below the drawer (z-30), above the main content, so
            tapping the dimmed area closes the drawer on mobile. */}
        {drawer && (
          <div
            className="fixed inset-0 z-20 bg-black/40 md:hidden"
            onClick={() => setDrawer(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-[--sidebar-width] flex-col border-r border-border/50 bg-surface backdrop-blur-lg',
            drawer && 'translate-x-0',
            !drawer && '-translate-x-full md:translate-x-0',
          )}
        >
          {/* Brand */}
          <div className="flex h-14 items-center gap-2.5 border-b border-border/40 px-4">
            <a
              className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
              onClick={() => setRoute(DEFAULT_ROUTE)}
            >
              <div className="flex size-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-sm shrink-0">
                <HardDrive className="size-4 text-white" />
              </div>
              {!collapsed && <span className="font-semibold text-sm tracking-tight">Disk Usage</span>}
            </a>
            {!collapsed && (
              <div className="relative">
                <button
                  id="sidebar-settings-btn"
                  onClick={() => setShowSettings((d) => !d)}
                  className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  ref={settingsRef}
                >
                  <Settings className="size-3.5" />
                </button>
                {showSettings && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-md border border-border bg-secondary shadow-lg z-50 overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50">
                      Preferences
                    </div>
                    <button
                      onClick={() => {
                        setShowSettings(false)
                        setShowChangeLog(true)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition-colors"
                    >
                      <FileText className="size-3.5" />
                      Change Log
                    </button>
                  </div>
                )}
              </div>
            )}
            {drawer && (
              <button
                className="md:hidden inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {!collapsed && (
            <div className="px-4 py-1 text-[10px] font-mono text-muted-foreground/50" id="sidebar-clock">
              <LiveClock />
            </div>
          )}

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
                <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Spaces</h2>
                <span className="text-[10px] tabular-nums text-muted-foreground/40">{groups.length}</span>
              </div>
            )}
            {!collapsed && groups.length === 0 && (
              <p className="px-2 text-[11px] text-muted-foreground italic mt-2">
                No spaces yet — add one from the Admin menu below.
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
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-emerald-500" />
                  )}
                  <div
                    className={cn(
                      'flex size-4 items-center justify-center rounded',
                      active ? 'bg-emerald-500/20' : 'bg-muted/30',
                    )}
                  >
                    <Monitor className="size-3" />
                  </div>
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left text-[13px]">{g.name}</span>
                      <span
                        className={cn(
                          'text-[10px] tabular-nums',
                          active ? 'text-emerald-400/70' : 'text-muted-foreground/50',
                        )}
                      >
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
            <AdminButton collapsed={collapsed} />
            <p
              id="page-load-time"
              className={cn(
                'mt-1.5 border-t border-border/30 pt-1.5 text-center text-[10px] font-mono text-muted-foreground/50',
                collapsed && 'mt-2 border-t-0 pt-0 text-[9px]',
              )}
            >
              {collapsed ? (
                <span data-ms />
              ) : (
                <>
                  Load time: <span className="text-emerald-400/80" data-ms>-- ms</span>
                </>
              )}
            </p>
          </div>
          {/* Collapse toggle */}
          <button
            onClick={() => {
              manualCollapsedRef.current = !collapsed
              setCollapsed((c) => !c)
            }}
            className="absolute -right-3 top-5 z-40 hidden md:flex size-5 items-center justify-center rounded-full border border-border/50 bg-surface/80 text-[10px] text-muted-foreground hover:text-foreground hover:border-border transition-colors backdrop-blur-sm"
          >
            {collapsed ? '▸' : '◂'}
          </button>
        </aside>

        {/* ── Disk Column ── */}
        {!collapsed && (
          <div
            className="diskcol hidden lg:block w-[--col2-width] shrink-0 border-r border-border overflow-auto glass-sm"
            style={{ marginLeft: 'var(--sidebar-width)' }}
          >
            <DiskColumn
              groupName={activeGroup?.name ?? 'All Targets'}
              targets={activeGroup?.targets ?? []}
              statuses={statuses}
              selected={route.disk}
              onSelect={pickDisk}
              onToggleSidebar={() => setCollapsed((c) => !c)}
            />
          </div>
        )}

        {/* ── Main ── */}
        <div
          className="flex min-w-0 flex-1 flex-col transition-[margin] duration-200 md:ml-[var(--sidebar-width)] lg:ml-0"
          style={{ marginLeft: collapsed ? 'var(--sidebar-width)' : undefined }}
          ref={mainRef}
        >
          {!collapsed && <ColumnResizer />}

          {/* Header */}
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 glass-sm">
            {/* Mobile menu button */}
            <button
              className="md:hidden -ml-1 inline-flex size-8 items-center justify-center rounded-sm hover:bg-muted"
              onClick={() => {
                setCollapsed(false)
                setDrawer((d) => !d)
              }}
            >
              <span className="text-sm">{drawer ? '✕' : '☰'}</span>
            </button>

            {/* Breadcrumb / Title */}
            <div className="flex items-center gap-2 min-w-0">
              <h1 className="text-sm font-semibold truncate">{active?.name ?? activeGroup?.name ?? 'Disk Usage'}</h1>
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
                      route.page === p.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
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
              <SyncPill
                target={route.disk!}
                status={statuses[route.disk!] ?? null}
                onStale={reloadGroups}
                refreshing={refreshing}
              />
              {overview?.capacity && <StatBar capacity={overview.capacity} />}
            </div>
          )}

          {/* Content */}
          <main className="main flex flex-1 flex-col overflow-auto">
            <ErrorBoundary name="content">
              {error ? (
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
                <div className="flex flex-1 flex-col min-h-0">
                  <nav className="flex flex-wrap items-center gap-1 border-b border-border px-4" role="tablist">
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
      <ChangeLogModal open={showChangeLog} onClose={() => setShowChangeLog(false)} />
    </>
  )
}

function LiveClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return <>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
}

function ChangeLogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-4" />
            Change Log
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm max-h-[60vh] overflow-auto pr-2">
          {CHANGES.map((entry) => (
            <div key={entry.date}>
              <p className="text-xs font-semibold text-muted-foreground">{entry.date}</p>
              <ul className="mt-1 space-y-1">
                {entry.items.map((item, i) => (
                  <li key={i} className="text-xs text-foreground">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

const CHANGES = [
  {
    date: '2026-07-31',
    items: [
      'Disk column: search filter (name/path), grid/list view toggle, detailed scan tooltips (stage, PID, started, elapsed)',
      'Sidebar footer: page load time',
    ],
  },
  {
    date: '2026-07-30',
    items: [
      'Admin dashboard: modal-based login, Disk Mapping, Accounts, Backups, Group Config, Change Password',
      'Live clock in sidebar, Settings dropdown with Change Log',
      'Team Comparison view with chart mode toggles (Absolute, Percent)',
    ],
  },
  {
    date: '2026-07-29',
    items: ['Initial standalone admin page with login, setup, spaces/disks CRUD', 'Backup and restore admin database'],
  },
]
