// Pagination controls, in two flavours.
//
// Cursor lists (Detail User) can only step forward and back, because a keyset
// cursor has no notion of "page 7". Offset lists (Permission Issues) can jump, so
// they get numbered buttons. Keeping both here means one set of styles and one
// set of accessibility decisions.

interface StepProps {
  page: number
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  busy?: boolean
}

/** Prev / page / Next, for cursor-paginated lists. */
export function StepPager({ page, hasPrev, hasNext, onPrev, onNext, busy = false }: StepProps): JSX.Element | null {
  if (!hasPrev && !hasNext) return null

  return (
    <nav className="flex items-center justify-center gap-3 border-t border-border/30 py-2.5" aria-label="Pagination">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2.5 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-30"
        onClick={onPrev}
        disabled={!hasPrev || busy}
      >
        ← Prev
      </button>
      <span className="text-[13px] text-muted-foreground tabular-nums">Page {page}</span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-2.5 py-1 text-xs hover:bg-muted transition-colors disabled:opacity-30"
        onClick={onNext}
        disabled={!hasNext || busy}
      >
        Next →
      </button>
    </nav>
  )
}

interface NumberProps {
  /** 1-based current page. */
  page: number
  pageCount: number
  onGo: (page: number) => void
  busy?: boolean
}

/**
 * Which page numbers to render.
 *
 * Always the first, the last, and a window of `delta` either side of the current
 * page; gaps collapse to an ellipsis. Without the window a report with 400 pages
 * would render 400 buttons.
 */
export function pageWindow(page: number, pageCount: number, delta = 2): (number | '…')[] {
  if (pageCount <= 1) return [1]

  const wanted = new Set<number>([1, pageCount])
  for (let p = page - delta; p <= page + delta; p += 1) {
    if (p >= 1 && p <= pageCount) wanted.add(p)
  }

  const sorted = [...wanted].sort((a, b) => a - b)
  const out: (number | '…')[] = []
  let prev = 0
  for (const p of sorted) {
    // A gap of exactly one page is rendered as that page: an ellipsis hiding a
    // single number is worse than the number.
    if (prev > 0 && p - prev === 2) out.push(prev + 1)
    else if (prev > 0 && p - prev > 2) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

/** Numbered pagination, for offset-paginated lists. */
export function NumberPager({ page, pageCount, onGo, busy = false }: NumberProps): JSX.Element | null {
  if (pageCount <= 1) return null

  return (
    <nav className="flex items-center justify-center gap-1 border-t border-border py-2" aria-label="Pagination">
      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-sm text-xs hover:bg-muted transition-colors disabled:opacity-30"
        onClick={() => onGo(page - 1)}
        disabled={page <= 1 || busy}
        aria-label="Previous page"
      >
        ‹
      </button>

      {pageWindow(page, pageCount).map((p, i) =>
        p === '…' ? (
          <span
            className="inline-flex size-7 items-center justify-center text-xs text-muted-foreground"
            key={`gap${i}`}
            aria-hidden="true"
          >
            …
          </span>
        ) : (
          <button
            type="button"
            className={`inline-flex size-7 items-center justify-center rounded-sm text-xs hover:bg-muted transition-colors disabled:opacity-30 ${
              p === page ? 'bg-muted text-foreground' : 'text-muted-foreground'
            }`}
            key={p}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onGo(p)}
            disabled={busy}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        className="inline-flex size-7 items-center justify-center rounded-sm text-xs hover:bg-muted transition-colors disabled:opacity-30"
        onClick={() => onGo(page + 1)}
        disabled={page >= pageCount || busy}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  )
}
