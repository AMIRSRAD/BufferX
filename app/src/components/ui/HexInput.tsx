import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from 'react'
import { cn } from '@/lib/cn'

export interface HexInputProps {
  /** Canonical value: uppercase hex, no separators. Grouping is presentational only. */
  value: string
  onValueChange: (value: string) => void
  /** Characters per visual group. 2 = byte pairs (default), 4 = PAN-style quads. */
  groupBy?: number
  /** When set, the counter reads `n / expected bytes` and tones ok/warn. */
  expectedBytes?: number
  showByteCount?: boolean
  invalid?: boolean
  label?: string
  id?: string
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
  containerClassName?: string
  'aria-describedby'?: string
  onBlur?: () => void
  onFocus?: () => void
}

const HEX_RE = /[0-9a-fA-F]/

export function normalizeHex(raw: string): string {
  let out = ''
  for (const ch of raw) if (HEX_RE.test(ch)) out += ch
  return out.toUpperCase()
}

export function groupHex(hex: string, groupBy: number): string {
  if (groupBy <= 0) return hex
  const parts: string[] = []
  for (let i = 0; i < hex.length; i += groupBy) parts.push(hex.slice(i, i + groupBy))
  return parts.join(' ')
}

/** Where caret position `n` in canonical hex lands in the grouped display string. */
function displayCaret(n: number, groupBy: number): number {
  if (groupBy <= 0 || n <= 0) return Math.max(0, n)
  return n + Math.floor((n - 1) / groupBy)
}

/**
 * The workhorse mono input (DESIGN_SYSTEM.md §4.4).
 *
 * - Invalid characters are rejected at input time with a one-frame error flash;
 *   they are never inserted and never raise a toast.
 * - Odd nibble counts are a **warning**, not an error: `n bytes + 1 nibble`.
 * - The byte counter is always present. This is the pre-flight length check.
 */
export function HexInput({
  value,
  onValueChange,
  groupBy = 2,
  expectedBytes,
  showByteCount = true,
  invalid = false,
  label,
  id,
  placeholder,
  disabled,
  readOnly,
  autoFocus,
  className,
  containerClassName,
  'aria-describedby': ariaDescribedBy,
  onBlur,
  onFocus,
}: HexInputProps) {
  const reactId = useId()
  const inputId = id ?? `hex-${reactId}`
  const countId = `${inputId}-count`

  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const [rejected, setRejected] = useState(false)

  const display = groupHex(value, groupBy)

  useLayoutEffect(() => {
    const el = inputRef.current
    const caret = pendingCaret.current
    if (!el || caret === null) return
    pendingCaret.current = null
    const pos = Math.min(displayCaret(caret, groupBy), el.value.length)
    el.setSelectionRange(pos, pos)
  }, [display, groupBy])

  useEffect(() => {
    if (!rejected) return
    const timer = window.setTimeout(() => setRejected(false), 160)
    return () => window.clearTimeout(timer)
  }, [rejected])

  const applyRaw = useCallback(
    (raw: string, caretInRaw: number) => {
      const before = raw.slice(0, caretInRaw)
      pendingCaret.current = normalizeHex(before).length

      // A separator the component itself rendered is not a rejected character.
      const illegal = raw.split('').some((ch) => !HEX_RE.test(ch) && !/\s/.test(ch))
      if (illegal) setRejected(true)

      const next = normalizeHex(raw)
      if (next !== value) onValueChange(next)
    },
    [onValueChange, value],
  )

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const el = event.target
    applyRaw(el.value, el.selectionStart ?? el.value.length)
  }

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const el = inputRef.current
    if (!el) return
    event.preventDefault()
    const pasted = event.clipboardData.getData('text')
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const raw = el.value.slice(0, start) + pasted + el.value.slice(end)
    applyRaw(raw, start + pasted.length)
  }

  const nibbles = value.length
  const bytes = Math.floor(nibbles / 2)
  const oddNibble = nibbles % 2 === 1
  const lengthMismatch = expectedBytes !== undefined && (bytes !== expectedBytes || oddNibble)

  let counter = `${bytes} bytes`
  if (expectedBytes !== undefined) counter = `${bytes} / ${expectedBytes} bytes`
  if (oddNibble) counter += ' + 1 nibble'

  const counterTone = oddNibble
    ? 'text-warn'
    : expectedBytes === undefined
      ? 'text-text-tertiary'
      : lengthMismatch
        ? 'text-warn'
        : 'text-ok'

  const describedBy = [ariaDescribedBy, showByteCount ? countId : undefined]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && (
        <label htmlFor={inputId} className="text-xs text-text-secondary">
          {label}
        </label>
      )}

      <div
        data-invalid={invalid ? '' : undefined}
        className={cn(
          'flex h-control-sm w-full items-center gap-2 rounded-sm border px-2',
          'transition-colors duration-fast ease-standard motion-reduce:transition-none',
          disabled ? 'border-border-subtle bg-surface-1' : readOnly ? 'border-border bg-surface-1' : 'bg-surface-2',
          !disabled &&
            !readOnly &&
            (invalid || rejected
              ? 'border-error'
              : oddNibble || lengthMismatch
                ? 'border-warn'
                : 'border-border-strong'),
          !disabled && 'has-[input:focus-visible]:border-accent has-[input:focus-visible]:shadow-focus',
          containerClassName,
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          value={display}
          onChange={handleChange}
          onPaste={handlePaste}
          onBlur={onBlur}
          onFocus={onFocus}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-mono text-mono-base text-text caret-accent outline-none',
            'placeholder:text-text-tertiary placeholder:not-italic',
            disabled && 'cursor-not-allowed text-text-disabled',
            className,
          )}
        />

        {showByteCount && (
          <span id={countId} className={cn('shrink-0 font-mono text-mono-xs tabular-nums', counterTone)}>
            {counter}
          </span>
        )}
      </div>
    </div>
  )
}
