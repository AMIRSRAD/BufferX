import * as PopoverPrimitive from '@radix-ui/react-popover'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import type { Align, Side } from './Tooltip'
import './ui.css'

export interface PopoverProps {
  /** The element that opens the popover. Rendered `asChild`, so pass one element. */
  trigger: ReactNode
  children: ReactNode
  align?: Align
  side?: Side
  sideOffset?: number
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Turn off the default `p-panel` when the content brings its own chrome. */
  padded?: boolean
  className?: string
}

/**
 * Radix Popover (DESIGN_SYSTEM.md §4.16).
 *
 * A popover holds at most one task. Multi-task surfaces (PIN, MAC, TLV) are
 * docked panels — that is the whole point of the rewrite.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  sideOffset = 6,
  open,
  onOpenChange,
  padded = true,
  className,
}: PopoverProps) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          collisionPadding={12}
          className={cn(
            'bx-anim-layer z-50 flex min-w-72 flex-col overflow-hidden',
            'rounded-md border border-border bg-surface-3 text-sm text-text shadow-e2',
            padded && 'p-panel',
            className,
          )}
          style={{
            maxWidth: 'min(92vw, 34rem)',
            maxHeight: 'min(70vh, 34rem)',
          }}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
