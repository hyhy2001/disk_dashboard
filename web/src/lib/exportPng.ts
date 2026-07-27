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

/** Minimal stand-ins for the stylesheet rules the charts depend on. */
const INLINE_CSS = `
  text { font-family: -apple-system, system-ui, sans-serif; }
  .chart__grid { stroke-width: 1; }
  .chart__line { fill: none; stroke-width: 2; stroke-linejoin: round; }
  .chart__ref { stroke-dasharray: 3 3; stroke-width: 1; }
  .tile__name { font-size: 11px; font-weight: 600; fill: #fff; }
  .tile__size { font-size: 10px; fill: rgba(255,255,255,0.85); }
`

function resolveVars(svg: SVGSVGElement, source: Element): void {
  const computed = getComputedStyle(source)
  const map = new Map<string, string>()
  for (const name of TOKENS) {
    const value = computed.getPropertyValue(name).trim()
    if (value) map.set(name, value)
  }

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
    for (const attr of ['fill', 'stroke', 'font-family']) {
      const raw = el.getAttribute(attr)
      if (raw?.includes('var(')) el.setAttribute(attr, resolve(raw))
    }
    const style = el.getAttribute('style')
    if (style?.includes('var(')) el.setAttribute('style', resolve(style))
  }
}

/**
 * Rasterise `svg` and trigger a download. `scale` oversamples so the PNG is
 * usable in a document rather than looking like a screenshot.
 */
export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  scale = 2,
): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  resolveVars(clone, svg)

  const box = svg.getBoundingClientRect()
  const vb = svg.viewBox.baseVal
  const width = Math.round(vb.width || box.width)
  const height = Math.round(vb.height || box.height)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = INLINE_CSS
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
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  // Charts are drawn on a transparent background; fill it so the PNG is
  // readable when dropped into a light-background document.
  ctx.fillStyle = getComputedStyle(svg).getPropertyValue('--bg-raised').trim() || '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}
