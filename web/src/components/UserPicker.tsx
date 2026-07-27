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
  const wrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
    <div className="picker" ref={wrapRef}>
      <button
        type="button"
        className="picker__btn"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="picker__value">{selected ?? 'Select user…'}</span>
        <span className="picker__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="picker__panel glass">
          <input
            ref={searchRef}
            type="search"
            className="picker__search"
            placeholder="Search user..."
            aria-label="Search users"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <ul
            className="picker__list"
            role="listbox"
            aria-label="Users"
            onScroll={(e) => {
              const el = e.currentTarget
              // Extend the window shortly before the bottom, so the list does not
              // visibly stall at the edge.
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
                setShown((n) => (n < filtered.length ? n + WINDOW : n))
              }
            }}
          >
            {visible.length === 0 && <li className="picker__empty">No user matches.</li>}

            {visible.map((u) => (
              <li key={u.name}>
                <button
                  type="button"
                  className="picker__opt"
                  role="option"
                  aria-selected={u.name === selected}
                  onClick={() => {
                    onSelect(u.name)
                    setOpen(false)
                  }}
                >
                  <span className="picker__name">{u.name}</span>
                  <span className="picker__meta">
                    {formatSize(u.used)} · {formatCount(u.files)} files
                    {/* Flagged rather than hidden: the account is real and its
                        total is meaningful even with no per-file breakdown. */}
                    {!u.hasDetail && ' · no breakdown'}
                  </span>
                </button>
              </li>
            ))}

            {shown < filtered.length && (
              <li className="picker__more">
                Showing {formatCount(shown)} of {formatCount(filtered.length)} — scroll for more
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
