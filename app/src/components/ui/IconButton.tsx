import { forwardRef, type ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, ICON_PX, ICON_STROKE, type ButtonVariant, type ControlSize } from './Button'
import { Tooltip, type Side } from './Tooltip'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'prefix' | 'children'> {
  icon: LucideIcon
  /**
   * Required. Becomes both `aria-label` and the tooltip text — §6.1 forbids an
   * icon-only button that has one without the other.
   */
  label: string
  size?: ControlSize
  variant?: ButtonVariant
  loading?: boolean
  /** Set false when the button already sits inside a labelled tooltip group. */
  tooltip?: boolean
  tooltipSide?: Side
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'sm', variant = 'ghost', loading, tooltip = true, tooltipSide = 'top', className, ...rest },
  ref,
) {
  const button = (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      loading={loading ?? false}
      aria-label={label}
      className={cn('aspect-square px-0', className)}
      {...rest}
    >
      {!loading && (
        <Icon
          size={ICON_PX[size]}
          strokeWidth={ICON_STROKE[size]}
          absoluteStrokeWidth
          aria-hidden="true"
        />
      )}
    </Button>
  )

  if (!tooltip) return button
  return (
    <Tooltip content={label} side={tooltipSide}>
      {button}
    </Tooltip>
  )
})
