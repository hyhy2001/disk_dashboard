// App shell: three columns and a page body.
//
//   1. spaces   — groups from teams.json, collapsible to icons
//   2. disks    — the targets in the open space, resizable
//   3. main     — page header plus whichever page is routed
//
// State that identifies "what am I looking at" lives in the URL, not here, so a view
// is linkable and survives a reload. Everything else — theme, column width, filter
// selections — lives in localStorage. Neither is component state, because both must
// outlast the component.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthInfo, Overview, TargetGroup } from '../../shared/api.js'
import { clearApiCache, fetchGroups, fetchHealth, fetchOverview } from './lib/api.js'
import { NoTargets } from './components/NoTargets.js'
import { ColumnResizer } from './components/ColumnResizer.js'
import { DiskColumn } from './components/DiskColumn.js'
import { GlobalSearch } from './components/GlobalSearch.js'
import { GroupList } from './components/GroupList.js'
import { SettingsMenu } from './components/SettingsMenu.js'
import { SyncPill } from './components/SyncPill.js'
import { Toasts } from './components/Toasts.js'
import { Tooltip } from './components/Tooltip.js'
import { CompareTab } from './tabs/CompareTab.js'
import { HistoryTab } from './tabs/HistoryTab.js'
import { OverviewTab } from './tabs/OverviewTab.js'
import { PermissionsTab } from './tabs/PermissionsTab.js'
import { TreemapTab } from './tabs/TreemapTab.js'
import { UserTab } from './tabs/UserTab.js'
import { ScrollTop } from './components/ScrollTop.js'
import { StatBar } from './components/StatBar.js'
import { KEYS, loadFilters, readString, writeString } from './lib/prefs.js'
import {
  currentRoute,
  DETAIL_TABS,
  writeRoute,
  type DetailTab,
  type Page,
  type Route,
} from './lib/route.js'

type Theme = 'dark' | 'light'

const PAGES: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'detail', label: 'Detail' },
]

/** Tab labels, in the order legacy showed them. */
const TAB_LABELS: Record<DetailTab, string> = {
  treemap: 'TreeMap',
  history: 'History',
  'detail-user': 'Detail User',
  permissions: 'Permission Issues',
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readString(KEYS.theme)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeString(KEYS.theme, theme)
  }, [theme])

  return [theme, useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])]
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function App(): JSX.Element {
  const [theme, toggleTheme] = useTheme()
  const [route, setRoute] = useState<Route>(currentRoute)
  const [groups, setGroups] = useState<TargetGroup[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readString(KEYS.sidebarCollapsed) === 'true')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Bumped to force a refetch of the current target without changing the route. */
  const [reloadKey, setReloadKey] = useState(0)
  /** Set by search; consumed by the treemap tab to open a directory. */
  const [jumpTo, setJumpTo] = useState<number | null>(null)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed)
    writeString(KEYS.sidebarCollapsed, String(collapsed))
  }, [collapsed])

  // Keep the address bar in step with the route, and follow the back button.
  useEffect(() => {
    writeRoute(route)
  }, [route])

  useEffect(() => {
    const onPop = (): void => setRoute(currentRoute())
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
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

  // Groups load once. The route may already name a space and disk (a deep link), so
  // it wins; otherwise open the first space and leave the disk unset, which lands on
  // the comparison view rather than guessing a disk.
  useEffect(() => {
    let live = true
    fetchGroups()
      .then((list) => {
        if (!live) return
        setGroups(list)
        setRoute((r) => {
          if (r.space && list.some((g) => g.name === r.space)) return r
          const first = list[0]
          return first ? { ...r, space: first.name, disk: null } : r
        })
        if (list.length === 0) setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(errorText(err))
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  const activeGroup = useMemo(
    () => groups.find((g) => g.name === route.space) ?? groups[0],
    [groups, route.space],
  )

  // Fetch the selected disk. `live` guards against a slow response for disk A
  // landing after the user picked B.
  useEffect(() => {
    const disk = route.disk
    if (!disk) {
      setOverview(null)
      setLoading(false)
      return
    }

    let live = true
    setLoading(true)
    setError(null)
    fetchOverview(disk)
      .then((data) => {
        if (!live) return
        setOverview(data)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!live) return
        setError(errorText(err))
        setOverview(null)
        setLoading(false)
      })
    return () => {
      live = false
    }
  }, [route.disk, reloadKey])

  const pickSpace = useCallback((name: string) => {
    // Opening a space clears the disk: the comparison view is the useful landing
    // page, and carrying a disk from another space would be wrong.
    setRoute((r) => ({ ...r, space: name, disk: null }))
    setDrawer(false)
  }, [])

  const pickDisk = useCallback((name: string) => {
    setRoute((r) => ({ ...r, disk: name }))
  }, [])

  const setPage = useCallback((page: Page) => {
    setRoute((r) => ({ ...r, page }))
  }, [])

  const setTab = useCallback((tab: DetailTab) => {
    setRoute((r) => ({ ...r, page: 'detail', tab }))
  }, [])

  /** Search picked a directory: open the treemap there. */
  const openInTreemap = useCallback((id: number) => {
    setJumpTo(id)
    setRoute((r) => ({ ...r, page: 'detail', tab: 'treemap' }))
  }, [])

  const shownGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter((g) => g.name.toLowerCase().includes(q))
  }, [groups, search])

  const active = overview?.target
  const savedFilters = useMemo(() => loadFilters(), [])

  return (
    <>
      <div className="mesh" aria-hidden="true">
        <div className="orb orb--1" />
        <div className="orb orb--2" />
      </div>

      <div className="app">
        {drawer && <div className="backdrop" onClick={() => setDrawer(false)} />}

        <aside className={`sidebar glass${drawer ? ' sidebar--open' : ''}`}>
          <div className="pagehead__top" style={{ gap: '8px' }}>
            <div className="brand">
              <span className="brand__dot" />
              <span className="brand__label">
                Disk<span className="brand__accent"> Usage</span>
              </span>
            </div>
            <button
              type="button"
              className="icon-btn icon-btn--sm sidebar__close"
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
              style={{ marginLeft: 'auto' }}
            >
              ✕
            </button>
          </div>

          <input
            type="search"
            className="sidebar__search"
            placeholder="Search spaces..."
            aria-label="Search spaces"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="sidebar__list">
            <h2 className="col__title">Spaces ({groups.length})</h2>
            <GroupList
              groups={shownGroups}
              selected={activeGroup?.name ?? null}
              onSelect={pickSpace}
            />
          </div>

          <div className="sidebar__foot">
            <span className="brand__label">duscan</span>
            <SettingsMenu
              theme={theme}
              onToggleTheme={toggleTheme}
              collapsed={collapsed}
              onToggleCollapsed={() => setCollapsed((v) => !v)}
              health={health}
            />
          </div>
        </aside>

        <DiskColumn
          groupName={activeGroup?.name ?? 'All Targets'}
          targets={activeGroup?.targets ?? []}
          selected={route.disk}
          onSelect={pickDisk}
          onToggleSidebar={() => setDrawer((v) => !v)}
        />

        <ColumnResizer />

        <main className="main" ref={mainRef}>
          <header className="pagehead glass">
            <div className="pagehead__top">
              <h1 className="pagehead__title">
                {active?.name ?? activeGroup?.name ?? 'Disk Usage'}
              </h1>
              {active && (
                <>
                  <span className="pagehead__sep">·</span>
                  <span className="pagehead__path">{active.scanRoot || '—'}</span>
                </>
              )}

              {route.disk && <GlobalSearch target={route.disk} onOpen={openInTreemap} />}

              {route.disk && (
                <nav className="tabs" role="tablist" aria-label="Pages">
                  {PAGES.map((p) => (
                    <button
                      type="button"
                      className="tab"
                      role="tab"
                      key={p.id}
                      aria-selected={route.page === p.id}
                      onClick={() => setPage(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </nav>
              )}
            </div>

            {/* The pill shares this row rather than taking one of its own: it
                already carries the scan time, so a separate "latest snapshot"
                line would say the same thing twice and cost 38px of header. */}
            <div className="pagehead__sub">
              {active ? (
                route.disk && (
                  <SyncPill
                    target={route.disk}
                    refreshing={loading}
                    onStale={() => {
                      // Every cached response describes the report file that was
                      // just replaced, so the cache goes with it.
                      clearApiCache()
                      setReloadKey((k) => k + 1)
                    }}
                  />
                )
              ) : activeGroup ? (
                <span>
                  {activeGroup.targets.length} disk
                  {activeGroup.targets.length === 1 ? '' : 's'} in this space — pick one to see
                  its detail
                </span>
              ) : (
                <span>Waiting for data…</span>
              )}
            </div>

            {/* Capacity belongs to the target, not to one tab, so it sits in the
                shared header as legacy had it. */}
            {overview?.capacity && <StatBar capacity={overview.capacity} />}
          </header>

          {error ? (
            <div className="state state--error">
              <p className="state__title">Could not load this target</p>
              <p>{error}</p>
            </div>
          ) : !route.disk ? (
            // A space with no disk selected: compare its disks rather than showing
            // an empty prompt.
            groups.length === 0 ? (
              <NoTargets health={health} />
            ) : (
              <CompareTab
                spaceName={activeGroup?.name ?? 'All Targets'}
                targets={activeGroup?.targets ?? []}
                onSelect={pickDisk}
              />
            )
          ) : loading && !overview ? (
            <>
              <div className="skeleton" style={{ height: '88px' }} />
              <div className="skeleton" style={{ height: '64px' }} />
              <div className="skeleton" style={{ height: '220px' }} />
            </>
          ) : !overview ? (
            <NoTargets health={health} />
          ) : route.page === 'overview' ? (
            <OverviewTab overview={overview} />
          ) : (
            <>
              <nav className="subtabs" role="tablist" aria-label="Detail views">
                {DETAIL_TABS.map((id) => (
                  <button
                    type="button"
                    className="subtab"
                    role="tab"
                    key={id}
                    aria-selected={route.tab === id}
                    onClick={() => setTab(id)}
                  >
                    {TAB_LABELS[id]}
                  </button>
                ))}
              </nav>

              {route.tab === 'treemap' ? (
                <TreemapTab
                  target={route.disk}
                  totalSize={overview.target.totalSize}
                  jumpTo={jumpTo}
                  onJumped={() => setJumpTo(null)}
                />
              ) : route.tab === 'history' ? (
                <HistoryTab target={route.disk} />
              ) : route.tab === 'detail-user' ? (
                <UserTab target={route.disk} initialUser={savedFilters.detailUser} />
              ) : (
                <PermissionsTab target={route.disk} />
              )}
            </>
          )}
        </main>

        <ScrollTop targetRef={mainRef} />
      </div>

      <Toasts />
      <Tooltip />
    </>
  )
}
