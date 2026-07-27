// The five-figure capacity strip: Total / Used / Scanned / Free / Usage.
//
// "Used" is what the filesystem reports; "Scanned" is what duscan actually
// walked. The two differ whenever the scanner could not descend somewhere, and
// that gap is the point of showing both — it is usage nobody can attribute to a
// user. Legacy showed the same five figures, so the labels match exactly.
//
// Values are in decimal TB (÷1e12), matching legacy's bytesToTB so the two
// dashboards report the same number for the same disk. Everywhere else in this
// app uses binary units via formatSize; this strip is the deliberate exception.

import { useEffect, useRef, useState } from 'react'
import type { Capacity } from '../../../shared/api.js'

/** Usage above this turns the percentage red. */
const HOT_PERCENT = 80

const COUNT_MS = 1200

/** Decimal terabytes, as legacy computed them. */
function toTB(bytes: number): number {
  return bytes / 1e12
}

/**
 * Count up to `value` on mount and on change. Respects prefers-reduced-motion by
 * snapping straight to the final number.
 */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const raf = useRef<number>()

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      from.current = value
      setShown(value)
      return
    }

    const start = performance.now()
    const origin = from.current
    const delta = value - origin

    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / COUNT_MS)
      // Ease-out cubic: fast at first, settles gently on the final figure.
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(origin + delta * eased)
      if (t < 1) {
        raf.current = requestAnimationFrame(step)
      } else {
        from.current = value
      }
    }
    raf.current = requestAnimationFrame(step)

    return () => {
      if (raf.current !== undefined) cancelAnimationFrame(raf.current)
      // Land on the target so an interrupted run does not leave a stale figure.
      from.current = value
    }
  }, [value])

  return shown
}

function Stat({
  value,
  unit,
  label,
  tone,
  title,
}: {
  value: number
  unit: string
  label: string
  tone?: 'used' | 'scanned' | 'hot'
  title?: string
}): JSX.Element {
  const shown = useCountUp(value)
  return (
    <div className="statbar__item" title={title}>
      <div className="statbar__figure">
        <span className={`statbar__num${tone ? ` statbar__num--${tone}` : ''}`}>
          {shown.toFixed(2)}
        </span>
        <span className="statbar__unit">{unit}</span>
      </div>
      <div className="statbar__label">{label}</div>
    </div>
  )
}

interface Props {
  capacity: Capacity
}

export function StatBar({ capacity }: Props): JSX.Element {
  const { total, used, available, scanned } = capacity
  const usagePct = total > 0 ? (used / total) * 100 : 0
  const unscanned = Math.max(0, used - scanned)

  return (
    <div className="statbar">
      <Stat value={toTB(total)} unit="TB" label="Total" />
      <span className="statbar__div" />
      <Stat value={toTB(used)} unit="TB" label="Used" tone="used" />
      <span className="statbar__div" />
      <Stat
        value={toTB(scanned)}
        unit="TB"
        label="Scanned"
        tone="scanned"
        title={
          unscanned > 0
            ? `${toTB(unscanned).toFixed(2)} TB of used space was not walked by the scan`
            : 'The scan walked all used space'
        }
      />
      <span className="statbar__div" />
      <Stat value={toTB(available)} unit="TB" label="Free" />
      <span className="statbar__div" />
      <Stat
        value={usagePct}
        unit="%"
        label="Usage"
        tone={usagePct > HOT_PERCENT ? 'hot' : undefined}
      />
    </div>
  )
}
