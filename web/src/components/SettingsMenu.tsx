// Settings dropdown, plus the About panel it opens.
//
// Groups the app-level switches that are not navigation: theme, sidebar density, and
// a summary of what the backend found. The About panel doubles as diagnostics — when
// the target list is empty, "reports directory does not exist" is the answer, and
// putting it behind a menu beats a permanent banner.

import { useEffect, useRef, useState } from 'react'
import type { HealthInfo } from '../../../shared/api.js'
import { Modal } from './Modal.js'

interface Props {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  collapsed: boolean
  onToggleCollapsed: () => void
  health: HealthInfo | null
}

export function SettingsMenu({
  theme,
  onToggleTheme,
  collapsed,
  onToggleCollapsed,
  health,
}: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [about, setAbout] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
            className="inline-flex items-center justify-center size-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        data-tooltip="Settings"
      >
        ⚙
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-30 glass rounded-sm shadow-md py-1 min-w-[180px]" role="menu">
          <button
            type="button"
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
            role="menuitem"
            onClick={() => {
              onToggleTheme()
              setOpen(false)
            }}
          >
            <span className="w-4 text-center">{theme === 'dark' ? '☀' : '☾'}</span>
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>

          <button
            type="button"
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
            role="menuitem"
            onClick={() => {
              onToggleCollapsed()
              setOpen(false)
            }}
          >
            <span className="w-4 text-center">{collapsed ? '▶' : '◀'}</span>
            {collapsed ? 'Expand spaces' : 'Collapse spaces'}
          </button>

          <button
            type="button"
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left"
            role="menuitem"
            onClick={() => {
              setAbout(true)
              setOpen(false)
            }}
          >
            <span className="w-4 text-center">i</span>
            About this dashboard
          </button>
        </div>
      )}

      {about && (
        <Modal
          title="About"
          onClose={() => setAbout(false)}
          footer={<span>Press Esc to close</span>}
        >
          <p className="text-xs text-muted-foreground mb-4">
            Reads duscan <code className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">report.db</code> files directly. Nothing is written back — the
            dashboard cannot start a scan or modify a report.
          </p>

          {health ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Reports directory</dt>
              <dd>
                <code className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]">{health.reportsDir}</code>
                {!health.reportsDirExists && ' — does not exist'}
              </dd>

              <dt className="text-muted-foreground">Targets found</dt>
              <dd>{health.targetsFound}</dd>

              <dt className="text-muted-foreground">Space config</dt>
              <dd>
                {health.groupConfigLoaded
                  ? 'teams.json loaded'
                  : 'no teams.json — every target is in one space'}
              </dd>

              <dt className="text-muted-foreground">SQLite</dt>
              <dd>
                {health.sqliteVersion}
                {health.trigramAvailable && ' · trigram available'}
              </dd>
            </dl>
          ) : (
            <p className="empty">Backend status unavailable.</p>
          )}
        </Modal>
      )}
    </div>
  )
}
