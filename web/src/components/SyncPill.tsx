// Report freshness indicator.
//
// The dashboard reads reports; it does not run scans. So this is not a "sync"
// button in the sense of triggering work — it reports whether the data on screen
// matches the report on disk, and refetches when it does not.
//
// Freshness is polled once at the App level via /api/statuses and handed down as
// a prop, so the pill does not run its own polling loop. Detection is by stamp
// comparison: the client only refetches its actual data when the stamp moves.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanStatus } from '../../../shared/api.js'
import { formatTimestamp } from '../lib/format.js'
import { isFailedStage, stageLabel } from '../lib/stage.js'
import { cn } from '@/lib/utils.js'
import { RotateCw, RefreshCw } from 'lucide-react'

interface Props {
  target: string
  /** Freshness of the active target, from the App-level statuses poll. */
  status: ScanStatus | null
  onStale: () => void
  refreshing: boolean
}

export function SyncPill({ target, status, onStale, refreshing }: Props): JSX.Element {
  const knownStamp = useRef<string | null>(null)
  const [stale, setStale] = useState(false)
  const wasRunningRef = useRef(false)

  useEffect(() => {
    knownStamp.current = null
    setStale(false)
    wasRunningRef.current = false
  }, [target])

  // React to the latest polled status. A stamp change means the report file was
  // replaced; a scan finishing while we saw it running means the data on screen
  // is now out of date, so trigger a reload.
  useEffect(() => {
    if (!status) return

    const nextStamp = status.stamp
    const stampMoved = knownStamp.current !== null && nextStamp !== knownStamp.current

    if (knownStamp.current === null) {
      knownStamp.current = nextStamp
    } else if (stampMoved) {
      setStale(true)
    }

    if (wasRunningRef.current && !status.running && stampMoved) {
      setStale(true)
      onStale()
    }
    wasRunningRef.current = status.running === true
  }, [status, onStale])

  const refresh = useCallback(() => {
    if (status) knownStamp.current = status.stamp
    setStale(false)
    onStale()
  }, [status, onStale])

  const running = status?.running === true
  const failed = isFailedStage(status?.stage)

  return (
    <div className="flex items-center gap-2 text-[13px]">
      {/* Dot */}
      <span
        className={cn(
          'inline-block size-1.5 rounded-full shrink-0',
          running ? 'bg-amber-400 animate-pulse' : failed ? 'bg-rose-500' : stale ? 'bg-amber-400' : 'bg-emerald-500',
        )}
      />

      {/* Text */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={cn(
            'font-medium truncate',
            running ? 'text-[var(--amber-400)]' : failed ? 'text-[var(--rose-400)]' : stale ? 'text-[var(--amber-400)]' : 'text-muted-foreground',
          )}
        >
          {running
            ? (stageLabel(status?.stage) ?? 'Working')
            : failed
              ? (status?.message ?? stageLabel(status?.stage) ?? 'Scan failed')
              : stale
                ? 'New report available'
                : 'Up to date'}
        </span>
        {running && <RotateCw className="size-3 animate-spin text-[var(--amber-400)]/70" />}
        <span className="text-muted-foreground/50 hidden sm:inline">
          {status?.scanTimestamp ? formatTimestamp(status.scanTimestamp) : '—'}
        </span>
      </div>

      {/* Action */}
      <button
        onClick={refresh}
        disabled={refreshing}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[12px] font-medium transition-colors',
          stale
            ? 'bg-amber-400/15 text-foreground hover:bg-amber-400/25'
            : 'text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.04]',
        )}
        title={stale ? 'New report available — click to reload' : 'Re-read report'}
      >
        <RefreshCw className={cn('size-3', refreshing && 'animate-spin')} />
        {refreshing ? '' : stale ? 'Reload' : ''}
      </button>
    </div>
  )
}
