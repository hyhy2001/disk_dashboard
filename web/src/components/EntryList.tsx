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

import type { TreemapFile, TreemapNode } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'

interface Props {
  dirs: TreemapNode[]
  files: TreemapFile[]
  /** Denominator for the percentage column: the target's total scanned size. */
  totalSize: number
  onOpen: (node: TreemapNode) => void
  /** Present when more rows can be fetched. */
  onLoadMore?: (() => void) | undefined
  loadingMore?: boolean
  shownCount: number
  totalCount: number
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
  return (
    <span className="ent__size">
      <span className="ent__size-text">
        <span className="ent__size-val">{formatSize(size)}</span>
        <span className="ent__size-pct">{pct < 0.01 && pct > 0 ? '<0.01%' : `${pct.toFixed(2)}%`}</span>
      </span>
      <span className="ent__bar">
        <span
          className="ent__bar-fill"
          style={{
            // Always leave a sliver visible so a tiny entry is still legible.
            width: `${Math.max(0.5, Math.min(100, pct))}%`,
            background: barColor(pct),
          }}
        />
      </span>
    </span>
  )
}

export function EntryList({
  dirs,
  files,
  totalSize,
  onOpen,
  onLoadMore,
  loadingMore,
  shownCount,
  totalCount,
}: Props): JSX.Element {
  if (dirs.length === 0 && files.length === 0) {
    return <div className="ent__empty">This directory is empty.</div>
  }

  return (
    <div className="ent">
      <div className="ent__head">
        <span>Folder</span>
        <span>Owner</span>
        <span>Size · %</span>
        <span>Type</span>
      </div>

      <div className="ent__rows">
        {dirs.map((d) => (
          <button
            type="button"
            className="ent__row ent__row--dir"
            key={`d${d.id}`}
            onClick={() => onOpen(d)}
            // A directory with no subdirectories has nothing to drill into, but
            // it may still hold files — so it stays clickable.
            title={`${d.name} — ${formatCount(d.fileCount)} files, ${formatCount(d.dirCount)} subdirectories`}
          >
            <span className="ent__name">
              <span className="ent__icon ent__icon--dir" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </span>
              <span className="ent__label">{d.name}</span>
            </span>
            <span className="ent__owner">{d.owner}</span>
            <SizeCell size={d.size} total={totalSize} />
            <span className="ent__type">dir</span>
          </button>
        ))}

        {files.map((f) => (
          <div className="ent__row ent__row--file" key={`f${f.name}-${f.size}`}>
            <span className="ent__name">
              <span className="ent__icon ent__icon--file" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <span className="ent__label">{f.name}</span>
            </span>
            <span className="ent__owner">{f.owner}</span>
            <SizeCell size={f.size} total={totalSize} />
            <span className="ent__type">file</span>
          </div>
        ))}
      </div>

      <div className="ent__foot">
        <span className="ent__count">
          Showing {formatCount(shownCount)} of {formatCount(totalCount)} subdirectories
        </span>
        {onLoadMore && (
          <button type="button" className="btn" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}
