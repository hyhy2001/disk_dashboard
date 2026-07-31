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

export const DEFAULT_WIDTH = 260

/** Read the persisted width, clamped in case the stored value is stale. */
export function initialColumnWidth(): number {
  const saved = readNumber(KEYS.diskColumnWidth, DEFAULT_WIDTH)
  return Math.min(MAX, Math.max(MIN, saved))
}

/** Apply a width to the layout. Exported so boot can set it before first paint. */
export function applyColumnWidth(px: number): void {
  document.documentElement.style.setProperty('--col2-width', `${px}px`)
}

export function ColumnResizer(): JSX.Element {
  const dragging = useRef(false)
  const width = useRef(initialColumnWidth())

  useEffect(() => {
    applyColumnWidth(width.current)
  }, [])

  const onMove = useCallback((e: PointerEvent) => {
    if (!dragging.current) return
    // Measure from the column's own left edge so the handle tracks the pointer
    // exactly regardless of what is to the left of it.
    const left = document.querySelector('.diskcol')?.getBoundingClientRect().left ?? 0
    const next = Math.min(MAX, Math.max(MIN, e.clientX - left))
    width.current = next
    applyColumnWidth(next)
  }, [])

  const onUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    document.body.classList.remove('resizing')
    writeString(KEYS.diskColumnWidth, String(Math.round(width.current)))
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
  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (delta === 0) return
    e.preventDefault()
    const next = Math.min(MAX, Math.max(MIN, width.current + delta))
    width.current = next
    applyColumnWidth(next)
    writeString(KEYS.diskColumnWidth, String(next))
  }, [])

  return (
    <div
      className="absolute top-0 bottom-0 z-10 hidden lg:block w-1.5 cursor-col-resize hover:bg-accent/50 transition-colors"
      style={{ left: 'calc(var(--sidebar-width) + var(--col2-width) - 3px)' }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize disk column"
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={(e) => {
        dragging.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('resizing')
      }}
      onDoubleClick={() => {
        width.current = DEFAULT_WIDTH
        applyColumnWidth(DEFAULT_WIDTH)
        writeString(KEYS.diskColumnWidth, String(DEFAULT_WIDTH))
      }}
    />
  )
}
