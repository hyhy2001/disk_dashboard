// Axis label spacing, measured in pixels rather than in data points.
//
// Both charts used to decide how many labels to draw from the size of the data:
// the timeline drew one label per point up to eight, and the user chart always
// drew its five size ticks. Neither asked how much room a label actually needs,
// so on a phone the timeline's six dates merged into one unreadable run
// ("07/2907/3007/31…") and the bar chart's size ticks overlapped by 30px of
// their 48px width. The fix is to derive the label count from the available
// pixels, which is what these helpers do.

/**
 * Width of a label at the 12px axis font, in px.
 *
 * An estimate, not a measurement: laying out text to measure it would mean a
 * second render pass, and the axis font is `tabular-nums` for exactly the
 * figures that matter here, so a per-character advance is accurate to within a
 * pixel. 7px/char matches the measured 35px of "07/29" and 48px of "27.5 GB".
 */
const CHAR_PX = 7

/** Clear space to keep between neighbouring labels. */
const GAP_PX = 8

export function estimateLabelWidth(text: string): number {
  return text.length * CHAR_PX
}

/** The widest of several labels, in px. */
export function widestLabel(labels: readonly string[]): number {
  return labels.reduce((max, l) => Math.max(max, estimateLabelWidth(l)), 0)
}

/**
 * Draw every Nth label so neighbours never touch.
 *
 * `count` evenly spaced labels span `spanPx`; the result is the stride to step
 * through them with. Always at least 1, so a caller that ignores the result
 * still renders something.
 */
export function labelStride(count: number, spanPx: number, labelPx: number): number {
  if (count <= 1) return 1
  const pitch = spanPx / (count - 1)
  if (pitch <= 0) return count
  return Math.max(1, Math.ceil((labelPx + GAP_PX) / pitch))
}

/**
 * Keep a centre-anchored label inside [min, max].
 *
 * The timeline's first date sat at the plot's left edge with `text-anchor:
 * middle`, so half of it fell at a negative x and `.chart { overflow: hidden }`
 * shaved it off — "07/29" rendered as "7/29" at every width. Nudging the label
 * in is better than widening the plot's gutter, which would cost chart area at
 * exactly the widths that have none to spare.
 */
export function clampLabelCentre(centre: number, labelPx: number, min: number, max: number): number {
  const half = labelPx / 2
  // Narrower than the label: centring is the least-bad option, and the caller's
  // own clipping decides the rest.
  if (max - min < labelPx) return (min + max) / 2
  return Math.min(max - half, Math.max(min + half, centre))
}

/**
 * Which of the quarter ticks [0, ¼, ½, ¾, 1] to label at a given width.
 *
 * Thinning by stride would drop the top tick (stride 3 over five ticks keeps 0
 * and ¾, not 1), and the top tick is the one carrying the axis maximum. So the
 * subsets are fixed and always keep both ends.
 */
export function quarterTicks(spanPx: number, labelPx: number): readonly number[] {
  const fits = Math.floor(spanPx / (labelPx + GAP_PX)) + 1
  if (fits >= 5) return [0, 0.25, 0.5, 0.75, 1]
  if (fits >= 3) return [0, 0.5, 1]
  return [0, 1]
}
