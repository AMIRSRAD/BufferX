import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

export interface SecretInputProps {
  /** Memory-only. Never persisted, never logged, never put in a URL. */
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Legal byte length. Drives the live length badge and the warn border. */
  expectedBytes?: number
  /** Hex material (keys, PIN blocks) vs. digits/text (a clear PIN). Default true. */
  hex?: boolean
  autoFocus?: boolean
  /** Every legal byte length, when more than one is allowed: `[8, 16, 24]`. */
  acceptedByteLengths?: readonly number[]
  label?: string
  id?: string
  disabled?: boolean
  /**
   * Key check value chip. Supplied by the caller (the engine computes it) —
   * §4.25: a secret input has no copy button; the KCV is what gets copied.
   */
  kcv?: ReactNode
  className?: string
  containerClassName?: string
  onBlur?: () => void
}

/** §4.25: reveal relocks itself after 15 seconds. */
const REVEAL_SECONDS = 15

/**
 * The banking-specific control (DESIGN_SYSTEM.md §4.25).
 *
 * Hard invariants, enforced here rather than by convention:
 * - The value exists in exactly one place — this input's own `value`
 *   attribute. It is never written into a `title`, `aria-label`, `data-*`,
 *   placeholder, tooltip, or log line.
 * - No `name`, so nothing can serialize it into a form body or query string.
 * - Autofill, autocomplete, spellcheck, and password managers are all opted out.
 * - There is no copy button. Copy the KCV instead.
 */
export function SecretInput({
  value,
  onValueChange,
  placeholder,
  expectedBytes,
  hex = true,
  autoFocus,
  acceptedByteLengths,
  label,
  id,
  disabled,
  kcv,
  className,
  containerClassName,
  onBlur,
}: SecretInputProps) {
  const reactId = useId()
  const inputId = id ?? `secret-${reactId}`
  const helpId = `${inputId}-help`

  const inputRef = useRef<HTMLInputElement | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [remaining, setRemaining] = useState(REVEAL_SECONDS)

  const relock = useCallback(() => {
    setRevealed(false)
    setRemaining(REVEAL_SECONDS)
  }, [])

  // Auto-relock, plus relock on window blur / tab hide / unmount.
  useEffect(() => {
    if (!revealed) return
    setRemaining(REVEAL_SECONDS)
    const tick = window.setInterval(() => {
      setRemaining((s) => {
        if (s <= 1) {
          window.clearInterval(tick)
          setRevealed(false)
          return REVEAL_SECONDS
        }
        return s - 1
      })
    }, 1000)
    const onHide = () => relock()
    window.addEventListener('blur', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('blur', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [revealed, relock])

  useEffect(() => relock, [relock])

  const nibbles = value.length
  const bytes = hex ? Math.floor(nibbles / 2) : nibbles
  const oddNibble = hex && nibbles % 2 === 1

  const legal = acceptedByteLengths ?? (expectedBytes !== undefined ? [expectedBytes] : undefined)
  const lengthOk = legal ? legal.includes(bytes) && !oddNibble : !oddNibble
  const showLengthState = legal !== undefined || oddNibble

  const unit = hex ? 'bytes' : 'digits'
  const badge = legal ? `${bytes} / {${legal.join(', ')}} ${unit}` : `${bytes} ${unit}`
  const help = legal
    ? `Accepted: ${legal.join(', ')} ${unit}.${oddNibble ? ' Odd nibble count.' : ''}`
    : oddNibble
      ? 'Odd nibble count — hex needs whole bytes.'
      : undefined

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {(label || revealed) && (
        <div className="flex items-center gap-2">
          {label && (
            <label htmlFor={inputId} className="text-xs text-text-secondary">
              {label}
            </label>
          )}
          {revealed && (
            <span className="inline-flex h-4 items-center gap-1 rounded-sm border border-warn-border bg-warn-bg px-1.5 text-2xs font-medium text-warn">
              REVEALED
              <span className="font-mono tabular-nums">{remaining}s</span>
            </span>
          )}
        </div>
      )}

      <div
        data-sensitive="true"
        className={cn(
          'flex h-control-sm w-full items-center gap-1.5 rounded-sm border px-2',
          'transition-colors duration-fast ease-standard motion-reduce:transition-none',
          disabled ? 'border-border-subtle bg-surface-1' : 'bg-surface-2',
          !disabled &&
            (revealed
              ? 'border-warn'
              : showLengthState && !lengthOk && nibbles > 0
                ? 'border-warn'
                : 'border-border-strong'),
          !disabled && 'has-[input:focus-visible]:border-accent has-[input:focus-visible]:shadow-focus',
          containerClassName,
        )}
      >
        <input
          ref={inputRef}
          id={inputId}
          // No `name`: nothing can serialize this into a form body or a URL.
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode={hex ? 'text' : 'numeric'}
          data-sensitive="true"
          data-1p-ignore="true"
          data-lpignore="true"
          data-bwignore="true"
          aria-describedby={help ? helpId : undefined}
          className={cn(
            // Mono even while masked, so the visible dot count is the true length.
            'min-w-0 flex-1 bg-transparent font-mono text-mono-base tracking-wide text-text',
            'caret-accent outline-none placeholder:text-text-tertiary placeholder:not-italic',
            disabled && 'cursor-not-allowed text-text-disabled',
            className,
          )}
        />

        {kcv != null && (
          <span className="shrink-0 rounded-sm border border-border-subtle bg-surface-raised px-1 font-mono text-mono-xs text-text-secondary">
            {kcv}
          </span>
        )}

        {showLengthState && nibbles > 0 && (
          <span
            className={cn(
              'shrink-0 font-mono text-mono-xs tabular-nums',
              lengthOk ? 'text-ok' : 'text-warn',
            )}
          >
            {badge}
          </span>
        )}

        {value.length > 0 && !disabled && (
          <IconButton
            icon={X}
            size="xs"
            variant="ghost"
            label="Clear"
            tabIndex={-1}
            onClick={() => {
              onValueChange('')
              relock()
              inputRef.current?.focus()
            }}
          />
        )}

        <IconButton
          icon={revealed ? EyeOff : Eye}
          size="xs"
          variant="ghost"
          label={revealed ? `Hide value (relocks in ${remaining}s)` : 'Reveal value for 15 seconds'}
          aria-pressed={revealed}
          disabled={disabled ?? false}
          onClick={() => (revealed ? relock() : setRevealed(true))}
        />
      </div>

      {help && (
        <p id={helpId} className={cn('text-xs', lengthOk ? 'text-text-tertiary' : 'text-warn')}>
          {help}
        </p>
      )}
    </div>
  )
}
