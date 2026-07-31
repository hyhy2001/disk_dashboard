// HTML5 History routing (no hash).
//
// The server serves index.html for every non-API path, so a real URL like
// /my-space/<slug>/detail/treemap works on reload without any proxy config.
//
// Shape:
//   /                                        nothing selected
//   /<space>                                 a space, no disk
//   /<space>/<slug>/overview                 the Overview page
//   /<space>/<slug>/detail/<tab>             a Detail sub-tab
//
// The disk segment is the disk's globally-unique random hex slug (from the admin
// DB), not its display name, so duplicate names across spaces can never collide
// in the URL. Segments are percent-encoded.

/** Detail sub-tabs, in the order the tab bar shows them. */
export const DETAIL_TABS = ['treemap', 'history', 'detail-user', 'permissions', 'inodes'] as const

export type DetailTab = (typeof DETAIL_TABS)[number]

export type Page = 'overview' | 'detail' | 'admin'

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

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Parse the current pathname into a route.
 *
 * Unknown or malformed input degrades to whatever is understandable rather than
 * throwing: a link to a tab that no longer exists should still land on the right
 * disk, and an unparseable path should show the default view.
 */
export function parsePath(pathname: string): Route {
  const raw = pathname.replace(/^\/+/, '')
  if (raw === '') return DEFAULT_ROUTE
  if (raw === 'admin' || raw.startsWith('admin/')) {
    return { space: null, disk: null, page: 'admin', tab: DEFAULT_ROUTE.tab }
  }

  const parts = raw
    .split('/')
    .filter((p) => p.length > 0)
    .map(decodeSeg)

  const space = parts[0] ?? null
  const disk = parts[1] ?? null
  const pageSeg = parts[2]
  const tabSeg = parts[3]

  const page: Page = pageSeg === 'detail' ? 'detail' : pageSeg === 'admin' ? 'admin' : 'overview'
  const tab: DetailTab = tabSeg !== undefined && isDetailTab(tabSeg) ? tabSeg : DEFAULT_ROUTE.tab

  return { space, disk, page, tab }
}

/** Build the path for a route. Inverse of parsePath. */
export function buildPath(route: Route): string {
  const seg = (s: string): string => encodeURIComponent(s)
  if (route.page === 'admin') return '/admin'
  if (!route.space) return '/'
  if (!route.disk) return `/${seg(route.space)}`
  if (route.page === 'overview') return `/${seg(route.space)}/${seg(route.disk)}/overview`
  return `/${seg(route.space)}/${seg(route.disk)}/detail/${route.tab}`
}

/** Read the current route from the address bar. */
export function currentRoute(): Route {
  return parsePath(window.location.pathname)
}

/**
 * Write a route to the address bar.
 *
 * Uses replaceState rather than pushState so that switching tabs does not fill
 * the back button with intermediate states.
 */
export function writeRoute(route: Route): void {
  const next = buildPath(route)
  if (next === window.location.pathname) return
  window.history.replaceState(null, '', next)
}

/** Push a route as a new history entry, for navigation the user can undo. */
export function pushRoute(route: Route): void {
  const next = buildPath(route)
  if (next === window.location.pathname) return
  window.history.pushState(null, '', next)
}
