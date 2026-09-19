import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface KbdProps {
  children: ReactNode
  className?: string
}

/** A key cap. Used in footers, tooltips, menu rows, and empty-state hints. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-xs',
        'border border-border-strong bg-surface-2 px-1',
        'text-2xs leading-none text-text-secondary shadow-e1',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
