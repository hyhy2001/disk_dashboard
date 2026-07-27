// App shell, laid out like the legacy dashboard: a fixed sidebar owning target
// navigation, a scrolling main column of floating glass panels, and a mesh
// background behind both.
//
// The page header carries the target's identity (name, scanned root, scan time)
// so the main column always says what you are looking at without consulting the
// sidebar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthInfo, Overview, Target } from '../../shared/api.js'
import { fetchHealth, fetchOverview, fetchTargets } from './lib/api.js'
import { NoTargets } from './components/NoTargets.js'
import { TargetList } from './components/TargetList.js'
import { UsageList } from './components/UsageList.js'
import { OverviewTab } from './tabs/OverviewTab.js'
import { TreemapTab } from './tabs/TreemapTab.js'
import { ScrollTop } from './components/ScrollTop.js'
import { formatTimestamp } from './lib/format.js'

type Theme = 'dark' | 'light'

// Two top-level pages, as in the legacy dashboard: Overview is the charts view,
// Detail holds the per-directory and per-user tabs.
type PageId = 'overview' | 'detail'

/** Sub-tabs of the Detail page. Only 'treemap' is implemented so far. */
type DetailTabId = 'treemap'

const PAGES: { id: PageId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'detail', label: 'Detail' },
]

const LIVE_DETAIL_TABS: { id: DetailTabId; label: string }[] = [
  { id: 'treemap', label: 'TreeMap' },
]

// Rendered disabled rather than hidden so the information architecture is
// visible from the start. Inodes needs duscan to emit an inode table first.
const PLANNED_DETAIL_TABS = ['History', 'Detail User', 'Permission Issues', 'Inodes'] as const

const THEME_KEY = 'duscan-theme'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return [theme, toggle]
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function App(): JSX.Element {
  const [theme, toggleTheme] = useTheme()
  const [targets, setTargets] = useState<Target[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [page, setPage] = useState<PageId>('overview')
  const [detailTab, setDetailTab] = useState<DetailTabId>('treemap')
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Health is only needed to explain an empty target list, so a failure here is
  // not surfaced as an error — the target list has its own error path.
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

  // Target list loads once; it changes only when a scan adds a directory.
  useEffect(() => {
    let live = true
    fetchTargets()
      .then((list) => {
        if (!live) return
        setTargets(list)
        setSelected(list[0]?.name ?? null)
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

  // Reload the detail payload whenever the selection changes. `live` guards
  // against a slow response for target A landing after the user picked B.
  useEffect(() => {
    if (!selected) return
    let live = true
    setLoading(true)
    setError(null)
    fetchOverview(selected)
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
  }, [selected])

  const active = overview?.target
  const shownTargets = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return targets
    return targets.filter(
      (t) => t.name.toLowerCase().includes(q) || t.scanRoot.toLowerCase().includes(q),
    )
  }, [targets, search])

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
              <span>
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
            placeholder="Search targets..."
            aria-label="Search targets"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="sidebar__list">
            <TargetList
              targets={shownTargets}
              selected={selected}
              onSelect={(name) => {
                setSelected(name)
                setDrawer(false)
              }}
            />
          </div>

          <div className="sidebar__foot">
            <span>duscan</span>
            <button
              type="button"
              className="icon-btn icon-btn--sm"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </aside>

        <main className="main" ref={mainRef}>
          <header className="pagehead glass">
            <div className="pagehead__top">
              <button
                type="button"
                className="icon-btn hamburger"
                onClick={() => setDrawer(true)}
                aria-label="Open menu"
              >
                ☰
              </button>
              <h1 className="pagehead__title">{active?.name ?? 'Disk Usage'}</h1>
              {active && (
                <>
                  <span className="pagehead__sep">·</span>
                  <span className="pagehead__path">{active.scanRoot || '—'}</span>
                </>
              )}

              <nav className="tabs" role="tablist" aria-label="Pages">
                {PAGES.map((p) => (
                  <button
                    type="button"
                    className="tab"
                    role="tab"
                    key={p.id}
                    aria-selected={page === p.id}
                    onClick={() => setPage(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="pagehead__sub">
              {active
                ? `Latest snapshot from ${formatTimestamp(active.scanTimestamp)}`
                : 'Waiting for data…'}
            </div>
          </header>

          {error ? (
            <div className="state state--error">
              <p className="state__title">Could not load this target</p>
              <p>{error}</p>
            </div>
          ) : loading ? (
            <>
              <div className="skeleton" style={{ height: '88px' }} />
              <div className="skeleton" style={{ height: '64px' }} />
              <div className="skeleton" style={{ height: '220px' }} />
            </>
          ) : !overview || !selected ? (
            <NoTargets health={health} />
          ) : page === 'overview' ? (
            // Charts lead; the ranked lists sit alongside so a name can be read
            // off exactly rather than guessed from a bar.
            <div className="split">
              <div className="stack">
                <OverviewTab overview={overview} />
              </div>
              <aside className="side glass">
                <UsageList
                  title="Teams"
                  rows={overview.teams}
                  emptyText="No team mapping configured."
                />
                <UsageList
                  title="Users"
                  rows={overview.users}
                  emptyText="No users mapped to a team."
                />
                <UsageList
                  title="Unmapped users"
                  rows={overview.otherUsers}
                  emptyText="Every user maps to a team."
                />
              </aside>
            </div>
          ) : (
            <>
              <nav className="subtabs" role="tablist" aria-label="Detail views">
                {LIVE_DETAIL_TABS.map((t) => (
                  <button
                    type="button"
                    className="subtab"
                    role="tab"
                    key={t.id}
                    aria-selected={detailTab === t.id}
                    onClick={() => setDetailTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
                {PLANNED_DETAIL_TABS.map((name) => (
                  <button
                    type="button"
                    className="subtab"
                    role="tab"
                    key={name}
                    aria-selected={false}
                    disabled
                    title="Not implemented yet"
                  >
                    {name}
                    <span className="tab__soon">soon</span>
                  </button>
                ))}
              </nav>
              <TreemapTab target={selected} totalSize={overview.target.totalSize} />
            </>
          )}
        </main>

        <ScrollTop targetRef={mainRef} />
      </div>
    </>
  )
}
