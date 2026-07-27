// Overview: summary cards, capacity meter, team split and the usage timeline.
// This is the right-hand detail column; the two left columns live in App.
//
// Chart controls mirror the legacy dashboard: a range selector on the timeline,
// a log/linear toggle on the user bars, and an expand button on each chart.

import { useMemo, useState } from 'react'
import type { Overview } from '../../../shared/api.js'
import { AreaChart } from '../components/AreaChart.js'
import { BarChart } from '../components/BarChart.js'
import { ChartModal } from '../components/ChartModal.js'
import { Donut } from '../components/Donut.js'
import { filterByRange, RangePicker, type RangeDays } from '../components/RangePicker.js'
import { formatCount, formatPercent, formatSize, formatTimestamp } from '../lib/format.js'

interface Props {
  overview: Overview
}

type Expanded = 'timeline' | 'teams' | 'users' | null

/** Expand button shown in each panel header. */
function ExpandButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="icon-btn icon-btn--sm"
      onClick={onClick}
      title="Open full-screen chart view"
      aria-label="Open full-screen chart view"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    </button>
  )
}

export function OverviewTab({ overview }: Props): JSX.Element {
  const { target, capacity, teams, users, otherUsers, history } = overview
  const [range, setRange] = useState<RangeDays>('all')
  const [logScale, setLogScale] = useState(false)
  const [expanded, setExpanded] = useState<Expanded>(null)

  const allUsers = useMemo(() => [...users, ...otherUsers], [users, otherUsers])
  const shownHistory = useMemo(() => filterByRange(history, range), [history, range])

  // A range with fewer than two points cannot draw a trend, so offer only the
  // ones that would actually show something.
  const rangeAvailable = (v: RangeDays): boolean => filterByRange(history, v).length > 1

  return (
    <>
      <div className="cards">
        <div className="card">
          <div className="card__label">Scanned size</div>
          <div className="card__value">{formatSize(target.totalSize)}</div>
          <div className="card__hint">under {target.scanRoot || 'unknown root'}</div>
        </div>
        <div className="card">
          <div className="card__label">Files</div>
          <div className="card__value">{formatCount(target.totalFiles)}</div>
          <div className="card__hint">{formatCount(target.totalDirs)} directories</div>
        </div>
        <div className="card">
          <div className="card__label">Last scan</div>
          <div className="card__value" style={{ fontSize: '16px' }}>
            {formatTimestamp(target.scanTimestamp)}
          </div>
          <div className="card__hint">
            {history.length} snapshot{history.length === 1 ? '' : 's'} on record
          </div>
        </div>
        <div className="card">
          <div className="card__label">Report size</div>
          <div className="card__value">{formatSize(target.dbSizeBytes)}</div>
          <div className="card__hint">report.db on disk</div>
        </div>
      </div>

      {capacity && (
        <div className="panel">
          <h2 className="panel__title">Filesystem capacity</h2>
          <div className="meter">
            <div
              className="meter__fill"
              style={{ width: formatPercent(capacity.used, capacity.total) }}
            />
          </div>
          <div className="meter__legend">
            <span>
              {formatSize(capacity.used)} used ({formatPercent(capacity.used, capacity.total)})
            </span>
            <span>{formatSize(capacity.available)} free</span>
            <span>{formatSize(capacity.total)} total</span>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Capacity over time</h2>
          <div className="panel__tools">
            <RangePicker value={range} onChange={setRange} available={rangeAvailable} />
            <ExpandButton onClick={() => setExpanded('timeline')} />
          </div>
        </div>
        <AreaChart points={shownHistory} />
      </div>

      <div className="panels">
        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Usage by teams</h2>
            <ExpandButton onClick={() => setExpanded('teams')} />
          </div>
          <Donut rows={teams} />
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Top consuming users</h2>
            <div className="panel__tools">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setLogScale((v) => !v)}
                title="Switch between logarithmic and linear scale"
                aria-pressed={logScale}
              >
                {logScale ? 'Log' : 'Linear'}
              </button>
              <ExpandButton onClick={() => setExpanded('users')} />
            </div>
          </div>
          <BarChart rows={allUsers} limit={10} logScale={logScale} />
        </div>
      </div>

      {expanded === 'timeline' && (
        <ChartModal title="Capacity over time" onClose={() => setExpanded(null)}>
          <AreaChart points={shownHistory} />
        </ChartModal>
      )}
      {expanded === 'teams' && (
        <ChartModal title="Usage by teams" onClose={() => setExpanded(null)}>
          <Donut rows={teams} size={280} />
        </ChartModal>
      )}
      {expanded === 'users' && (
        <ChartModal title="Top consuming users" onClose={() => setExpanded(null)}>
          {/* More room means more bars are worth showing. */}
          <BarChart rows={allUsers} limit={30} logScale={logScale} />
        </ChartModal>
      )}
    </>
  )
}
