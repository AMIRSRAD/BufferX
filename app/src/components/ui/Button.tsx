import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type MouseEvent,
} from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Spinner } from './Spinner'

/** Control size ladder — maps to `--bx-control-h-*`, so it is density-aware. */
export type ControlSize = 'xs' | 'sm' | 'md' | 'lg'

/**
 * `default` is the design system's `secondary`; `subtle` is its `outline`.
 * (DESIGN_SYSTEM.md §4.1 variant table.)
 */
export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'subtle'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix'> {
  variant?: ButtonVariant
  size?: ControlSize
  /** Locks the width, swaps the leading icon for a spinner, sets aria-busy. */
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  fullWidth?: boolean
}

/**
 * Hover and active are gated behind `:not([aria-disabled="true"])` because a
 * disabled button here keeps its pointer events — §4.1 requires the
 * precondition tooltip to stay reachable, so `pointer-events: none` is banned.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: cn(
    'bg-accent text-accent-fg shadow-e1',
    'not-aria-disabled:hover:bg-accent-hover',
    'not-aria-disabled:active:bg-accent-active',
  ),
  default: cn(
    'border border-border-strong bg-surface-2 text-text shadow-e1',
    'not-aria-disabled:hover:bg-surface-raised',
    'not-aria-disabled:active:bg-surface-3',
  ),
  subtle: cn(
    'border border-border-subtle bg-transparent text-text',
    'not-aria-disabled:hover:border-border not-aria-disabled:hover:bg-surface-raised',
    'not-aria-disabled:active:bg-surface-2',
  ),
  ghost: cn(
    'bg-transparent text-text-secondary',
    'not-aria-disabled:hover:bg-surface-raised not-aria-disabled:hover:text-text',
    'not-aria-disabled:active:bg-surface-2',
  ),
  danger: cn(
    'border border-error-border bg-error-bg text-error',
    'not-aria-disabled:hover:border-error',
    'not-aria-disabled:active:bg-error-bg',
  ),
}

const SIZE: Record<ControlSize, string> = {
  xs: 'h-control-xs gap-1 px-1.5 text-xs',
  sm: 'h-control-sm gap-1.5 px-2.5 text-sm',
  md: 'h-control-md gap-1.5 px-3 text-sm',
  lg: 'h-control-lg gap-2 px-4 text-base',
}

/** §6.1: 14px glyphs inside xs/sm controls, 16px above. */
export const ICON_PX: Record<ControlSize, number> = { xs: 14, sm: 14, md: 16, lg: 16 }
/** §6.1: 1.25px visual stroke at 14px, 1.5px at 16px and above. */
export const ICON_STROKE: Record<ControlSize, number> = { xs: 1.25, sm: 1.25, md: 1.5, lg: 1.5 }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'default',
    size = 'sm',
    loading = false,
    icon: Icon,
    iconRight: IconRight,
    fullWidth = false,
    disabled,
    className,
    children,
    type,
    onClick,
    style,
    ...rest
  },
  forwardedRef,
) {
  const innerRef = useRef<HTMLButtonElement | null>(null)
  /** Last measured width while *not* loading — §4.1 locks it during load. */
  const restingWidth = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    if (!loading && innerRef.current) {
      restingWidth.current = innerRef.current.getBoundingClientRect().width
    }
  })

  const setRefs = (node: HTMLButtonElement | null) => {
    innerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }

  const isDisabled = Boolean(disabled) || loading
  const iconPx = ICON_PX[size]
  const iconStroke = ICON_STROKE[size]

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (isDisabled) {
      // The button is still focusable and still hoverable (so its precondition
      // tooltip works); it just must not act, and must not submit a form.
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onClick?.(event)
  }

  const lockedWidth = loading && restingWidth.current != null ? restingWidth.current : undefined

  return (
    <button
      ref={setRefs}
      type={type ?? 'button'}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-sm',
        'font-medium whitespace-nowrap select-none',
        'transition-colors duration-fast ease-standard motion-reduce:transition-none',
        SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        isDisabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      style={lockedWidth != null ? { ...style, width: lockedWidth } : style}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      data-loading={loading ? '' : undefined}
      onClick={handleClick}
      {...rest}
    >
      {/* WCAG 2.2 §2.5.8: a 22px dense control still needs a 24px target.
          Grow the hit area, never the visual box. */}
      {size === 'xs' && <span aria-hidden="true" className="absolute inset-x-0 -inset-y-px" />}

      {loading ? (
        <Spinner size={iconPx} />
      ) : Icon ? (
        <Icon size={iconPx} strokeWidth={iconStroke} absoluteStrokeWidth aria-hidden="true" />
      ) : null}

      {children}

      {IconRight && !loading && (
        <IconRight size={iconPx} strokeWidth={iconStroke} absoluteStrokeWidth aria-hidden="true" />
      )}
    </button>
  )
})
