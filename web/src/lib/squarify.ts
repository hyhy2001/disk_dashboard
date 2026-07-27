// Squarified treemap layout (Bruls, Huizing, van Wijk 2000).
//
// Naive slice-and-dice produces long thin slivers that are impossible to compare
// or click. Squarifying keeps rectangles near square by filling one row (or
// column, whichever is the shorter side) at a time and closing it as soon as
// adding another item would make the worst aspect ratio worse.
//
// Pure function over plain numbers so it can be unit-tested without a DOM.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface LayoutItem<T> extends Rect {
  item: T
  value: number
}

/** Worst (largest) aspect ratio in a row of areas laid along `side`. */
function worstRatio(areas: number[], side: number, sum: number): number {
  if (sum <= 0 || side <= 0) return Infinity
  let min = Infinity
  let max = 0
  for (const a of areas) {
    if (a < min) min = a
    if (a > max) max = a
  }
  const s2 = sum * sum
  const side2 = side * side
  return Math.max((side2 * max) / s2, s2 / (side2 * min))
}

/**
 * Lay out `items` inside `bounds`, areas proportional to `value(item)`.
 *
 * Items with value <= 0 are dropped: they have no area, and a zero-width
 * rectangle is not something the user can see or click. Callers that need to
 * show them must handle that separately.
 */
export function squarify<T>(
  items: T[],
  value: (item: T) => number,
  bounds: Rect,
): LayoutItem<T>[] {
  const entries = items
    .map((item) => ({ item, value: value(item) }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)

  if (entries.length === 0 || bounds.w <= 0 || bounds.h <= 0) return []

  const total = entries.reduce((s, e) => s + e.value, 0)
  const area = bounds.w * bounds.h
  // Work in pixel-area units so ratios compare directly against side lengths.
  const scaled = entries.map((e) => ({ ...e, area: (e.value / total) * area }))

  const out: LayoutItem<T>[] = []
  let x = bounds.x
  let y = bounds.y
  let w = bounds.w
  let h = bounds.h
  let i = 0

  while (i < scaled.length) {
    // Fill along the shorter side — that is what keeps tiles square.
    const side = Math.min(w, h)
    const row: typeof scaled = []
    let rowSum = 0

    // Grow the row while the worst aspect ratio keeps improving.
    while (i < scaled.length) {
      const next = scaled[i]
      if (!next) break
      const areas = row.map((r) => r.area)
      const current = row.length === 0 ? Infinity : worstRatio(areas, side, rowSum)
      const candidate = worstRatio([...areas, next.area], side, rowSum + next.area)
      if (row.length > 0 && candidate > current) break
      row.push(next)
      rowSum += next.area
      i += 1
    }

    // Thickness of the strip this row occupies, perpendicular to `side`.
    const thickness = side > 0 ? rowSum / side : 0
    const horizontal = w >= h

    let offset = 0
    for (const r of row) {
      const length = rowSum > 0 ? (r.area / rowSum) * side : 0
      out.push(
        horizontal
          ? { item: r.item, value: r.value, x, y: y + offset, w: thickness, h: length }
          : { item: r.item, value: r.value, x: x + offset, y, w: length, h: thickness },
      )
      offset += length
    }

    // Shrink the remaining box by the strip just placed.
    if (horizontal) {
      x += thickness
      w -= thickness
    } else {
      y += thickness
      h -= thickness
    }

    // Floating-point drift can leave a sliver that would loop forever.
    if (w < 0.5 || h < 0.5) break
  }

  return out
}
