// Measure an element's rendered box.
//
// Charts use this to set their viewBox to the real pixel size of the space they
// occupy. Without it, a viewBox of fixed width gets scaled by the browser to fit,
// which also scales the text: the same `fontSize={12}` then renders at ~18px in a
// wide panel and ~10px in a narrow one. Declaring the viewBox in real pixels means
// the scale factor is always 1, so 12px is 12px in every chart.

import { useEffect, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/**
 * Returns a ref to attach to the measured element and its current size. Size is
 * `null` until the first measurement, so callers should render nothing (or a
 * placeholder) on the first pass rather than guessing a default and reflowing.
 */
export function useSize<T extends HTMLElement>(): [React.RefObject<T>, Size | null] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      // Ignore sub-pixel jitter, which would otherwise re-render on every
      // scrollbar appearance or font swap.
      setSize((prev) =>
        prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
