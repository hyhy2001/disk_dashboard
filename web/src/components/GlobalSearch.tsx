// Search a report by directory or file name.
//
// Placed in the page header rather than inside the TreeMap tab, because the thing a
// viewer usually wants is "where is X on this disk", which is a question about the
// disk, not about the tab they happen to be on. Picking a hit navigates the treemap
// to the containing directory.
//
// Queries are debounced and the in-flight request is aborted when the query moves
// on, so typing does not queue a request per character.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../../../shared/api.js'
import { fetchSearch } from '../lib/api.js'
import { formatSize } from '../lib/format.js'

/** Shortest query the server accepts. */
const MIN_CHARS = 2

const DEBOUNCE_MS = 220

interface Props {
  target: string
  /** Open a directory in the treemap. */
  onOpen: (id: number) => void
}

export function GlobalSearch({ target, onOpen }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // A new target invalidates every id in the result list.
  useEffect(() => {
    setQuery('')
    setHits(null)
  }, [target])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_CHARS) {
      setHits(null)
      setError(null)
      setBusy(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setError(null)
      fetchSearch(target, trimmed, undefined, controller.signal)
        .then((res) => {
          setHits(res.hits)
          setBusy(false)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : String(err))
          setHits(null)
          setBusy(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [target, query])

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

  const pick = useCallback(
    (hit: SearchHit) => {
      onOpen(hit.id)
      setOpen(false)
    },
    [onOpen],
  )

  return (
    <div className="gsearch" ref={wrapRef}>
      <input
        type="search"
        className="gsearch__field"
        placeholder="Find a file or folder…"
        aria-label="Search this disk"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          // Enter takes the top hit, which is the largest match — the one someone
          // hunting for space almost always wants.
          if (e.key === 'Enter' && hits && hits.length > 0) {
            const first = hits[0]
            if (first) pick(first)
          }
        }}
      />

      {open && query.trim().length >= MIN_CHARS && (
        <div className="gsearch__panel glass">
          {error ? (
            <p className="gsearch__msg">{error}</p>
          ) : busy && hits === null ? (
            <p className="gsearch__msg">Searching…</p>
          ) : hits === null || hits.length === 0 ? (
            <p className="gsearch__msg">No match for “{query.trim()}”.</p>
          ) : (
            <ul className="gsearch__list">
              {hits.map((h) => (
                <li key={`${h.kind}-${h.id}-${h.path}`}>
                  <button type="button" className="gsearch__hit" onClick={() => pick(h)}>
                    <span
                      className={`gsearch__kind gsearch__kind--${h.kind}`}
                      aria-hidden="true"
                    >
                      {h.kind === 'dir' ? '▣' : '▤'}
                    </span>
                    <span className="gsearch__name">{h.name}</span>
                    <span className="gsearch__path">{h.path}</span>
                    <span className="gsearch__size">{formatSize(h.size)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
