import { useCallback, useRef } from 'react'

interface Props {
  id: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  className?: string
}

export function splitTerms(value: string): string[] {
  return value
    .split(/[,\t\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

/** Terms that have been committed (followed by , or \t). The last uncommitted part is excluded. */
function committedTerms(value: string): string[] {
  const parts = value.split(/[,\t\n]/)
  const endsWithSep = /[,\t\n]$/.test(value)
  return (endsWithSep ? parts : parts.slice(0, -1)).map((p) => p.trim()).filter((p) => p.length > 0)
}

export function TagInput({ id, label, placeholder, value, onChange, onSubmit, className }: Props): JSX.Element {
  const chips = committedTerms(value)
  const currentInput = value.split(/[,\t\n]/).pop() ?? ''
  const inputRef = useRef<HTMLInputElement>(null)

  const drop = useCallback(
    (term: string) => {
      const remaining = chips.filter((c) => c !== term)
      onChange(remaining.length > 0 ? remaining.join(', ') + ', ' : '')
      inputRef.current?.focus()
    },
    [chips, onChange],
  )

  const handleChange = useCallback(
    (newCurrent: string) => {
      const prefix = chips.length > 0 ? chips.join(', ') + ', ' : ''
      onChange(prefix + newCurrent)
    },
    [chips, onChange],
  )

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <label className="text-[12px] text-muted-foreground shrink-0" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center flex-wrap gap-0.5 min-h-6 w-full rounded-sm border border-border bg-background px-2 py-0.5 text-[13px] focus-within:ring-1 focus-within:ring-ring">
        {chips.map((c) => (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors shrink-0 cursor-pointer"
            key={c}
            onClick={() => drop(c)}
            aria-label={`Remove "${c}"`}
          >
            {c} ✕
          </button>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="flex-1 min-w-[60px] h-5 border-0 bg-transparent p-0 text-[13px] placeholder:text-muted-foreground outline-none"
          placeholder={chips.length > 0 ? '' : placeholder}
          value={currentInput}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
            if (e.key === 'Tab') {
              // Only swallow Tab when there is a term to commit; with an empty
              // input, Tab must move focus on as usual.
              const trimmed = currentInput.trim()
              if (trimmed) {
                e.preventDefault()
                handleChange(`${trimmed}, `)
              }
            }
            if (e.key === 'Backspace' && currentInput.trim() === '' && chips.length > 0) {
              onChange(chips.slice(0, -1).join(', ') + (chips.length > 1 ? ', ' : ''))
            }
          }}
        />
      </div>
    </div>
  )
}
