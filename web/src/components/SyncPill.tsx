// Report freshness indicator.
//
// The dashboard reads reports; it does not run scans. So this is not a "sync"
// button in the sense of triggering work — it reports whether the data on screen
// matches the report on disk, and refetches when it does not.
//
// Polling is by stamp comparison: the endpoint is a stat() plus a small read, so a
// short interval is cheap, and the client only refetches its actual data when the
// stamp moves.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanStatus } from '../../../shared/api.js'
import { fetchStatus } from '../lib/api.js'
import { formatTimestamp } from '../lib/format.js'
import { cn } from '@/lib/utils.js'
import { RotateCw, RefreshCw } from 'lucide-react'

/** Poll interval. Matches legacy's 3s while a scan is running. */
const POLL_MS = 3000

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
  onStale: () => void
  refreshing: boolean
}

export function SyncPill({ target, onStale, refreshing }: Props): JSX.Element {
  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const knownStamp = useRef<string | null>(null)
  const [stale, setStale] = useState(false)
  const wasRunningRef = useRef(false)

  useEffect(() => {
    knownStamp.current = null
    setStale(false)
    setStatus(null)
    wasRunningRef.current = false
  }, [target])

  const poll = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const next = await fetchStatus(target, signal)
        setStatus(next)
        setError(null)

        if (knownStamp.current === null) {
          knownStamp.current = next.stamp
        } else if (next.stamp !== knownStamp.current) {
          setStale(true)
        }

        // Auto-refresh when a scan finishes (was running → now not running)
        if (wasRunningRef.current && !next.running && knownStamp.current !== next.stamp) {
          setStale(true)
          onStale()
        }
        wasRunningRef.current = next.running === true
      } catch (err) {
        if (signal?.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [target, onStale],
  )

  useEffect(() => {
    const controller = new AbortController()
    void poll(controller.signal)

    const id = setInterval(() => {
      if (!document.hidden) void poll(controller.signal)
    }, POLL_MS)

    const onVisible = () => {
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
    if (status) knownStamp.current = status.stamp
    setStale(false)
    onStale()
  }, [status, onStale])

  const running = status?.running === true
  const failed = status?.stage === 'error'

  return (
    <div className="flex items-center gap-2 text-[11px]">
      {/* Dot */}
      <span className={cn(
        'inline-block size-1.5 rounded-full shrink-0',
        error ? 'bg-rose-500' : running ? 'bg-amber-400 animate-pulse' : failed ? 'bg-rose-500' : stale ? 'bg-amber-400' : 'bg-emerald-500',
      )} />

      {/* Text */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={cn(
          'font-medium truncate',
          error ? 'text-rose-400' : running ? 'text-amber-400' : failed ? 'text-rose-400' : stale ? 'text-amber-400' : 'text-muted-foreground',
        )}>
          {error
            ? 'Status unavailable'
            : running
              ? (status?.stage ? STAGE_LABEL[status.stage] : undefined) ?? 'Working'
              : failed
                ? status?.message ?? 'Scan failed'
                : stale
                  ? 'New report available'
                  : 'Up to date'}
        </span>
        {running && <RotateCw className="size-3 animate-spin text-amber-400/70" />}
        <span className="text-muted-foreground/50 hidden sm:inline">
          {status?.scanTimestamp ? formatTimestamp(status.scanTimestamp) : '—'}
        </span>
      </div>

      {/* Action */}
      <button
        onClick={refresh}
        disabled={refreshing}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium transition-colors',
          stale
            ? 'bg-amber-400/15 text-amber-400 hover:bg-amber-400/25'
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
