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
    <nav className="flex items-center gap-0.5 text-[11px] text-muted-foreground min-w-0 flex-1 flex-wrap" aria-label="Directory path">
      {shown.map((c, i) => {
        const last = i === shown.length - 1
        if (!c) {
          return (
            <span className="px-1" key="gap" title={`${path.length - HEAD - TAIL} more levels`}>
              …
            </span>
          )
        }
        return (
          <span className="flex items-center gap-0.5" key={c.id}>
            {last ? (
              <span className="text-foreground font-medium" aria-current="page">
                {c.name === '/' ? '' : c.name}
              </span>
            ) : (
              <button type="button" className="hover:text-foreground transition-colors" onClick={() => onNavigate(c.id)}>
                {c.name === '/' ? '' : c.name}
              </button>
            )}
            {!last && <span className="text-muted-foreground/50">/</span>}
          </span>
        )
      })}
    </nav>
  )
}
