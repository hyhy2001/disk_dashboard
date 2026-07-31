import type { TreemapCrumb } from '../../../shared/api.js'
import { copyPath } from '../lib/clipboard.js'

interface Props {
  path: TreemapCrumb[]
  onNavigate: (id: number) => void
}

const HEAD = 2
const TAIL = 3

function fullPath(path: TreemapCrumb[]): string {
  const parts: string[] = []
  for (const c of path) {
    if (c.name === '/') continue
    parts.push(c.name)
  }
  return '/' + parts.join('/')
}

export function Breadcrumbs({ path, onNavigate }: Props): JSX.Element {
  const collapse = path.length > HEAD + TAIL + 1
  const shown: (TreemapCrumb | null)[] = collapse
    ? [...path.slice(0, HEAD), null, ...path.slice(path.length - TAIL)]
    : path

  return (
    <div className="flex items-center gap-1 min-w-0 flex-1">
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
      <button type="button" className="shrink-0 inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" onClick={() => void copyPath(fullPath(path))} aria-label="Copy full path" data-tooltip="Copy full path">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
    </div>
  )
}
