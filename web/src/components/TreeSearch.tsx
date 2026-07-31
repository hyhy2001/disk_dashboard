import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit } from '../../../shared/api.js'
import { fetchSearch } from '../lib/api.js'
import { formatSize } from '../lib/format.js'

const MIN_CHARS = 2
const DEBOUNCE_MS = 220
const PAGE_SIZE = 10

interface Props {
  target: string
  onOpen: (id: number) => void
}

export function TreeSearch({ target, onOpen }: Props): JSX.Element {
  const [query, setQuery] = useState('')
  const [allHits, setAllHits] = useState<SearchHit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [showCount, setShowCount] = useState(PAGE_SIZE)
  const wrapRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    setQuery('')
    setAllHits([])
    setHasMore(false)
    setError(null)
  }, [target])

  // Debounced fresh search — single fetch, all results at once.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_CHARS) {
      setAllHits([])
      setHasMore(false)
      setError(null)
      setLoading(false)
      setShowCount(PAGE_SIZE)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      setAllHits([])
      setHasMore(false)
      setShowCount(PAGE_SIZE)
      fetchSearch(target, trimmed, undefined, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return
          setAllHits(res.hits)
          setHasMore(res.hasMore)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : String(err))
          setAllHits([])
          setHasMore(false)
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [target, query])

  // Reveal more items locally (no server fetch).
  const showMore = useCallback(() => {
    setShowCount((prev) => Math.min(prev + PAGE_SIZE, allHits.length))
  }, [allHits.length])

  // IntersectionObserver on the sentinel to reveal more items.
  useEffect(() => {
    const el = sentinelRef.current
    const popup = popupRef.current
    if (!el || !popup || showCount >= allHits.length) return

    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) showMore()
      },
      { root: popup, rootMargin: '80px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [showCount, allHits.length, showMore])

  // Track input position for the fixed dropdown.
  useEffect(() => {
    if (!open || !wrapRef.current) {
      setPopupPos(null)
      return
    }
    const inp = wrapRef.current.querySelector('input')
    if (!inp) return

    const update = () => {
      const r = inp.getBoundingClientRect()
      const gap = 8
      const maxW = window.innerWidth - r.left - gap
      const w = Math.min(Math.max(r.width, 320), maxW)
      setPopupPos({ top: r.bottom + 4, left: r.left, width: w })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, allHits, loading])

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

  const visible = allHits.slice(0, showCount)

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <input
        type="search"
        className="h-6 w-56 rounded-sm border border-border bg-background px-2 text-[11px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Find a file or folder…"
        aria-label="Search this disk"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && allHits.length > 0) {
            const first = allHits[0]
            if (first) pick(first)
          }
        }}
      />

      {open && query.trim().length >= MIN_CHARS && popupPos && (
        <div
          ref={popupRef}
          className="fixed z-50 glass rounded-sm shadow-md overflow-auto"
          style={{ top: popupPos.top, left: popupPos.left, width: popupPos.width, maxHeight: 320 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {error ? (
            <p className="text-[11px] text-muted-foreground p-3">{error}</p>
          ) : allHits.length === 0 && loading ? (
            <p className="text-[11px] text-muted-foreground p-3">Searching…</p>
          ) : allHits.length === 0 ? (
            <p className="text-[11px] text-muted-foreground p-3">No match for "{query.trim()}".</p>
          ) : (
            <ul className="divide-y divide-border/20">
              {visible.map((h) => (
                <li key={`${h.kind}-${h.id}-${h.path}`}>
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] hover:bg-muted transition-colors text-left"
                    onClick={() => pick(h)}
                  >
                    <span className="text-muted-foreground shrink-0" aria-hidden="true">
                      {h.kind === 'dir' ? '▣' : '▤'}
                    </span>
                    <span className="font-medium truncate">{h.name}</span>
                    <span className="text-muted-foreground truncate flex-1">{h.path}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0">{formatSize(h.size)}</span>
                  </button>
                </li>
              ))}
              {showCount < allHits.length && (
                <div
                  ref={sentinelRef}
                  className="flex items-center justify-center py-2 text-[10px] text-muted-foreground"
                >
                  Scroll for more
                </div>
              )}
              {hasMore && showCount >= allHits.length && (
                <p className="text-[10px] text-muted-foreground text-center py-2">
                  Narrow your search for more results
                </p>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
