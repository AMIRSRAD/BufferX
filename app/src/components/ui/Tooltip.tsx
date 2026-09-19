import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import './ui.css'

export type Side = 'top' | 'right' | 'bottom' | 'left'
export type Align = 'start' | 'center' | 'end'

interface TooltipOwnProps {
  /** Short prose. Never interactive, never the only copy of information, never a secret. */
  content: ReactNode
  side?: Side
  align?: Align
  /** ms before opening. §4.15: 400ms in, 0ms when moving within a group. */
  delayDuration?: number
  className?: string
  children: ReactNode
}

/**
 * Extra props are forwarded to the trigger element, so a Tooltip can sit
 * inside another primitive's `asChild` slot without swallowing its handlers.
 *
 * NOTE: this type carries an index signature, so `Tooltip` must NOT be wrapped
 * in `forwardRef` — `PropsWithoutRef` applies `Omit<P, 'ref'>`, and `Omit` over
 * an index signature collapses every declared prop back to `unknown`. Radix
 * needs a ref on the trigger, not on this wrapper, so there is nothing to
 * forward: the ref travels through `rest`/`cloneElement` below instead.
 */
export type TooltipProps = TooltipOwnProps & Record<string, unknown>

/**
 * Optional app-level provider. Mounting one at the root makes moving between
 * neighbouring tooltips instant (§4.15); each `Tooltip` also carries its own
 * provider so a primitive is never broken by a missing ancestor.
 */
export function TooltipProvider({
  children,
  delayDuration = 400,
  skipDelayDuration = 300,
}: {
  children: ReactNode
  delayDuration?: number
  skipDelayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      disableHoverableContent
    >
      {children}
    </TooltipPrimitive.Provider>
  )
}

/** DESIGN_SYSTEM.md §4.15. `surface-3`, `e2`, no arrow, 400ms in / 100ms out. */
export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  delayDuration = 400,
  className,
  children,
  ...rest
}: TooltipProps) {
  const trigger =
    Object.keys(rest).length > 0 && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, { ...rest })
      : children

  // A tooltip with nothing to say is not a tooltip.
  if (content === null || content === undefined || content === '' || content === false) {
    return <>{trigger}</>
  }

  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={300} disableHoverableContent>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={12}
            className={cn(
              'bx-anim-layer z-50 max-w-88 rounded-sm border border-border bg-surface-3',
              'px-2 py-1 text-xs text-text shadow-e2',
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
