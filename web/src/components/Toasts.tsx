// Renders the toast store.
//
// Mounted once at the app root. The container is aria-live so a screen reader
// announces a toast without the focus moving, which matters because toasts report
// the outcome of an action the user has already moved on from.

import { useEffect, useState } from 'react'
import type { Toast, ToastKind } from '../lib/toast.js'
import { dismiss, subscribe } from '../lib/toast.js'

/** One glyph per kind. Text rather than icons keeps the bundle free of an icon set. */
const GLYPH: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
}

export function Toasts(): JSX.Element {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => subscribe(setItems), [])

  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className={`toast__icon toast__icon--${t.kind}`} aria-hidden="true">
            {GLYPH[t.kind]}
          </span>

          <div className="toast__body">
            <p className="toast__title">{t.title}</p>
            {t.message && <p className="toast__msg">{t.message}</p>}

            {t.progress !== undefined && (
              <div className="toast__progress">
                <div className="toast__bar">
                  <div className="toast__fill" style={{ width: `${t.progress * 100}%` }} />
                </div>
                {t.progressLabel && <span className="toast__pct">{t.progressLabel}</span>}
              </div>
            )}
          </div>

          {/* A progress toast can be long-lived, so it always needs a way out. */}
          <button
            type="button"
            className="toast__close"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
