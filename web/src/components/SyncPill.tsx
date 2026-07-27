// Report freshness indicator.
//
// The dashboard reads reports; it does not run scans. So this is not a "sync"
// button in the sense of triggering work — it reports whether the data on screen
// matches the report on disk, and refetches when it does not.
//
// That distinction is deliberate and visible in the labels: "Up to date", not
// "Synced". Claiming to have synced something would imply the dashboard controls
// when scans happen, and it does not.
//
// Polling is by stamp comparison: the endpoint is a stat() plus a small read, so a
// short interval is cheap, and the client only refetches its actual data when the
// stamp moves.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanStatus } from '../../../shared/api.js'
import { fetchStatus } from '../lib/api.js'
import { formatTimestamp } from '../lib/format.js'

/** Poll interval. Matches legacy's 3s while a scan is running. */
const POLL_MS = 3000

/**
 * Stage labels, from duscan's scan_status.json.
 *
 * An unknown stage falls back to a generic label rather than showing the raw
 * value: duscan may add stages, and a viewer should see "Working" rather than an
 * internal identifier.
 */
const STAGE_LABEL: Record<string, string> = {
  scan: 'Scanning files',
  report: 'Building report',
  detail: 'Building user detail',
  treemap: 'Building treemap',
  sync: 'Writing report',
  done: 'Completed',
  error: 'Scan failed',
}

interface Props {
  target: string
  /** Called when the report on disk has changed, so the caller can refetch. */
  onStale: () => void
  /** Whether a data refetch is currently running. */
  refreshing: boolean
}

export function SyncPill({ target, onStale, refreshing }: Props): JSX.Element {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Stamp the currently displayed data was loaded at. */
  const knownStamp = useRef<string | null>(null)
  const [stale, setStale] = useState(false)

  // A target switch means the previous stamp describes a different file.
  useEffect(() => {
    knownStamp.current = null
    setStale(false)
    setStatus(null)
  }, [target])

  const poll = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const next = await fetchStatus(target, signal)
        setStatus(next)
        setError(null)

        if (knownStamp.current === null) {
          // First observation: adopt it as the baseline rather than declaring the
          // freshly loaded data stale.
          knownStamp.current = next.stamp
        } else if (next.stamp !== knownStamp.current) {
          setStale(true)
        }
      } catch (err) {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [target],
  )

  useEffect(() => {
    const controller = new AbortController()
    void poll(controller.signal)

    const id = setInterval(() => {
      // Polling a hidden tab wastes requests on data nobody is looking at; the
      // visibility handler below catches up on return.
      if (!document.hidden) void poll(controller.signal)
    }, POLL_MS)

    const onVisible = (): void => {
      if (!document.hidden) void poll(controller.signal)
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(id)
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [poll])

  const refresh = useCallback(() => {
    // Adopt the observed stamp now: the refetch that follows will read this file.
    if (status) knownStamp.current = status.stamp
    setStale(false)
    onStale()
  }, [status, onStale])

  const running = status?.running === true
  const failed = status?.stage === 'error'

  const state = error
    ? 'error'
    : running
      ? 'scanning'
      : failed
        ? 'error'
        : stale
          ? 'stale'
          : 'idle'

  const label = error
    ? 'Status unavailable'
    : running
      ? (status?.stage ? STAGE_LABEL[status.stage] : undefined) ?? 'Working'
      : failed
        ? status?.message ?? 'Scan failed'
        : stale
          ? 'New report available'
          : 'Up to date'

  return (
    <div className={`sync sync--${state}`}>
      <span className={`sync__dot sync__dot--${state}`} aria-hidden="true" />

      <div className="sync__text">
        <span className="sync__label">{label}</span>
        <span className="sync__time">
          {status?.scanTimestamp ? `Scanned ${formatTimestamp(status.scanTimestamp)}` : '—'}
        </span>
      </div>

      <button
        type="button"
        className={`btn btn--sm${stale ? ' btn--primary' : ''}`}
        onClick={refresh}
        disabled={refreshing}
        data-tooltip={
          stale
            ? 'The report on disk changed — load the new data'
            : 'Re-read the report from disk'
        }
      >
        {refreshing ? 'Loading…' : stale ? 'Reload' : 'Refresh'}
      </button>
    </div>
  )
}
