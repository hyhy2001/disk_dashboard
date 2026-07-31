// Table-style directory listing: Folder / Owner / Size · % / Type.
//
// This mirrors the legacy dashboard's "TreeMap" tab, which is a table rather than
// a treemap. Anyone who used the old dashboard should be able to read this
// without relearning anything, so the column set and the inline proportion bar
// are kept as they were.
//
// Percentages are of the whole scanned target, not of the parent directory —
// that is what legacy showed, and it lets a user compare a deeply nested folder
// against the disk as a whole rather than against its siblings.

import type { TreemapNode } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'

interface Props {
  dirs: TreemapNode[]
  /** Denominator for the percentage column: the target's total scanned size. */
  totalSize: number
  onOpen: (node: TreemapNode) => void
  /** Present when more rows can be fetched. */
  onLoadMore?: (() => void) | undefined
  loadingMore?: boolean
  shownCount: number
  totalCount: number
  /** Number of files directly in this directory (for the [files] summary row). */
  fileCount: number
  /** Size covered by files (≈ remainder — includes children past the page). */
  filesRemainder: number
}

/** Bar colour by share of the disk — the legacy thresholds. */
function barColor(pct: number): string {
  if (pct >= 20) return 'var(--rose-400)'
  if (pct >= 10) return 'var(--amber-400)'
  if (pct >= 2) return 'var(--sky-400)'
  return 'var(--accent)'
}

function pctOf(size: number, total: number): number {
  return total > 0 ? (size / total) * 100 : 0
}

function SizeCell({ size, total }: { size: number; total: number }): JSX.Element {
  const pct = pctOf(size, total)
  const pctLabel = pct < 0.01 && pct > 0 ? '<0.01%' : `${pct.toFixed(2)}%`
  return (
    <span className="flex items-center gap-2 shrink-0 w-44">
      <span className="tabular-nums text-[11px] font-medium text-right w-24 shrink-0">{formatSize(size)}</span>
      <span className="h-1 flex-1 rounded-full bg-muted overflow-hidden min-w-[16px]">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(0.5, Math.min(100, pct))}%`,
            background: barColor(pct),
          }}
        />
      </span>
      <span className="tabular-nums text-[10px] text-muted-foreground text-right w-14 shrink-0">{pctLabel}</span>
    </span>
  )
}

export function EntryList({
  dirs,
  totalSize,
  onOpen,
  onLoadMore,
  loadingMore,
  shownCount,
  totalCount,
  fileCount,
  filesRemainder,
}: Props): JSX.Element {
  if (dirs.length === 0 && fileCount === 0) {
    return <div className="text-center text-[11px] text-muted-foreground p-6">This directory is empty.</div>
  }

  return (
    <div className="flex flex-col h-full overflow-x-auto">
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border/30 text-[10px] text-muted-foreground uppercase tracking-wider shrink-0 min-w-[460px]">
        <span className="flex-1">Folder</span>
        <span className="w-20 shrink-0">Owner</span>
        <span className="w-44 shrink-0 text-right">Size · %</span>
        <span className="w-10 shrink-0 text-right">Type</span>
      </div>

      <div className="flex-1 overflow-auto divide-y divide-border/20 min-w-[460px]">
        {dirs.map((d) => (
          <button
            type="button"
            className="flex items-center gap-4 w-full px-4 py-1.5 hover:bg-white/[0.03] transition-colors text-left text-[11px]"
            key={`d${d.id}`}
            onClick={() => onOpen(d)}
            title={`${d.name} — ${formatCount(d.fileCount)} files, ${formatCount(d.dirCount)} subdirectories`}
          >
            <span className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="text-muted-foreground shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </span>
              <span className="truncate font-mono text-muted-foreground hover:text-foreground transition-colors">
                {d.name}
              </span>
            </span>
            <span className="w-20 truncate text-muted-foreground shrink-0">{d.owner}</span>
            <SizeCell size={d.size} total={totalSize} />
            <span className="w-10 text-right text-muted-foreground shrink-0">dir</span>
          </button>
        ))}

        {fileCount > 0 && (
          <div className="flex items-center gap-4 px-4 py-1.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="shrink-0 opacity-60">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <span className="font-mono">[files]</span>
            </span>
            <span className="w-20 truncate shrink-0">{formatCount(fileCount)} files</span>
            <SizeCell size={filesRemainder} total={totalSize} />
            <span className="w-10 text-right shrink-0 text-[10px]">files</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border/30 text-[10px] text-muted-foreground shrink-0">
        <span className="tabular-nums">
          Showing {formatCount(shownCount)} of {formatCount(totalCount)} subdirectories
        </span>
        {onLoadMore && (
          <button
            type="button"
            className="inline-flex items-center rounded-sm border border-border bg-transparent px-3 py-1.5 text-xs hover:bg-muted transition-colors"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
