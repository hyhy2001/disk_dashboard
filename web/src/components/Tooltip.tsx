// Global tooltip driven by `data-tooltip` attributes.
//
// One element handles every tooltip in the app, using delegated listeners on the
// document. The alternative — a wrapper component per tooltip — would mean every
// list row mounting an extra component, and rows are the densest thing on the page.
//
// Native `title` is not enough: it has a ~1s delay the browser owns, no styling,
// and it truncates. Paths are the main thing being tooltipped here, so being able
// to wrap and to place the box deliberately matters.
//
// Placement needs the box's own size, which is only known after it renders. So the
// flow is: hover records the target, the box renders offscreen-but-measurable, a
// layout effect measures it and sets the final position. Rendering it hidden for
// that one frame avoids the visible jump a naive single-pass version has.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Gap between the target and the box. */
const GAP = 9

/** Closest the box may come to a viewport edge. */
const MARGIN = 8

interface Position {
  left: number
  top: number
  /** Which side the box ended up on, for the CSS arrow. */
  side: 'top' | 'bottom'
}

interface Active {
  text: string
  /** Target rect, captured on hover: the element may scroll away afterwards. */
  rect: DOMRect
  /** Author's preferred side, from data-tooltip-pos. */
  prefersBottom: boolean
}

/**
 * Find the nearest ancestor carrying a tooltip, so a tooltip on a row still shows
 * when the pointer is over a child span.
 */
function tooltipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const el = node.closest('[data-tooltip]')
  return el instanceof HTMLElement ? el : null
}

export function Tooltip(): JSX.Element | null {
  const [active, setActive] = useState<Active | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  // Tracks whether a tooltip is open without triggering a render, so the
  // capture-phase scroll handler can bail cheaply on the constant scroll events.
  const openRef = useRef(false)

  const open = useCallback((el: HTMLElement): void => {
    const text = el.dataset.tooltip
    if (!text) return
    openRef.current = true
    setActive({
      text,
      rect: el.getBoundingClientRect(),
      prefersBottom: el.dataset.tooltipPos === 'bottom',
    })
    // Drop the previous position so the box cannot flash at the old spot while
    // the new one is being measured.
    setPos(null)
  }, [])

  useEffect(() => {
    const onEnter = (e: Event): void => {
      const el = tooltipTarget(e.target)
      if (el) open(el)
    }

    const clear = (): void => {
      if (!openRef.current) return
      openRef.current = false
      setActive(null)
      setPos(null)
    }

    const onLeave = (e: Event): void => {
      // Only clear when leaving the element that owns the tooltip; moving between
      // children of the same row must not flicker it.
      if (tooltipTarget(e.target)) clear()
    }

    document.addEventListener('mouseover', onEnter)
    document.addEventListener('mouseout', onLeave)
    document.addEventListener('focusin', onEnter)
    document.addEventListener('focusout', onLeave)
    // Capture, because the scrolling element is the main column rather than the
    // window and a bubbling listener would never see the event.
    document.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)

    return () => {
      document.removeEventListener('mouseover', onEnter)
      document.removeEventListener('mouseout', onLeave)
      document.removeEventListener('focusin', onEnter)
      document.removeEventListener('focusout', onLeave)
      document.removeEventListener('scroll', clear, true)
      window.removeEventListener('resize', clear)
    }
  }, [open])

  // Measure the rendered box, then place it. Runs before paint, so the hidden
  // first frame is never shown.
  useLayoutEffect(() => {
    if (!active || !boxRef.current) return

    const box = boxRef.current.getBoundingClientRect()
    const { rect, prefersBottom } = active

    // Flip when the preferred side has no room, so a tooltip on a top row does
    // not render off-screen.
    const fitsTop = rect.top - box.height - GAP >= MARGIN
    const fitsBottom = rect.bottom + box.height + GAP <= window.innerHeight - MARGIN
    const side: 'top' | 'bottom' = prefersBottom
      ? fitsBottom || !fitsTop
        ? 'bottom'
        : 'top'
      : fitsTop || !fitsBottom
        ? 'top'
        : 'bottom'

    const top = side === 'top' ? rect.top - box.height - GAP : rect.bottom + GAP
    const centred = rect.left + rect.width / 2 - box.width / 2
    const left = Math.max(MARGIN, Math.min(centred, window.innerWidth - box.width - MARGIN))

    setPos({ left, top, side })
  }, [active])

  if (!active) return null

  return (
    <div
      ref={boxRef}
      className={`tip tip--${pos?.side ?? 'top'}`}
      role="tooltip"
      style={
        pos
          ? { left: `${pos.left}px`, top: `${pos.top}px` }
          : // Measured but not yet placed: laid out at the origin and invisible, so
            // it has a real size without being seen in the wrong place.
            { left: '0px', top: '0px', visibility: 'hidden' }
      }
    >
      {active.text}
    </div>
  )
}
