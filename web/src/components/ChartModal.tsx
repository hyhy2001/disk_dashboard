// Fullscreen overlay for a single chart.
//
// The charts are SVG with a viewBox, so "expand" is just rendering the same
// component in a bigger box — no redraw or resize handling needed.
//
// Dialog behaviour done by hand rather than with <dialog>, which still has
// inconsistent styling support: Escape to close, click the backdrop to close,
// focus moved into the panel on open and restored on close, and background
// scroll locked while open.

import { useEffect, useRef } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function ChartModal({ title, onClose, children }: Props): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    panel.current?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreTo.current?.focus()
    }
  }, [onClose])

  return (
    <div
      className="modal"
      // Only a click that starts and ends on the backdrop closes; a drag that
      // ends outside a chart should not dismiss it.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}
