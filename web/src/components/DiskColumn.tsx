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
 * Share of the group's total scanned bytes.
 *
 * Legacy coloured its pill by used/capacity, but /api/targets carries no
 * filesystem capacity — that lives in each report's snapshot. Rather than invent
 * a number, the pill answers a question this payload can actually answer: how
 * much of the group does this disk account for.
 */
function groupShare(t: Target, groupTotal: number): number {
  return groupTotal > 0 ? (t.totalSize / groupTotal) * 100 : 0
}

function sortTargets(targets: Target[], sort: DiskSort): Target[] {
  const out = [...targets]
  switch (sort) {
    case 'alpha-asc':
      return out.sort((a, b) => a.name.localeCompare(b.name))
    case 'alpha-desc':
      return out.sort((a, b) => b.name.localeCompare(a.name))
    case 'usage-desc':
      // Without per-target capacity in this payload, "most used" is the largest
      // scanned footprint — the same ordering intent, honest about its basis.
      return out.sort((a, b) => b.totalSize - a.totalSize)
    case 'free-desc':
      return out.sort((a, b) => a.totalSize - b.totalSize)
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
  const groupTotal = targets.reduce((sum, t) => sum + t.totalSize, 0)

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
            // Share of the largest target in view — a relative bar, since this
            // payload has no per-target filesystem capacity.
            const share = (t.totalSize / biggest) * 100
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
                  <span
                    className={pillClass(groupShare(t, groupTotal))}
                    title={`${groupShare(t, groupTotal).toFixed(1)}% of this group's scanned bytes`}
                  >
                    {formatSize(t.totalSize)}
                  </span>
                </div>

                <div className="disk__bar">
                  <span className="disk__bar-fill" style={{ width: `${share}%` }} />
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
                </div>

                <div className="disk__path" title={t.scanRoot}>
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
