import { useMemo, useState } from 'react'
import type { Overview } from '../../../shared/api.js'
import { AreaChart, ChartLegend } from '../components/AreaChart.js'
import { BarChart } from '../components/BarChart.js'
import { ChartModal } from '../components/ChartModal.js'
import { DeltaBadge } from '../components/DeltaBadge.js'
import { Donut, OTHER_SLICE } from '../components/Donut.js'
import { filterByRange, RangePicker, type RangeDays } from '../components/RangePicker.js'
import { Expand } from 'lucide-react'

interface Props {
  overview: Overview
}
type Expanded = 'timeline' | 'teams' | 'users' | null

function ExpandButton({ onClick }: { onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-muted transition-colors text-muted-foreground"
      title="Full screen"
      aria-label="Full screen"
    >
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
    return allUsers.filter((u) => u.team === teamFilter)
  }, [allUsers, otherUsers, teamFilter])
  const shownHistory = useMemo(() => filterByRange(history, range), [history, range])
  const rangeAvailable = (v: RangeDays): boolean => filterByRange(history, v).length > 1

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3">
        {/* ── Timeline (spans both columns) ── */}
        <div className="md:col-span-2 rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold flex-1 min-w-0">Capacity Over Time</h2>
            <DeltaBadge points={shownHistory} />
            <div className="flex items-center gap-1">
              <RangePicker value={range} onChange={setRange} available={rangeAvailable} />
              <ExpandButton onClick={() => setExpanded('timeline')} />
            </div>
          </div>
          <div className="p-3 pb-1" style={{ height: 'clamp(150px, 24vh, 380px)' }}>
            <AreaChart points={shownHistory} showLegend={false} />
          </div>
          <div className="px-3 pb-3">
            <ChartLegend />
          </div>
        </div>

        {/* ── Teams donut ── */}
        <div className="rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold">Usage by Teams</h2>
            <ExpandButton onClick={() => setExpanded('teams')} />
          </div>
          <div className="p-3 flex flex-col justify-center" style={{ height: 'clamp(190px, 26vh, 420px)' }}>
            <Donut
              rows={teams}
              size={200}
              onSelect={setTeamFilter}
              selected={teamFilter}
              {...(capacity ? { totalUsed: capacity.used } : {})}
              {...(otherTotal > 0 ? { otherUsed: otherTotal } : {})}
            />
          </div>
        </div>

        {/* ── Users bar ── */}
        <div className="rounded-lg border border-border bg-surface/50 shadow-sm flex flex-col">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/40 px-3 py-2">
            <h2 className="text-sm font-semibold flex-1 min-w-0">Top Consuming Users</h2>
            {teamFilter && (
              <button
                type="button"
                onClick={() => setTeamFilter(null)}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[12px] bg-muted hover:bg-muted/70 transition-colors"
              >
                {teamFilter} <span className="text-muted-foreground">×</span>
              </button>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex items-center rounded-sm border border-border bg-transparent px-2 py-1 text-[12px] hover:bg-muted transition-colors"
                onClick={() => setLogScale((v) => !v)}
                aria-pressed={logScale}
              >
                {logScale ? 'Log' : 'Linear'}
              </button>
              <ExpandButton onClick={() => setExpanded('users')} />
            </div>
          </div>
          <div className="p-3" style={{ height: 'clamp(190px, 26vh, 420px)' }}>
            {shownUsers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
                <p className="text-sm font-semibold text-foreground">No consumer data</p>
                <p className="text-xs">Usage in this segment is untracked or belongs to the system.</p>
              </div>
            ) : (
              <BarChart rows={shownUsers} limit={10} logScale={logScale} />
            )}
          </div>
        </div>
      </div>

      {expanded === 'timeline' && (
        <ChartModal title="Capacity Over Time — Full View" slug="timeline" onClose={() => setExpanded(null)}>
          <div className="flex flex-col h-full min-h-0 p-3 gap-2">
            <div className="flex-1 min-h-0">
              <AreaChart points={shownHistory} showLegend={false} />
            </div>
            <ChartLegend />
          </div>
        </ChartModal>
      )}
      {expanded === 'teams' && (
        <ChartModal title="Usage by Teams — Full View" slug="teams" onClose={() => setExpanded(null)}>
          <div className="flex items-center justify-center h-full min-h-0 p-3">
            <Donut
              rows={teams}
              size={280}
              onSelect={setTeamFilter}
              selected={teamFilter}
              {...(capacity ? { totalUsed: capacity.used } : {})}
              {...(otherTotal > 0 ? { otherUsed: otherTotal } : {})}
            />
          </div>
        </ChartModal>
      )}
      {expanded === 'users' && (
        <ChartModal title="Top Consuming Users — Full View" slug="users" onClose={() => setExpanded(null)}>
          <div className="h-full min-h-0 p-3">
            <BarChart rows={shownUsers} limit={30} logScale={logScale} />
          </div>
        </ChartModal>
      )}
    </>
  )
}
