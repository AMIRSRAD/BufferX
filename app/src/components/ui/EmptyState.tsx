import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  /** One line, sentence case. §7 rule 10: name the input and the next action. */
  title: ReactNode
  description?: ReactNode
  /** The primary action button. */
  action?: ReactNode
  /** Keyboard hint below the action — `Ctrl+Enter to decode`. */
  hint?: ReactNode
  className?: string
}

/** DESIGN_SYSTEM.md §4.22. Centred, `max-width: 26rem`, `py-10`. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  hint,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-104 flex-col items-center gap-3 px-4 py-10 text-center',
        className,
      )}
    >
      {Icon && (
        <Icon
          size={24}
          strokeWidth={1.5}
          absoluteStrokeWidth
          className="text-text-tertiary"
          aria-hidden="true"
        />
      )}
      <h2 className="text-xl text-text">{title}</h2>
      {description != null && <p className="text-base text-text-secondary">{description}</p>}
      {action != null && <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{action}</div>}
      {hint != null && <p className="text-xs text-text-tertiary">{hint}</p>}
    </div>
  )
}
