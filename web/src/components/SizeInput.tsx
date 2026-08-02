// Size filter: a number plus a unit.
//
// Bytes are what the API wants, but nobody types 5368709120. The unit select
// carries the multiplier so the pair converts to bytes on change, and the raw
// number stays as typed — parsing on every keystroke would fight the user while
// they type "1" on the way to "10".

const UNITS: { label: string; bytes: number }[] = [
  { label: 'B', bytes: 1 },
  { label: 'KB', bytes: 1024 },
  { label: 'MB', bytes: 1024 ** 2 },
  { label: 'GB', bytes: 1024 ** 3 },
  { label: 'TB', bytes: 1024 ** 4 },
]

export interface SizeValue {
  /** Raw text, so an in-progress entry is never rewritten. */
  amount: string
  /** Unit label, matching one of UNITS. */
  unit: string
}

export const EMPTY_SIZE: SizeValue = { amount: '', unit: 'MB' }

/** Convert to bytes, or undefined when nothing usable was entered. */
export function toBytes(value: SizeValue): number | undefined {
  const n = Number(value.amount)
  if (value.amount.trim() === '' || !Number.isFinite(n) || n <= 0) return undefined
  const unit = UNITS.find((u) => u.label === value.unit) ?? UNITS[2]
  return Math.round(n * (unit?.bytes ?? 1))
}

interface Props {
  id: string
  label: string
  value: SizeValue
  onChange: (value: SizeValue) => void
  onSubmit?: () => void
}

export function SizeInput({ id, label, value, onChange, onSubmit }: Props): JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[12px] text-muted-foreground shrink-0" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center gap-0.5">
        <input
          id={id}
          type="number"
          min="0"
          className="h-6 w-20 rounded-sm border border-border bg-background px-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="0"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
        <select
          className="h-6 rounded-sm border border-border bg-background px-1.5 text-[12px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label={`${label} unit`}
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value })}
        >
          {UNITS.map((u) => (
            <option key={u.label} value={u.label}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
