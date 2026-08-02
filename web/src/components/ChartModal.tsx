// Fullscreen overlay for a single chart.
//
// The charts are SVG with a viewBox, so "expand" is just rendering the same
// component in a bigger box — no redraw or resize handling needed.
//
// Dialog behaviour done by hand rather than with <dialog>, which still has
// inconsistent styling support: Escape to close, click the backdrop to close,
// focus moved into the panel on open and restored on close, and background
// scroll locked while open.

import { useEffect, useRef, useState } from 'react'
import { downloadSvgAsPng } from '../lib/exportPng.js'

interface Props {
  title: string
  /** Slug used in the downloaded file name. */
  slug: string
  onClose: () => void
  children: React.ReactNode
}

export function ChartModal({ title, slug, onClose, children }: Props): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

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

  const savePng = (): void => {
    const svg = body.current?.querySelector('svg')
    if (!svg) {
      setSaveError('nothing to save')
      return
    }
    setSaveError(null)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')
    downloadSvgAsPng(svg as SVGSVGElement, `chart-${slug}-${stamp}.png`).catch((err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'could not save PNG')
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex flex-col w-[min(95vw,68rem)] h-[min(92vh,52rem)] bg-card border border-border rounded-lg shadow-2xl overflow-hidden animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
      >
        <header className="flex items-center justify-between gap-2 shrink-0 border-b border-border bg-surface/80 px-4 py-2.5">
          <h2 className="text-sm font-semibold truncate min-w-0">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              className="inline-flex items-center rounded-sm border border-border bg-transparent px-2 py-1 text-[12px] hover:bg-muted transition-colors"
              onClick={savePng}
            >
              Save PNG
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center size-7 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-auto" ref={body}>
          {children}
        </div>

        <div className="shrink-0 border-t border-border/40 px-4 py-1.5 text-[12px] text-muted-foreground">
          {saveError ? (
            <span className="text-destructive">{saveError}</span>
          ) : (
            <span>Press Esc to close · Hover for details</span>
          )}
        </div>
      </div>
    </div>
  )
}
