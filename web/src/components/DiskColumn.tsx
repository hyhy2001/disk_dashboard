// Column 2: the targets inside the selected group, as cards.
//
// Legacy's disk card is denser than a plain list row, and deliberately so — you
// pick a disk by how full it is, not by its name. Each card carries a usage pill
// with the same three thresholds legacy used, a three-segment mini bar
// (scanned / used-but-unscanned / free), and a stats block.
//
// The mini bar is the reason this is a card and not a row: it shows at a glance
// that a disk is 90% full *and* that only half of that is attributable.

import { useMemo, useState } from 'react'
import type { Target } from '../../../shared/api.js'
import { formatCount, formatSize } from '../lib/format.js'

export type DiskSort = 'alpha-asc' | 'alpha-desc' | 'usage-desc' | 'free-desc'

const SORT_LABELS: Record<DiskSort, string> = {
  'alpha-asc': 'Name A–Z',
  'alpha-desc': 'Name Z–A',
  'usage-desc': 'Used Capacity (%)',
  'free-desc': 'Free Space',
}

interface Props {
  groupName: string
  targets: Target[]
  selected: string | null
  onSelect: (name: string) => void
  onToggleSidebar: () => void
}

/**
 * Usage pill tone, on legacy's thresholds: under 70% fine, 70–85% warning,
 * 85%+ danger.
 */
function pillClass(pct: number): string {
  if (pct >= 85) return 'pill pill--danger'
  if (pct >= 70) return 'pill pill--warn'
  return 'pill pill--ok'
}

/**
 * How full the disk is, as a percentage of its filesystem capacity.
 *
 * Returns null when the report has no snapshot to read capacity from. That is a
 * real state — a target scanned by an older duscan, or one whose filesystem could
 * not be statted — and it must render as "unknown" rather than as 0%, which would
 * claim the disk is empty.
 */
export function usedPercent(t: Target): number | null {
  if (!t.capacity || t.capacity.total <= 0) return null
  return (t.capacity.used / t.capacity.total) * 100
}

/** Free bytes, or null when capacity is unknown. */
function freeBytes(t: Target): number | null {
  return t.capacity ? t.capacity.available : null
}

function sortTargets(targets: Target[], sort: DiskSort): Target[] {
  const out = [...targets]
  switch (sort) {
    case 'alpha-asc':
      return out.sort((a, b) => a.name.localeCompare(b.name))
    case 'alpha-desc':
      return out.sort((a, b) => b.name.localeCompare(a.name))
    case 'usage-desc':
      // Targets with unknown capacity sort last: they cannot be ranked by
      // fullness, and putting them first would bury the disks that matter.
      return out.sort((a, b) => (usedPercent(b) ?? -1) - (usedPercent(a) ?? -1))
    case 'free-desc':
      return out.sort((a, b) => (freeBytes(b) ?? -1) - (freeBytes(a) ?? -1))
  }
}

export function DiskColumn({
  groupName,
  targets,
  selected,
  onSelect,
  onToggleSidebar,
}: Props): JSX.Element {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<DiskSort>('usage-desc')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? targets.filter(
          (t) => t.name.toLowerCase().includes(q) || t.scanRoot.toLowerCase().includes(q),
        )
      : targets
    return sortTargets(filtered, sort)
  }, [targets, search, sort])

  const biggest = Math.max(...shown.map((t) => t.totalSize), 1)

  return (
    <aside className="diskcol glass">
      <div className="diskcol__head">
        <button
          type="button"
          className="icon-btn icon-btn--sm hamburger"
          onClick={onToggleSidebar}
          aria-label="Toggle groups"
          title="Toggle groups"
        >
          ☰
        </button>
        <h2 className="diskcol__title">{groupName}</h2>
      </div>

      <input
        type="search"
        className="sidebar__search"
        placeholder="Search disks..."
        aria-label="Search disks"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="diskcol__sort">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() =>
            setSort((s) => (s === 'alpha-asc' ? 'alpha-desc' : 'alpha-asc'))
          }
          aria-pressed={sort === 'alpha-asc' || sort === 'alpha-desc'}
          title="Sort by name"
        >
          {sort === 'alpha-desc' ? 'Z–A' : 'A–Z'}
        </button>
        <select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as DiskSort)}
          aria-label="Sort disks"
        >
          {(Object.keys(SORT_LABELS) as DiskSort[]).map((k) => (
            <option value={k} key={k}>
              {SORT_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="diskcol__list">
        {shown.length === 0 ? (
          <p className="empty">
            {targets.length === 0 ? 'No disks in this group.' : 'No disk matches that search.'}
          </p>
        ) : (
          shown.map((t) => {
            const pct = usedPercent(t)
            // Three segments: what the scan attributed, what the filesystem counts
            // as used but the scan could not reach, and free space. The middle one
            // is the whole reason this is a bar and not a number.
            const cap = t.capacity
            const scannedPct = cap && cap.total > 0 ? (cap.scanned / cap.total) * 100 : 0
            const usedPct = pct ?? 0
            const unscannedPct = Math.max(0, usedPct - scannedPct)
            // With no capacity there is nothing to be a fraction of, so fall back
            // to a relative bar against the biggest target in view.
            const fallbackPct = (t.totalSize / biggest) * 100

            return (
              <button
                type="button"
                className={`disk${t.name === selected ? ' disk--on' : ''}`}
                key={t.name}
                onClick={() => onSelect(t.name)}
                aria-current={t.name === selected}
              >
                <div className="disk__top">
                  <span className="disk__name">{t.name}</span>
                  {pct === null ? (
                    <span
                      className="pill pill--unknown"
                      data-tooltip="No snapshot in this report, so filesystem capacity is unknown"
                    >
                      {formatSize(t.totalSize)}
                    </span>
                  ) : (
                    <span
                      className={pillClass(pct)}
                      data-tooltip={`${formatSize(cap?.used ?? 0)} of ${formatSize(cap?.total ?? 0)} used · ${formatSize(cap?.available ?? 0)} free`}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  )}
                </div>

                <div className="disk__bar">
                  {pct === null ? (
                    <span className="disk__bar-fill" style={{ width: `${fallbackPct}%` }} />
                  ) : (
                    <>
                      <span
                        className="disk__seg disk__seg--scanned"
                        style={{ width: `${scannedPct}%` }}
                      />
                      <span
                        className="disk__seg disk__seg--unscanned"
                        style={{ width: `${unscannedPct}%` }}
                      />
                    </>
                  )}
                </div>

                <div className="disk__stats">
                  <span className="disk__stat">
                    <span className="disk__dot disk__dot--scanned" />
                    {formatCount(t.totalFiles)} files
                  </span>
                  <span className="disk__stat">
                    <span className="disk__dot disk__dot--dirs" />
                    {formatCount(t.totalDirs)} dirs
                  </span>
                  {cap && (
                    <span className="disk__stat">
                      <span className="disk__dot disk__dot--free" />
                      {formatSize(cap.available)} free
                    </span>
                  )}
                </div>

                <div className="disk__path" data-tooltip={t.scanRoot}>
                  {t.scanRoot || '—'}
                </div>
              </button>
            )
          })
        )}
      </div>

      <div className="diskcol__foot">
        {shown.length} of {targets.length} disk{targets.length === 1 ? '' : 's'}
      </div>
    </aside>
  )
}
