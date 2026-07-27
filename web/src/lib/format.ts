// Display formatting. Binary units and the same 1 KB = 1024 B convention the
// legacy dashboard used, so numbers stay comparable between the two.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let i = 0
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024
    i += 1
  }
  const digits = value < 10 && i > 0 ? 2 : value < 100 && i > 0 ? 1 : 0
  return `${value.toFixed(digits)} ${UNITS[i]}`
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.trunc(n)))
}

export function formatPercent(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  return `${((part / whole) * 100).toFixed(1)}%`
}

/** Unix seconds to a compact local timestamp. 0 means "never scanned". */
export function formatTimestamp(unixSeconds: number): string {
  if (!unixSeconds) return '—'
  const d = new Date(unixSeconds * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** duscan stores snapshot dates as the integer yyyymmdd. */
export function formatScanDate(yyyymmdd: number): string {
  const s = String(yyyymmdd)
  if (s.length !== 8) return s
  return `${s.slice(4, 6)}/${s.slice(6, 8)}`
}
