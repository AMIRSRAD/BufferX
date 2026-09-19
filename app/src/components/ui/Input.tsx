import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ControlSize } from './Button'

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'prefix'> {
  value: string
  onValueChange: (value: string) => void
  size?: ControlSize
  /** Mono + tabular figures + slashed zero, for anything whose column position matters. */
  mono?: boolean
  invalid?: boolean
  /** Leading affordance — a unit, a sigil, a small glyph. */
  prefix?: ReactNode
  /** Trailing affordance — unit, byte count, `12/19`, an action. §4.2 requires a unit on every numeric input. */
  suffix?: ReactNode
  /** Applied to the bordered shell rather than the `<input>` itself. */
  containerClassName?: string
}

const HEIGHT: Record<ControlSize, string> = {
  xs: 'h-control-xs',
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
}

const TEXT: Record<ControlSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    value,
    onValueChange,
    size = 'sm',
    mono = false,
    invalid = false,
    prefix,
    suffix,
    className,
    containerClassName,
    disabled,
    readOnly,
    ...rest
  },
  ref,
) {
  return (
    <div
      data-disabled={disabled ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      className={cn(
        'relative flex w-full items-center gap-1.5 rounded-sm border px-2',
        'transition-colors duration-fast ease-standard motion-reduce:transition-none',
        HEIGHT[size],
        // Read-only results (a calculated MAC, a translated PIN block) are
        // valuable, not inert — they must not look disabled. §4.2.
        disabled
          ? 'border-border-subtle bg-surface-1'
          : readOnly
            ? 'border-border bg-surface-1'
            : 'bg-surface-2',
        !disabled && !readOnly && (invalid ? 'border-error' : 'border-border-strong'),
        !disabled &&
          'has-[input:focus-visible]:border-accent has-[input:focus-visible]:shadow-focus',
        containerClassName,
      )}
    >
      {prefix != null && (
        <span className="shrink-0 text-2xs text-text-tertiary select-none">{prefix}</span>
      )}

      <input
        ref={ref}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-text caret-accent outline-none',
          'placeholder:text-text-tertiary placeholder:not-italic',
          mono ? 'font-mono text-mono-base' : TEXT[size],
          disabled && 'cursor-not-allowed text-text-disabled',
          className,
        )}
        {...rest}
      />

      {invalid && (
        <AlertTriangle
          size={14}
          strokeWidth={1.25}
          absoluteStrokeWidth
          className="shrink-0 text-error"
          aria-hidden="true"
        />
      )}

      {suffix != null && (
        <span className="flex shrink-0 items-center gap-1 text-2xs text-text-tertiary select-none">
          {suffix}
        </span>
      )}
    </div>
  )
})
