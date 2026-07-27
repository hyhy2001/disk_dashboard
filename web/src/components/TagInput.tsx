// Comma-or-tab separated filter input, rendered as chips.
//
// The value is kept as the raw string the user typed rather than as a parsed array:
// that way a half-typed term is never lost when the component re-renders, and the
// server does the splitting so client and server can never disagree about what a
// term is.

import { useCallback } from 'react'

interface Props {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  /** Submit on Enter, so a filter can be applied without reaching for the button. */
  onSubmit?: () => void
}

/** Split for display only; the raw string stays the source of truth. */
export function splitTerms(value: string): string[] {
  return value
    .split(/[,\t\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

export function TagInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
}: Props): JSX.Element {
  const chips = splitTerms(value)

  /** Remove one chip by rewriting the raw value from the remaining terms. */
  const drop = useCallback(
    (term: string) => {
      onChange(chips.filter((c) => c !== term).join(', '))
    },
    [chips, onChange],
  )

  return (
    <div className="taginput">
      <label className="taginput__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="taginput__field"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />
      {chips.length > 1 && (
        <div className="taginput__chips">
          {chips.map((c) => (
            <button
              type="button"
              className="chip chip--sm"
              key={c}
              onClick={() => drop(c)}
              data-tooltip={`Remove "${c}"`}
            >
              {c} <span aria-hidden="true">✕</span>
              <span className="sr-only">Remove {c}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
