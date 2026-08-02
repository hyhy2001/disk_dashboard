// Searchable user dropdown.
//
// A report can carry thousands of accounts, so the list is filtered and windowed
// rather than rendered whole: a 5000-option dropdown is both slow to mount and
// impossible to use. The window grows as you scroll, which is cheaper than
// virtualising and good enough at this scale.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetailUser } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'

/**
 * Options rendered at once, extended by scrolling. Legacy's DROPDOWN_PAGE was 30;
 * this matches, so the initial list is the same depth.
 */
const WINDOW = 30

interface Props {
  users: DetailUser[]
  selected: string | null
  onSelect: (name: string) => void
}

export function UserPicker({ users, selected, onSelect }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(WINDOW)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Measure the button so the dropdown can be fixed-positioned and clamped to the
  // viewport — a left-anchored absolute box overflows on narrow windows.
  useEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const btn = wrapRef.current?.querySelector('button')
    if (!btn) return
    const update = () => {
      const r = btn.getBoundingClientRect()
      const gap = 8
      const maxW = window.innerWidth - r.left - gap
      const width = Math.min(300, Math.max(200, maxW))
      setPos({ left: r.left, top: r.bottom + 4, width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  // Close on an outside click or Escape. Both are needed: the dropdown covers
  // content, so being unable to dismiss it traps the view.
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

  // Focus the search on open so typing works immediately.
  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.name.toLowerCase().includes(q))
  }, [users, query])

  // A narrowed list must start from the top, or the window left over from a
  // previous query would show a suspiciously long list.
  useEffect(() => {
    setShown(WINDOW)
  }, [query])

  const visible = filtered.slice(0, shown)

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2.5 py-1.5 text-xs hover:bg-muted transition-colors min-w-[100px]"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex-1 truncate">{selected ?? 'Select user…'}</span>
        <span className="text-muted-foreground text-[12px]" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && pos && (
        <div
          className="fixed z-30 glass rounded-sm shadow-md max-h-80 flex flex-col"
          style={{ left: pos.left, top: pos.top, width: pos.width }}
        >
          <input
            ref={searchRef}
            type="search"
            className="h-7 rounded-sm border border-border bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring mx-2 mt-2"
            placeholder="Search user..."
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <ul
            className="flex-1 overflow-auto divide-y divide-border/20 mt-1"
            role="listbox"
            aria-label="Users"
            onScroll={(e) => {
              const el = e.currentTarget
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                setShown((n) => (n < filtered.length ? n + WINDOW : n))
              }
            }}
          >
            {visible.length === 0 && (
              <li className="text-[13px] text-muted-foreground p-3 text-center">No user matches.</li>
            )}

            {visible.map((u) => (
              <li key={u.name}>
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-[13px] hover:bg-muted transition-colors text-left aria-selected:bg-accent"
                  role="option"
                  aria-selected={u.name === selected}
                  onClick={() => {
                    onSelect(u.name)
                    setOpen(false)
                  }}
                >
                  <span className="flex-1 font-medium truncate">{u.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {formatSize(u.used)}
                    <span className="hidden min-[440px]:inline">
                      {' '}· {formatCount(u.files)} files
                      {!u.hasDetail && ' · no breakdown'}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {shown < filtered.length && (
              <li className="text-[12px] text-muted-foreground p-2 text-center">
                Showing {formatCount(shown)} of {formatCount(filtered.length)} — scroll for more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
