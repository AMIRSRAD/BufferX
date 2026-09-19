import { cn } from '@/lib/cn'
import './ui.css'

export interface SpinnerProps {
  /** Rendered diameter in px. 14 inside buttons, 12 inside input suffixes. */
  size?: number
  /** Visual stroke width in px, independent of `size`. */
  strokeWidth?: number
  className?: string
}

/**
 * Indeterminate progress ring — 900ms linear per DESIGN_SYSTEM.md §4.1.
 *
 * Under `prefers-reduced-motion` the rotation stops and the ring stays
 * visible as a static arc (§5.4); callers pair it with `aria-busy` and a
 * text label so nothing is conveyed by the animation alone.
 */
export function Spinner({ size = 14, strokeWidth = 1.5, className }: SpinnerProps) {
  return (
    <svg
      className={cn('bx-spinner shrink-0 animate-spin', className)}
      style={{ width: size, height: size, animationDuration: '900ms' }}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth={strokeWidth} opacity={0.25} />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  )
}
