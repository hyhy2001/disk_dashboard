// Ranked usage rows with an inline proportion bar — the middle column's
// workhorse. Bars are relative to the largest row so the shape stays readable
// even when one account dominates the total.

import type { UsageRow } from '../../../shared/api.js'
import { formatSize } from '../lib/format.js'

interface Props {
  title: string
  rows: UsageRow[]
  emptyText: string
  limit?: number
}

export function UsageList({ title, rows, emptyText, limit = 12 }: Props): JSX.Element {
  const data = [...rows].filter((r) => r.used > 0).sort((a, b) => b.used - a.used).slice(0, limit)
  const max = data[0]?.used ?? 0

  return (
    <section>
      <h2 className="col__title">{title}</h2>
      {data.length === 0 ? (
        <p className="empty">{emptyText}</p>
      ) : (
        <div className="rows">
          {data.map((r) => (
            <div className="row" key={r.name}>
              <div className="row__head">
                <span className="row__name" title={r.name}>
                  {r.name}
                </span>
                <span className="row__value">{formatSize(r.used)}</span>
              </div>
              <div className="row__track">
                <div
                  className="row__fill"
                  style={{ width: max > 0 ? `${(r.used / max) * 100}%` : '0%' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
