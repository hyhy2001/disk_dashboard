// Save an on-screen SVG chart as a PNG.
//
// Legacy could just call canvas.toDataURL() because Chart.js draws to a canvas.
// These charts are SVG, so the export goes SVG → data URL → <img> → canvas →
// PNG. Two things make that non-trivial:
//
//   1. CSS custom properties. The markup says fill="var(--accent)", which means
//      nothing once the node leaves the document, so every var() is resolved to
//      a literal colour first.
//   2. External styles. Rules from the stylesheet do not travel with a cloned
//      node, so the classes we rely on are inlined as an explicit <style> block.

/** Longest canvas side (px) that browsers reliably rasterise without bailing. */
const MAX_PX = 4096

/**
 * Oversample factor that keeps the rasterised PNG within canvas size limits.
 * A huge treemap at scale 2 can exceed what the canvas will allocate; dropping
 * the scale keeps the export working at the cost of some sharpness.
 */
export function effectiveScale(width: number, height: number, scale: number, maxPx = MAX_PX): number {
  const largest = Math.max(width, height, 1)
  return Math.min(scale, maxPx / largest)
}

/** Token values that appear in chart markup, resolved against the live theme. */
const TOKENS = [
  '--accent',
  '--accent-hover',
  '--text',
  '--text-muted',
  '--text-faint',
  '--bg-base',
  '--bg-raised',
  '--bg-hover',
  '--border',
  '--border-strong',
  '--grid-line',
  '--amber-400',
  '--rose-400',
  '--sky-400',
  '--violet-400',
  '--emerald-500',
  '--series-1',
  '--series-2',
  '--series-3',
  '--series-4',
  '--series-5',
  '--series-6',
  '--font-mono',
]

/**
 * Stand-ins for the stylesheet rules the charts depend on, with theme color
 * tokens resolved to literals. Rules like `.chart__axis { fill: var(--text-muted) }`
 * live in the page stylesheet and never travel with the clone; without them the
 * axis text and grid render black (invisible on the dark theme) once the SVG is
 * an isolated <img>.
 */
function inlineCss(map: Map<string, string>): string {
  const t = (name: string): string => map.get(name) ?? name
  return `
  text { font-family: -apple-system, system-ui, sans-serif; }
  .chart__grid { stroke: ${t('--border')}; stroke-width: 1; }
  .chart__axis { fill: ${t('--text-muted')}; }
  .chart__line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .chart__ref { stroke: ${t('--text-faint')}; stroke-dasharray: 3 3; stroke-width: 1; }
  .tile__name { font-size: 13px; font-weight: 600; fill: #fff; }
  .tile__size { font-size: 12px; fill: rgba(255,255,255,0.85); }
`
}

export function resolveVarsIn(svg: SVGSVGElement, map: Map<string, string>): void {
  // var() can nest (--accent: var(--emerald-500)), so resolve repeatedly until
  // stable rather than assuming one pass is enough.
  const resolve = (input: string): string => {
    let out = input
    for (let pass = 0; pass < 4 && out.includes('var('); pass += 1) {
      out = out.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name: string) => map.get(name) ?? whole)
    }
    return out
  }

  for (const el of svg.querySelectorAll('*')) {
    // stop-color carries var(--…) in the charts' gradient fills; leaving it
    // unresolved would render the gradient stops black once the SVG leaves the
    // page and the <img> has no custom-property scope to resolve against.
    for (const attr of ['fill', 'stroke', 'stop-color', 'font-family']) {
      const raw = el.getAttribute(attr)
      if (raw?.includes('var(')) el.setAttribute(attr, resolve(raw))
    }
    const style = el.getAttribute('style')
    if (style?.includes('var(')) el.setAttribute('style', resolve(style))
  }
}

/** Resolve var(--token) references against the live theme's computed values. */
function resolveVars(svg: SVGSVGElement, source: Element): Map<string, string> {
  const computed = getComputedStyle(source)
  const map = new Map<string, string>()
  for (const name of TOKENS) {
    const value = computed.getPropertyValue(name).trim()
    if (value) map.set(name, value)
  }
  resolveVarsIn(svg, map)
  return map
}

/**
 * Rasterise `svg` and trigger a download. `scale` oversamples so the PNG is
 * usable in a document rather than looking like a screenshot.
 */
export async function downloadSvgAsPng(svg: SVGSVGElement, filename: string, scale = 2): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const map = resolveVars(clone, svg)

  const box = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  const width = Math.round(vb.width || box.width)
  const height = Math.round(vb.height || box.height)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = inlineCss(map)
  clone.insertBefore(style, clone.firstChild)

  const markup = new XMLSerializer().serializeToString(clone)
  // encodeURIComponent rather than btoa: the markup may contain non-Latin1
  // characters (a directory name, a username) which btoa would throw on.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`

  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('could not rasterise chart'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  const effScale = effectiveScale(width, height, scale)
  canvas.width = Math.max(1, Math.round(width * effScale))
  canvas.height = Math.max(1, Math.round(height * effScale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  // Charts are drawn on a transparent background; fill it so the PNG is
  // readable when dropped into a light-background document.
  ctx.fillStyle = getComputedStyle(svg).getPropertyValue('--bg-raised').trim() || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  let dataUrl: string
  try {
    dataUrl = canvas.toDataURL('image/png')
  } catch {
    // A canvas too large for the browser throws here with no user-visible trace.
    throw new Error('chart is too large to export as a PNG')
  }

  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  // Safari refuses downloads on anchors that are not in the document.
  document.body.appendChild(link)
  link.click()
  link.remove()
}
