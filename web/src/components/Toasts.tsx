import { useEffect, useState } from 'react'
import type { Toast, ToastKind } from '../lib/toast.js'
import { dismiss, subscribe } from '../lib/toast.js'

const GLYPH: Record<ToastKind, string> = { success: '✓', error: '✕', warning: '!', info: 'i' }

const COLORS: Record<ToastKind, string> = {
  success: 'border-l-emerald-500 bg-emerald-500/8',
  error: 'border-l-destructive bg-destructive/8',
  warning: 'border-l-amber-400 bg-amber-400/8',
  info: 'border-l-sky-400 bg-sky-400/8',
}
const ICON_COLORS: Record<ToastKind, string> = {
  success: 'text-emerald-500',
  error: 'text-destructive',
  warning: 'text-amber-400',
  info: 'text-sky-400',
}

export function Toasts(): JSX.Element {
  const [items, setItems] = useState<Toast[]>([])

  useEffect(() => subscribe(setItems), [])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] mx-auto flex max-w-[420px] flex-col gap-2 px-4" aria-live="polite" aria-atomic="false">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 rounded-sm border border-border bg-card px-4 py-3 shadow-md animate-slide-up ${COLORS[t.kind]} border-l-4`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <span className={`text-sm font-bold ${ICON_COLORS[t.kind]}`} aria-hidden="true">{GLYPH[t.kind]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">{t.title}</p>
            {t.message && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{t.message}</p>}
            {t.progress !== undefined && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${t.progress * 100}%` }} />
                </div>
                {t.progressLabel && <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{t.progressLabel}</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-[10px] text-muted-foreground hover:bg-muted transition-colors"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
