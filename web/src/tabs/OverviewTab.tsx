// Overview: the three charts legacy shows, and nothing else.
//
//   Capacity Over Time · Usage by Teams · Top Consuming Users
//
// Capacity figures live in App's shared page header, since they describe the
// target rather than this tab. No summary cards and no ranked tables: the donut
// and the bar chart already carry that data, and duplicating it just makes the
// page longer.
//
// Chart controls mirror legacy: a range selector on the timeline, a log/linear
// toggle on the user bars, and an expand button on each chart.

import { useMemo, useState } from 'react'
import type { Overview } from '../../../shared/api.js'
import { AreaChart } from '../components/AreaChart.js'
import { BarChart } from '../components/BarChart.js'
import { ChartModal } from '../components/ChartModal.js'
import { DeltaBadge } from '../components/DeltaBadge.js'
import { Donut } from '../components/Donut.js'
import { filterByRange, RangePicker, type RangeDays } from '../components/RangePicker.js'

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
  const { capacity, teams, users, otherUsers, history } = overview
  const [range, setRange] = useState<RangeDays>('all')
  const [logScale, setLogScale] = useState(false)
  const [expanded, setExpanded] = useState<Expanded>(null)
  /** Team picked from the donut; filters the user chart. */
  const [teamFilter, setTeamFilter] = useState<string | null>(null)

  const allUsers = useMemo(() => [...users, ...otherUsers], [users, otherUsers])
  const shownUsers = useMemo(
    () => (teamFilter === null ? allUsers : allUsers.filter((u) => u.team === teamFilter)),
    [allUsers, teamFilter],
  )
  const shownHistory = useMemo(() => filterByRange(history, range), [history, range])

  // A range with fewer than two points cannot draw a trend, so offer only the
  // ones that would actually show something.
  const rangeAvailable = (v: RangeDays): boolean => filterByRange(history, v).length > 1

  return (
    <>
      {/* Legacy's Overview is exactly three charts. The capacity figures live in
          the shared page header, not here, and there are no summary cards or
          ranked tables — the donut and bar chart already carry that data. */}
      {/* One grid, timeline spanning both columns — legacy's .charts-grid with
          .large-span. Keeping the three panels in a single grid is what lets the
          whole page be sized as one unit. */}
      <div className="charts">
        <div className="panel panel--wide">
          <div className="panel__head">
            <h2 className="panel__title">Capacity Over Time</h2>
            <DeltaBadge points={shownHistory} />
            <div className="panel__tools">
              <RangePicker value={range} onChange={setRange} available={rangeAvailable} />
              <ExpandButton onClick={() => setExpanded('timeline')} />
            </div>
          </div>
          <div className="canvas canvas--tall">
            <AreaChart points={shownHistory} />
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Usage by Teams</h2>
            <ExpandButton onClick={() => setExpanded('teams')} />
          </div>
          <div className="canvas">
            <Donut
              rows={teams}
              onSelect={setTeamFilter}
              selected={teamFilter}
              {...(capacity ? { totalUsed: capacity.used } : {})}
            />
          </div>
        </div>

        <div className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Top Consuming Users</h2>
            {teamFilter && (
              <button
                type="button"
                className="chip"
                onClick={() => setTeamFilter(null)}
                title="Clear team filter"
              >
                {teamFilter} <span className="chip__x">✕</span>
              </button>
            )}
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
          <div className="canvas">
            {shownUsers.length === 0 ? (
              <div className="nodata">
                <p className="nodata__title">No consumer data</p>
                <p>Usage in this segment is untracked or belongs to the system.</p>
              </div>
            ) : (
              <BarChart rows={shownUsers} limit={10} logScale={logScale} />
            )}
          </div>
        </div>
      </div>

      {expanded === 'timeline' && (
        <ChartModal
          title="Capacity Over Time — Full View"
          slug="timeline"
          onClose={() => setExpanded(null)}
        >
          {/* Sized by CSS in the modal, which gives it a taller box. */}
          <div className="canvas canvas--modal">
            <AreaChart points={shownHistory} />
          </div>
        </ChartModal>
      )}
      {expanded === 'teams' && (
        <ChartModal
          title="Usage by Teams — Full View"
          slug="teams"
          onClose={() => setExpanded(null)}
        >
          <Donut
            rows={teams}
            size={280}
            onSelect={setTeamFilter}
            selected={teamFilter}
            {...(capacity ? { totalUsed: capacity.used } : {})}
          />
        </ChartModal>
      )}
      {expanded === 'users' && (
        <ChartModal
          title="Top Consuming Users — Full View"
          slug="users"
          onClose={() => setExpanded(null)}
        >
          {/* More room means more bars are worth showing. */}
          <div className="canvas canvas--modal">
            <BarChart rows={shownUsers} limit={30} logScale={logScale} />
          </div>
        </ChartModal>
      )}
    </>
  )
}
