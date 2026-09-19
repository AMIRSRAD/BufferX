import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'
import './ui.css'

export type DialogSize = 'sm' | 'md' | 'lg' | 'full'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** One line under the title. Confirmations must state the exact scope. §4.17. */
  description?: ReactNode
  /** Right-aligned action row. Buttons are verbs: `Discard 12 edits` / `Keep editing`. */
  footer?: ReactNode
  children?: ReactNode
  size?: DialogSize
  className?: string
  bodyClassName?: string
}

const SIZE: Record<Exclude<DialogSize, 'full'>, string> = {
  sm: 'max-w-88',
  md: 'max-w-128',
  lg: 'max-w-184',
}

/**
 * DESIGN_SYSTEM.md §4.17.
 *
 * Initial focus lands on the first input, or the least destructive control —
 * Radix's default focus-first-tabbable does this as long as the footer orders
 * `[Cancel] [Primary]`, which the spec mandates.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  size = 'md',
  className,
  bodyClassName,
}: DialogProps) {
  const full = size === 'full'

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'bx-anim-scrim fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-scrim p-4',
          )}
        >
          <DialogPrimitive.Content
            // With no Description, tell Radix that on purpose so it does not
            // warn and does not point at a node that never renders.
            {...(description ? {} : { 'aria-describedby': undefined })}
            className={cn(
              'bx-anim-dialog relative flex w-full flex-col overflow-hidden',
              'rounded-lg border border-border bg-surface-3 shadow-e3',
              !full && SIZE[size],
              className,
            )}
            style={
              full
                ? { width: 'min(92vw, 76rem)', height: 'min(88vh, 52rem)' }
                : { maxHeight: 'min(88vh, 52rem)' }
            }
          >
            <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DialogPrimitive.Title className="text-lg text-text">{title}</DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="text-xs text-text-tertiary">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              <IconButton
                icon={X}
                size="sm"
                variant="ghost"
                label="Close"
                className="-mr-1"
                onClick={() => onOpenChange(false)}
              />
            </div>

            <div className={cn('min-h-0 flex-1 overflow-y-auto p-4 text-base', bodyClassName)}>
              {children}
            </div>

            {footer != null && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
                {footer}
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
