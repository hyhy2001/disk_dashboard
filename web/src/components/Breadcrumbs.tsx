// Path from the scan root to the open directory, each step clickable to jump
// back up. Long paths get their middle collapsed rather than wrapping, since the
// first and last few segments are what orient the user.

import type { TreemapCrumb } from '../../../shared/api.js'

interface Props {
  path: TreemapCrumb[]
  onNavigate: (id: number) => void
}

/** Keep this many leading and trailing crumbs when collapsing. */
const HEAD = 2
const TAIL = 3

export function Breadcrumbs({ path, onNavigate }: Props): JSX.Element {
  const collapse = path.length > HEAD + TAIL + 1
  const shown: (TreemapCrumb | null)[] = collapse
    ? [...path.slice(0, HEAD), null, ...path.slice(path.length - TAIL)]
    : path

  return (
    <nav className="crumbs" aria-label="Directory path">
      {shown.map((c, i) => {
        const last = i === shown.length - 1
        if (!c) {
          return (
            <span className="crumbs__gap" key="gap" title={`${path.length - HEAD - TAIL} more levels`}>
              …
            </span>
          )
        }
        return (
          <span className="crumbs__item" key={c.id}>
            {last ? (
              <span className="crumbs__current" aria-current="page">
                {c.name}
              </span>
            ) : (
              <button type="button" className="crumbs__link" onClick={() => onNavigate(c.id)}>
                {c.name}
              </button>
            )}
            {!last && <span className="crumbs__sep">/</span>}
          </span>
        )
      })}
    </nav>
  )
}
