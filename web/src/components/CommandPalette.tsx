// Command palette (Ctrl/Cmd+K) — quick navigation across spaces, disks, and the
// active disk's views.
//
// Keyboard-first like a launcher: type to filter, ↑/↓ to move, Enter to run,
// Esc or a backdrop click to dismiss. The list is built from the same group
// data that drives the sidebar, so a disk that appears in the sidebar can be
// jumped to here.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { TargetGroup } from '../../../shared/api.js'
import { DETAIL_TABS, type DetailTab } from '../lib/route.js'
import { cn } from '../lib/utils.js'
import { useFocusTrap } from '../lib/useFocusTrap.js'
import { HardDrive, LayoutGrid, Monitor, Sun } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  groups: TargetGroup[]
  activeDisk: string | null
  activeDiskName: string | null
  onPickSpace: (name: string) => void
  onPickDisk: (slug: string) => void
  onGoTab: (tab: DetailTab) => void
  onToggleTheme: () => void
}

interface Command {
  id: string
  section: string
  label: string
  hint: string
  keywords: string
  icon: typeof Monitor
  run: () => void
}

const TAB_LABELS: Record<DetailTab, string> = {
  treemap: 'Treemap',
  history: 'History',
  'detail-user': 'Users',
  permissions: 'Perms',
  inodes: 'Inodes',
}

const MAX_SHOWN = 30

export function CommandPalette({
  open,
  onClose,
  groups,
  activeDisk,
  activeDiskName,
  onPickSpace,
  onPickDisk,
  onGoTab,
  onToggleTheme,
}: Props): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef)

  // Close and reset on toggle.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Focus on the next frame so the overlay is already mounted.
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = []
    for (const g of groups) {
      cmds.push({
        id: `space-${g.name}`,
        section: 'Spaces',
        label: g.name,
        hint: `${g.targets.length} disk${g.targets.length === 1 ? '' : 's'}`,
        keywords: g.name,
        icon: Monitor,
        run: () => onPickSpace(g.name),
      })
      for (const t of g.targets) {
        cmds.push({
          id: `disk-${t.slug}`,
          section: 'Disks',
          label: t.name,
          hint: 'Open overview',
          keywords: `${g.name} ${t.name}`,
          icon: HardDrive,
          run: () => onPickDisk(t.slug),
        })
      }
    }
    if (activeDisk) {
      for (const tab of DETAIL_TABS) {
        cmds.push({
          id: `tab-${activeDisk}-${tab}`,
          section: 'Views',
          label: `${activeDiskName ?? 'Disk'} — ${TAB_LABELS[tab]}`,
          hint: TAB_LABELS[tab],
          keywords: `${activeDiskName ?? ''} ${TAB_LABELS[tab]} ${tab}`,
          icon: LayoutGrid,
          run: () => onGoTab(tab),
        })
      }
    }
    cmds.push({
      id: 'theme',
      section: 'Actions',
      label: 'Toggle theme',
      hint: 'dark / light',
      keywords: 'theme dark light appearance',
      icon: Sun,
      run: onToggleTheme,
    })
    return cmds
  }, [groups, activeDisk, activeDiskName, onPickSpace, onPickDisk, onGoTab, onToggleTheme])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.keywords.toLowerCase().includes(q))
  }, [commands, query])

  const visible = filtered.slice(0, MAX_SHOWN)
  const sel = Math.min(selected, Math.max(0, visible.length - 1))

  // Keyboard handling for the palette itself.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelected((s) => Math.min(s + 1, Math.max(0, visible.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => Math.max(s - 1, 0))
      } else if (e.key === 'Enter') {
        const cmd = visible[sel]
        if (cmd) {
          e.preventDefault()
          cmd.run()
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, visible, sel])

  // Lock background scroll while open, like the other overlays.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!open) return null

  let lastSection = ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-2xl overflow-hidden animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={panelRef}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          placeholder="Search spaces, disks, views…"
          className="w-full h-11 px-4 text-sm bg-transparent outline-none placeholder:text-muted-foreground border-b border-border"
          aria-label="Command palette search"
        />
        <div className="max-h-[50vh] overflow-auto p-1.5">
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No match for “{query.trim()}”.</p>
          ) : (
            visible.map((c) => {
              const showSection = c.section !== lastSection
              lastSection = c.section
              const Icon = c.icon
              const isSel = visible[sel]?.id === c.id
              return (
                <div key={c.id}>
                  {showSection && (
                    <p className="px-3 pt-2 pb-1 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      {c.section}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      c.run()
                      onClose()
                    }}
                    onMouseEnter={() => setSelected(visible.findIndex((v) => v.id === c.id))}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-sm px-3 py-2 text-left text-sm transition-colors',
                      isSel ? 'bg-muted' : 'text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="flex-1 truncate font-medium text-foreground">{c.label}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground/60">{c.hint}</span>
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[12px] text-muted-foreground/70">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc dismiss</span>
        </div>
      </div>
    </div>
  )
}
