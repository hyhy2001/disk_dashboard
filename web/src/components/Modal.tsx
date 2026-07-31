// Modal shell: backdrop, Escape, focus handling.
//
// Every overlay in the app goes through this so the dismissal rules are identical.
// Three of them matter and are easy to get wrong individually: Escape closes,
// clicking the backdrop closes but clicking the panel does not, and focus moves into
// the dialog on open and back to the trigger on close.

import { useEffect, useRef } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: React.ReactNode
  /** Optional footer hint, e.g. a keyboard reminder. */
  footer?: React.ReactNode
}

export function Modal({ title, onClose, children, footer }: Props): JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnTo = useRef<Element | null>(null)

  useEffect(() => {
    returnTo.current = document.activeElement
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    // The page behind must not scroll while a modal is open, or the backdrop
    // detaches from the content it is covering.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      // Returning focus is what makes Escape feel like "back" rather than "lost".
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus()
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="glass rounded-lg shadow-md w-[500px] max-w-[90vw] max-h-[85vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold flex-1">{title}</h2>
          <button
            type="button"
            className="inline-flex items-center justify-center size-6 rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-auto p-4">{children}</div>

        {footer && (
          <footer className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground">{footer}</footer>
        )}
      </div>
    </div>
  )
}
