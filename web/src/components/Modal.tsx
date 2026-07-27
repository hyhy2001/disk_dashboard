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
    <div className="modal" onClick={onClose}>
      <div
        className="modal__panel glass"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        // Without this a click anywhere inside would bubble to the backdrop and
        // close the dialog the user is using.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}
