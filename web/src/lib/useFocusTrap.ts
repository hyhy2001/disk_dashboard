// Keeps Tab / Shift+Tab cycling inside an overlay, so focus cannot walk out of a
// modal into the page behind it.
//
// Usage: `const panel = useRef<HTMLDivElement>(null); useFocusTrap(panel)` on a
// container that is already focused (or about to be focused) when it opens.
//
// Tab order is cycled by hand rather than by nudging the browser: an overlay's
// focusables are few, and driving the cycle explicitly gives the same behaviour
// in every browser instead of depending on each one's default Tab handling.

import { useEffect } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(containerRef: { current: HTMLElement | null }): void {
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null
      const idx = active ? focusables.indexOf(active) : -1

      e.preventDefault()
      if (e.shiftKey) (idx <= 0 ? last : focusables[idx - 1]!).focus()
      else (idx < 0 || idx === focusables.length - 1 ? first : focusables[idx + 1]!).focus()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [containerRef])
}
