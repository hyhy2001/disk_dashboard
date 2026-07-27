// App shell: top bar with tabs, then the three-column master-detail body that
// the legacy dashboard used (targets / teams+users / charts).
//
// Only the Overview tab exists so far. The remaining tabs are rendered disabled
// rather than hidden so the information architecture is visible from day one.

import { useCallback, useEffect, useState } from 'react'
import type { HealthInfo, Overview, Target } from '../../shared/api.js'
import { fetchHealth, fetchOverview, fetchTargets } from './lib/api.js'
import { NoTargets } from './components/NoTargets.js'
import { TargetList } from './components/TargetList.js'
import { UsageList } from './components/UsageList.js'
import { OverviewTab } from './tabs/OverviewTab.js'
import { TreemapTab } from './tabs/TreemapTab.js'

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__dot" />
          <span>Disk Usage</span>
          <span className="brand__sub">duscan</span>
        </div>

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

        <button
          type="button"
          className="icon-btn"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      <div className="body">
        <aside className="col col--targets">
          <TargetList targets={targets} selected={selected} onSelect={setSelected} />
        </aside>

        <aside className="col col--lists">
          {targets.length === 0 ? (
            <p className="empty">Nothing to list yet.</p>
          ) : overview ? (
            <>
              <UsageList title="Teams" rows={overview.teams} emptyText="No team mapping configured." />
              <UsageList title="Users" rows={overview.users} emptyText="No users mapped to a team." />
              <UsageList
                title="Unmapped users"
                rows={overview.otherUsers}
                emptyText="Every user maps to a team."
              />
            </>
          ) : (
            <div className="skeleton" style={{ height: '160px' }} />
          )}
        </aside>

        <main className="col col--detail">
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
            <OverviewTab overview={overview} />
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
      </div>
    </div>
  )
}
