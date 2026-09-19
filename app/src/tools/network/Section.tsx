import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SectionProps {
  /** Rendered as the small uppercase rule the spec draws: `ENDPOINT`, `FRAMING`. */
  title: string
  /** Right-aligned controls that belong to the section header. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * One labelled group of the Network panel (UX_SPEC 3.8).
 *
 * The spec's ASCII mock-up is a sequence of titled blocks; this makes each one
 * a real `<section>` with an accessible name, so a screen reader hears
 * "Framing, group" rather than a flat run of inputs.
 */
export function Section({ title, actions, children, className }: SectionProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-field', className)}>
      <div className="flex min-h-control-xs items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-2xs font-medium tracking-wide text-text-tertiary uppercase"
        >
          {title}
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
