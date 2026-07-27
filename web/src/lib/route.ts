// Hash routing.
//
// The hash, not the path: the server serves one HTML file and does not know about
// client routes, so a real path would 404 on reload behind any proxy that is not
// configured to rewrite. The hash keeps deep links working with no server support.
//
// Shape mirrors legacy so old bookmarks read the same way:
//
//   #/                                     nothing selected
//   #/<space>                              a space, no disk
//   #/<space>/<disk>/overview              the Overview page
//   #/<space>/<disk>/detail/<tab>          a Detail sub-tab
//
// Segments are percent-encoded, so a space or disk containing a slash round-trips.

/** Detail sub-tabs, in the order the tab bar shows them. */
export const DETAIL_TABS = [
  'treemap',
  'history',
  'detail-user',
  'permissions',
  'inodes',
] as const

export type DetailTab = (typeof DETAIL_TABS)[number]

export type Page = 'overview' | 'detail'

export interface Route {
  space: string | null
  disk: string | null
  page: Page
  tab: DetailTab
}

export const DEFAULT_ROUTE: Route = {
  space: null,
  disk: null,
  page: 'overview',
  tab: 'treemap',
}

function isDetailTab(value: string): value is DetailTab {
  return (DETAIL_TABS as readonly string[]).includes(value)
}

/**
 * Parse a hash into a route.
 *
 * Unknown or malformed input degrades to whatever is understandable rather than
 * throwing: a link to a tab that no longer exists should still land on the right
 * disk, and an unparseable hash should show the default view.
 */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  if (raw === '') return DEFAULT_ROUTE

  const parts = raw
    .split('/')
    .filter((p) => p.length > 0)
    .map((p) => {
      try {
        return decodeURIComponent(p)
      } catch {
        // A stray % makes decodeURIComponent throw; the literal is closer to the
        // user's intent than dropping the segment.
        return p
      }
    })

  const space = parts[0] ?? null
  const disk = parts[1] ?? null
  const pageSeg = parts[2]
  const tabSeg = parts[3]

  const page: Page = pageSeg === 'detail' ? 'detail' : 'overview'
  const tab: DetailTab = tabSeg !== undefined && isDetailTab(tabSeg) ? tabSeg : DEFAULT_ROUTE.tab

  return { space, disk, page, tab }
}

/** Build the hash for a route. Inverse of parseHash for every reachable route. */
export function buildHash(route: Route): string {
  const seg = (s: string): string => encodeURIComponent(s)
  if (!route.space) return '#/'
  if (!route.disk) return `#/${seg(route.space)}`
  if (route.page === 'overview') return `#/${seg(route.space)}/${seg(route.disk)}/overview`
  return `#/${seg(route.space)}/${seg(route.disk)}/detail/${route.tab}`
}

/** Read the current route from the address bar. */
export function currentRoute(): Route {
  return parseHash(window.location.hash)
}

/**
 * Write a route to the address bar.
 *
 * Uses replaceState rather than assigning location.hash so that switching tabs
 * does not fill the back button with intermediate states — legacy behaved the same
 * way, and a back button that steps through every tab click is worse than useless.
 */
export function writeRoute(route: Route): void {
  const next = buildHash(route)
  if (next === window.location.hash) return
  window.history.replaceState(null, '', next)
}

/** Push a route as a new history entry, for navigation the user should be able to undo. */
export function pushRoute(route: Route): void {
  const next = buildHash(route)
  if (next === window.location.hash) return
  window.history.pushState(null, '', next)
}
