// Back-to-top button, appearing once the main column has scrolled past a
// threshold. The main column scrolls, not the window, so this listens on that
// element rather than on window.

import { useEffect, useState } from 'react'

const SHOW_AFTER = 300

interface Props {
  /** The scrolling element to watch and to scroll back. */
  targetRef: React.RefObject<HTMLElement>
}

export function ScrollTop({ targetRef }: Props): JSX.Element | null {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const el = targetRef.current
    if (!el) return
    const onScroll = (): void => setShow(el.scrollTop > SHOW_AFTER)
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [targetRef])

  if (!show) return null

  return (
    <button
      type="button"
      className="fab glass"
      title="Back to the top"
      aria-label="Back to the top"
      onClick={() =>
        targetRef.current?.scrollTo({
          top: 0,
          // Honour the OS setting rather than always animating.
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        })
      }
    >
      ↑
    </button>
  )
}
