// Width-aware label truncation for SVG tiles.
//
// A treemap tile's text budget is a pixel width. Measuring the DOM on every
// render is not worth it, so the width is estimated: narrow glyphs count one
// unit, wide (CJK / Hangul / full-width) glyphs two. Close enough to keep a
// name inside its tile without re-laying-out, and far better than the previous
// 8px-per-character guess that let CJK run over the edge.

/** Whether a single character renders roughly twice as wide as ASCII. */
export function isWide(ch: string): boolean {
  return /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch)
}

/** Approximate rendered width of a label, in narrow-character units. */
export function labelUnits(name: string): number {
  let w = 0
  for (const ch of name) w += isWide(ch) ? 2 : 1
  return w
}

/** Clip `name` to `maxUnits` narrow-character units, reserving one for "…". */
export function truncateLabel(name: string, maxUnits: number): string {
  if (labelUnits(name) <= maxUnits) return name
  let out = ''
  let w = 0
  for (const ch of name) {
    const cw = isWide(ch) ? 2 : 1
    if (w + cw > maxUnits - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}
