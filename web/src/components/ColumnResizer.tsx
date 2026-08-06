// Drag handle for the disk column's width.
//
// Pointer events rather than mouse events, so a trackpad, a touchscreen and a mouse
// all work through one code path. setPointerCapture is what makes a drag survive the
// pointer leaving the 6px handle — without it, moving faster than React re-renders
// drops the drag.
//
// The width is written to a CSS custom property on the root instead of to component
// state: the grid template reads it directly, so dragging does not re-render the
// whole app on every pointer move.

import { useCallback, useEffect, useRef } from 'react'
import { KEYS, readNumber, writeString } from '../lib/prefs.js'

/** Clamp range. Below the minimum the disk cards stop being readable. */
const MIN = 200
const MAX = 640

/**
 * Width the main panel must keep. The 640px ceiling is absolute, so on a 1024px
 * viewport a fully dragged column left the tables and charts beside it 128px —
 * narrower than a phone. The effective ceiling therefore also depends on what is
 * left after the sidebar, and the column re-clamps when the window shrinks.
 */
const MIN_MAIN = 360

/** Current sidebar width in px, read from the custom property the shell sets. */
function sidebarWidth(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')
  const px = Number.parseFloat(raw)
  return Number.isFinite(px) ? px : 256
}

/** The 640px ceiling, lowered when the viewport cannot spare it. */
export function maxColumnWidth(): number {
  return Math.max(MIN, Math.min(MAX, window.innerWidth - sidebarWidth() - MIN_MAIN))
}

export const DEFAULT_WIDTH = 260

/** The width the user last chose, unclamped — the preference, not the fit. */
export function preferredColumnWidth(): number {
  return Math.min(MAX, Math.max(MIN, readNumber(KEYS.diskColumnWidth, DEFAULT_WIDTH)))
}

/** Read the persisted width, clamped to what the current window can spare. */
export function initialColumnWidth(): number {
  return Math.min(maxColumnWidth(), Math.max(MIN, preferredColumnWidth()))
}

/** Apply a width to the layout. Exported so boot can set it before first paint. */
export function applyColumnWidth(px: number): void {
  document.documentElement.style.setProperty('--col2-width', `${px}px`)
}

export function ColumnResizer(): JSX.Element {
  const dragging = useRef(false)
  // What the user asked for, and what actually fits. They differ on a narrow
  // window: the applied width is re-clamped as the window resizes, while the
  // preference is kept intact so widening the window restores it.
  const desired = useRef(preferredColumnWidth())
  const width = useRef(initialColumnWidth())
  const elRef = useRef<HTMLDivElement>(null)

  // The width lives in a ref to avoid re-rendering on every pointer move, so the
  // aria attributes have to be pushed to the DOM by hand.
  const syncAria = useCallback((px: number) => {
    elRef.current?.setAttribute('aria-valuenow', String(Math.round(px)))
    elRef.current?.setAttribute('aria-valuemax', String(Math.round(maxColumnWidth())))
  }, [])

  useEffect(() => {
    applyColumnWidth(width.current)
    syncAria(width.current)
  }, [syncAria])

  // Re-clamp when the window (or the sidebar's collapsed state) changes the room
  // available, so a column dragged wide on a large monitor does not squeeze the
  // main panel to nothing after the window shrinks.
  useEffect(() => {
    const refit = (): void => {
      const next = Math.min(maxColumnWidth(), Math.max(MIN, desired.current))
      if (next === width.current) return
      width.current = next
      applyColumnWidth(next)
      syncAria(next)
    }
    window.addEventListener('resize', refit)
    const observer = new MutationObserver(refit)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
    return () => {
      window.removeEventListener('resize', refit)
      observer.disconnect()
    }
  }, [syncAria])

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      // Measure from the column's own left edge so the handle tracks the pointer
      // exactly regardless of what is to the left of it.
      const left = document.querySelector('.diskcol')?.getBoundingClientRect().left ?? 0
      const next = Math.min(maxColumnWidth(), Math.max(MIN, e.clientX - left))
      desired.current = next
      width.current = next
      applyColumnWidth(next)
      syncAria(next)
    },
    [syncAria],
  )

  const onUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.classList.remove('resizing')
    writeString(KEYS.diskColumnWidth, String(Math.round(desired.current)))
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onMove, onUp])

  /** Keyboard resizing, so the column is adjustable without a pointer. */
  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? 40 : 10
      const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      if (delta === 0) return
      e.preventDefault()
      const next = Math.min(maxColumnWidth(), Math.max(MIN, width.current + delta))
      desired.current = next
      width.current = next
      applyColumnWidth(next)
      syncAria(next)
      writeString(KEYS.diskColumnWidth, String(next))
    },
    [syncAria],
  )

  return (
    <div
      className="absolute top-0 bottom-0 z-10 hidden lg:block w-1.5 cursor-col-resize hover:bg-accent/50 transition-colors"
      style={{ left: 'calc(var(--sidebar-width) + var(--col2-width) - 3px)' }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize disk column"
      aria-valuenow={Math.round(width.current)}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onDoubleClick={() => {
        const next = Math.min(maxColumnWidth(), Math.max(MIN, DEFAULT_WIDTH))
        desired.current = DEFAULT_WIDTH
        width.current = next
        applyColumnWidth(next)
        syncAria(next)
        writeString(KEYS.diskColumnWidth, String(DEFAULT_WIDTH))
      }}
      ref={elRef}
    />
  )
}
