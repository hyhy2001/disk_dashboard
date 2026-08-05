// Usage band thresholds, shared by every surface that colours a disk by how full
// it is. Keeping them in one module is what keeps the Inodes tab, the Compare
// view and the disk column from disagreeing on when "warning" starts.

/** Usage fraction (0–100) at which a disk flips to amber. */
export const WARM_USAGE = 70

/** Usage fraction (0–100) at which a disk flips to rose. */
export const HOT_USAGE = 85

export type UsageTone = 'healthy' | 'warning' | 'critical'

/** Band a usage percentage falls into, against the shared thresholds. */
export function usageTone(pct: number): UsageTone {
  if (pct >= HOT_USAGE) return 'critical'
  if (pct >= WARM_USAGE) return 'warning'
  return 'healthy'
}
