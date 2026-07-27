// Overview: summary cards, capacity meter, team split and the usage timeline.
// This is the right-hand detail column; the two left columns live in App.

import type { Overview } from '../../../shared/api.js'
import { AreaChart } from '../components/AreaChart.js'
import { BarChart } from '../components/BarChart.js'
import { Donut } from '../components/Donut.js'
import { formatCount, formatPercent, formatSize, formatTimestamp } from '../lib/format.js'

interface Props {
  overview: Overview
}

export function OverviewTab({ overview }: Props): JSX.Element {
  const { target, capacity, teams, users, otherUsers, history } = overview
  const allUsers = [...users, ...otherUsers]

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

      <div className="panels">
        <div className="panel">
          <h2 className="panel__title">Usage by team</h2>
          <Donut rows={teams} />
        </div>
        <div className="panel">
          <h2 className="panel__title">Top users</h2>
          <BarChart rows={allUsers} limit={10} />
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__title">Used space over time</h2>
        <AreaChart points={history} />
      </div>
    </>
  )
}
