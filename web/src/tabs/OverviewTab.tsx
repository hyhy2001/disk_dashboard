// Overview: three charts — Capacity Over Time, Usage by Teams, Top Users.

import { useMemo, useState } from 'react'
import type { Overview } from '../../../shared/api.js'
import { AreaChart } from '../components/AreaChart.js'
import { BarChart } from '../components/BarChart.js'
import { ChartModal } from '../components/ChartModal.js'
import { DeltaBadge } from '../components/DeltaBadge.js'
import { Donut, OTHER_SLICE } from '../components/Donut.js'
import { filterByRange, RangePicker, type RangeDays } from '../components/RangePicker.js'
import { Expand } from 'lucide-react'

interface Props { overview: Overview }
type Expanded = 'timeline' | 'teams' | 'users' | null

function ExpandButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-muted transition-colors text-muted-foreground" title="Full screen" aria-label="Full screen">
      <Expand className="size-3.5" />
    </button>
  )
}

export function OverviewTab({ overview }: Props): JSX.Element {
  const { capacity, teams, users, otherUsers, history } = overview
  const [range, setRange] = useState<RangeDays>('all')
  const [logScale, setLogScale] = useState(false)
  const [expanded, setExpanded] = useState<Expanded>(null)
  const [teamFilter, setTeamFilter] = useState<string | null>(null)

  const allUsers = useMemo(() => [...users, ...otherUsers], [users, otherUsers])
  const otherTotal = useMemo(() => otherUsers.reduce((s, u) => s + u.used, 0), [otherUsers])

  const shownUsers = useMemo(() => {
    if (teamFilter === null) return allUsers
    if (teamFilter === OTHER_SLICE) return otherUsers
    return allUsers.filter(u => u.team === teamFilter)
  }, [allUsers, otherUsers, teamFilter])
  const shownHistory = useMemo(() => filterByRange(history, range), [history, range])
  const rangeAvailable = (v: RangeDays): boolean => filterByRange(history, v).length > 1

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-3 auto-rows-min">
        {/* ── Timeline ── */}
        <div className="md:col-span-5 rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold flex-1">Capacity Over Time</h2>
            <DeltaBadge points={shownHistory} />
            <div className="flex items-center gap-1">
              <RangePicker value={range} onChange={setRange} available={rangeAvailable} />
              <ExpandButton onClick={() => setExpanded('timeline')} />
            </div>
          </div>
          <div className="p-3 flex-1 min-h-[200px]"><AreaChart points={shownHistory} /></div>
        </div>

        {/* ── Teams donut ── */}
        <div className="md:col-span-2 rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold">Usage by Teams</h2>
            <ExpandButton onClick={() => setExpanded('teams')} />
          </div>
          <div className="p-3 flex-1">
            <Donut rows={teams} onSelect={setTeamFilter} selected={teamFilter}
              {...(capacity ? { totalUsed: capacity.used } : {})}
              {...(otherTotal > 0 ? { otherUsed: otherTotal } : {})} />
          </div>
        </div>

        {/* ── Users bar ── */}
        <div className="md:col-span-3 rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold flex-1">Top Consuming Users</h2>
            {teamFilter && (
              <button type="button" onClick={() => setTeamFilter(null)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] bg-muted hover:bg-muted/70 transition-colors">
                {teamFilter} <span className="text-muted-foreground">×</span>
              </button>
            )}
            <div className="flex items-center gap-1">
              <button type="button" className="inline-flex items-center rounded-sm border border-border bg-transparent px-2 py-1 text-[10px] hover:bg-muted transition-colors" onClick={() => setLogScale(v => !v)} aria-pressed={logScale}>{logScale ? 'Log' : 'Linear'}</button>
              <ExpandButton onClick={() => setExpanded('users')} />
            </div>
          </div>
          <div className="p-3 flex-1 min-h-[200px]">
            {shownUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
                <p className="text-sm font-semibold text-foreground">No consumer data</p>
                <p className="text-xs">Usage in this segment is untracked or belongs to the system.</p>
              </div>
            ) : <BarChart rows={shownUsers} limit={10} logScale={logScale} />}
          </div>
        </div>
      </div>

      {expanded === 'timeline' && <ChartModal title="Capacity Over Time — Full View" slug="timeline" onClose={() => setExpanded(null)}><div className="h-[60vh]"><AreaChart points={shownHistory} /></div></ChartModal>}
      {expanded === 'teams' && <ChartModal title="Usage by Teams — Full View" slug="teams" onClose={() => setExpanded(null)}><Donut rows={teams} size={280} onSelect={setTeamFilter} selected={teamFilter} {...(capacity ? { totalUsed: capacity.used } : {})} {...(otherTotal > 0 ? { otherUsed: otherTotal } : {})} /></ChartModal>}
      {expanded === 'users' && <ChartModal title="Top Consuming Users — Full View" slug="users" onClose={() => setExpanded(null)}><div className="h-[60vh]"><BarChart rows={shownUsers} limit={30} logScale={logScale} /></div></ChartModal>}
    </>
  )
}
