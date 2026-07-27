// Toast notifications.
//
// A plain observable store rather than React context, because toasts are fired
// from places that are not components: an export helper, a fetch error handler, a
// clipboard callback. Those would otherwise all need a hook threaded through them.
//
// Progress toasts are the same objects with a `progress` field. They do not
// auto-dismiss — the caller closes them when the work finishes — because a
// progress bar that vanishes mid-export reads as a crash.

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  message?: string
  /** 0..1 for a progress toast; absent for a normal one. */
  progress?: number
  /** Label beside the bar, e.g. "12,000 rows". */
  progressLabel?: string
}

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
const listeners = new Set<Listener>()
let seq = 0

/** Default lifetime. Long enough to read two lines, short enough not to nag. */
const DEFAULT_MS = 3600

function emit(): void {
  // Hand out a copy so a listener storing it in state sees a new reference.
  const snapshot = [...toasts]
  for (const fn of listeners) fn(snapshot)
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  fn([...toasts])
  return () => {
    listeners.delete(fn)
  }
}

export function dismiss(id: string): void {
  const next = toasts.filter((t) => t.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

/**
 * Show a toast. Returns its id so a caller can dismiss it early.
 *
 * `durationMs` of 0 means "stay until dismissed", which is what the progress
 * variant uses.
 */
export function toast(
  kind: ToastKind,
  title: string,
  message?: string,
  durationMs = DEFAULT_MS,
): string {
  seq += 1
  const id = `t${seq}`
  toasts = [...toasts, { id, kind, title, ...(message !== undefined ? { message } : {}) }]
  emit()

  if (durationMs > 0) {
    setTimeout(() => dismiss(id), durationMs)
  }
  return id
}

export const success = (title: string, message?: string): string =>
  toast('success', title, message)
export const failure = (title: string, message?: string): string => toast('error', title, message)
export const warn = (title: string, message?: string): string => toast('warning', title, message)
export const info = (title: string, message?: string): string => toast('info', title, message)

/** Open a progress toast that stays until closed. */
export function startProgress(title: string, message?: string): string {
  seq += 1
  const id = `p${seq}`
  toasts = [
    ...toasts,
    {
      id,
      kind: 'info',
      title,
      ...(message !== undefined ? { message } : {}),
      progress: 0,
    },
  ]
  emit()
  return id
}

/**
 * Update a progress toast. A no-op if the toast was already dismissed, so a
 * long-running job does not have to check whether the user closed it.
 */
export function updateProgress(id: string, progress: number, label?: string): void {
  let changed = false
  toasts = toasts.map((t) => {
    if (t.id !== id) return t
    changed = true
    return {
      ...t,
      progress: Math.max(0, Math.min(1, progress)),
      ...(label !== undefined ? { progressLabel: label } : {}),
    }
  })
  if (changed) emit()
}

/**
 * Close a progress toast. Same as dismiss, named for the caller's intent — a
 * progress toast is closed by whoever opened it, not by a timeout.
 */
export function closeProgress(id: string): void {
  dismiss(id)
}

/** Reset the store. Tests only — it would leak state between cases otherwise. */
export function resetToasts(): void {
  toasts = []
  seq = 0
  emit()
}
