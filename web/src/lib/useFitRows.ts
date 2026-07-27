// How many list rows fit in the space actually available.
//
// The list tabs used fixed page sizes copied from legacy — 500 rows for Detail User,
// 100 for Permission Issues. Legacy could afford that because its whole page
// scrolled; this dashboard holds one screen, so 500 rows of 25px overflowed the main
// column by 12,000px and buried the pager where nobody could reach it.
//
// A fixed smaller number would not work either: the right count is 18 rows on a
// 700px laptop and 40 on a 1080p monitor, and picking one value means either wasting
// half a big screen or still overflowing a small one.
//
// So it is measured — but *not* by measuring the list's own container. That is a
// feedback loop: the container's height depends on how many rows are in it, so a
// measurement of 6 rows shrinks the box, which measures 3 rows, and the page size
// oscillates. The first version of this hook did exactly that and requested a
// 21-row page followed immediately by a 6-row one.
//
// Instead the anchor is the scroll container (`.main`), whose height is fixed at
// 100vh by the layout and cannot be influenced by its contents. Rows fit = that
// height, minus everything above the list, minus the list's own chrome.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface FitRows {
  /**
   * Attach to the element the list occupies. Used to locate its top edge.
   *
   * A callback ref, not an object ref, and that matters: these tabs render an empty
   * state before their data arrives, so the measured element does not exist on the
   * first render. A `useEffect` keyed on anything stable would run once against a
   * null ref and never again, leaving `measured` false forever — which is exactly
   * how the Detail User tab got stuck on its skeleton. A callback ref fires when
   * the node actually appears.
   */
  ref: (node: HTMLDivElement | null) => void
  /** Rows that fit, clamped to [min, max]. */
  rows: number
  /** False until the first measurement, so callers can avoid a double fetch. */
  measured: boolean
}

export interface FitOptions {
  /** Height of one row in px, including its gap or border. */
  rowHeight: number
  /** Never ask for fewer than this, however short the viewport. */
  min?: number
  /** Never ask for more than this, however tall. */
  max?: number
  /** Chrome below the list that must stay on screen: a pager, a footer note. */
  reserve?: number
}

/** The scrolling column every page sits in. Its height is the viewport, not content. */
const SCROLL_HOST = '.main'

export function useFitRows(opts: FitOptions): FitRows {
  const { rowHeight, min = 8, max = 200, reserve = 0 } = opts
  const node = useRef<HTMLDivElement | null>(null)
  const observer = useRef<ResizeObserver | null>(null)
  const [rows, setRows] = useState(min)
  const [measured, setMeasured] = useState(false)

  // Read through refs so `measure` stays stable and the callback ref does not
  // detach and re-attach the observer on every render.
  const geom = useRef({ rowHeight, min, max, reserve })
  geom.current = { rowHeight, min, max, reserve }

  const measure = useCallback((): void => {
    const el = node.current
    const host = el?.closest(SCROLL_HOST)
    if (!el || !host) return

    const { rowHeight: h, min: lo, max: hi, reserve: pad } = geom.current
    // Distance from the top of the list to the bottom of the scroll host. Taken
    // from the element's *position*, not its height, so a tall list cannot inflate
    // it and a collapsed one cannot shrink it — that feedback loop made an earlier
    // version request a 21-row page and then a 6-row one.
    const available = host.getBoundingClientRect().bottom - el.getBoundingClientRect().top - pad

    const next = Math.max(lo, Math.min(hi, Math.floor(available / h)))
    // Only react to a real change: a scrollbar appearing shifts things by a pixel
    // or two, and refetching a page for that would be absurd.
    setRows((prev) => (prev === next ? prev : next))
    setMeasured(true)
  }, [])

  const ref = useCallback(
    (el: HTMLDivElement | null): void => {
      observer.current?.disconnect()
      observer.current = null
      node.current = el
      if (!el) return

      const host = el.closest(SCROLL_HOST)
      if (host) {
        // Watch the host, whose height is the viewport rather than its content.
        observer.current = new ResizeObserver(() => measure())
        observer.current.observe(host)
      }
      measure()
    },
    [measure],
  )

  // Re-measure when the geometry inputs change, e.g. a tab switching row height.
  useEffect(() => {
    measure()
  }, [measure, rowHeight, min, max, reserve])

  useEffect(() => () => observer.current?.disconnect(), [])

  return { ref, rows, measured }
}
