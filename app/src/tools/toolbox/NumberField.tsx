import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'

export interface NumberFieldProps {
  value: number
  onValueChange: (value: number) => void
  min: number
  max: number
  /** Legal values. Stepping snaps to the next one; anything else is a warning. */
  allowed?: readonly number[]
  /** DESIGN_SYSTEM §4.2: every numeric input states its unit. */
  unit?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function snap(value: number, allowed: readonly number[] | undefined, direction: 1 | -1): number {
  if (!allowed || allowed.length === 0) return value
  const sorted = [...allowed].sort((a, b) => a - b)
  const candidate =
    direction === 1
      ? sorted.find((option) => option > value)
      : [...sorted].reverse().find((option) => option < value)
  if (candidate !== undefined) return candidate
  return direction === 1 ? (sorted[sorted.length - 1] ?? value) : (sorted[0] ?? value)
}

/**
 * The labelled parameter spinbox (UX_SPEC 3.7 `[ 3 ⇅ ]`).
 *
 * The draft is held as text while typing so the value can pass through an empty
 * or partial state (`""`, `"1"` on the way to `"16"`) without being clamped out
 * from under the caret. Clamping and snapping happen on blur and on the
 * stepper, never mid-keystroke.
 */
export function NumberField({
  value,
  onValueChange,
  min,
  max,
  allowed,
  unit,
  id,
  disabled = false,
  invalid = false,
  'aria-describedby': ariaDescribedBy,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(() => String(value))

  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)))
  }, [value])

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isNaN(parsed)) {
      setDraft(String(value))
      return
    }
    const next = clamp(parsed, min, max)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  const step = (direction: 1 | -1) => {
    const base = Number.parseInt(draft, 10)
    const from = Number.isNaN(base) ? value : base
    const next = allowed ? snap(from, allowed, direction) : clamp(from + direction, min, max)
    setDraft(String(next))
    if (next !== value) onValueChange(next)
  }

  return (
    <Input
      id={id}
      value={draft}
      onValueChange={(next) => {
        const cleaned = next.replace(/[^0-9]/g, '')
        setDraft(cleaned)
        const parsed = Number.parseInt(cleaned, 10)
        if (!Number.isNaN(parsed)) onValueChange(parsed)
      }}
      onBlur={() => commit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          step(1)
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          step(-1)
        }
      }}
      mono
      invalid={invalid}
      disabled={disabled}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-describedby={ariaDescribedBy}
      containerClassName="max-w-56"
      suffix={
        <span className="flex items-center gap-0.5">
          {unit && <span className="pr-0.5 text-2xs text-text-tertiary">{unit}</span>}
          <IconButton
            icon={Minus}
            size="xs"
            variant="ghost"
            label={`Decrease${unit ? ` ${unit}` : ''}`}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => step(-1)}
          />
          <IconButton
            icon={Plus}
            size="xs"
            variant="ghost"
            label={`Increase${unit ? ` ${unit}` : ''}`}
            tabIndex={-1}
            disabled={disabled}
            onClick={() => step(1)}
          />
        </span>
      }
    />
  )
}
