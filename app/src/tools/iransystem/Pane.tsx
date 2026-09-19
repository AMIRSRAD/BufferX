import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface PaneProps {
  /** `INPUT (IranSystem, Hex)` — states the side and its representation. */
  label: string
  /** Right-aligned header slot: counts, chips. */
  meta?: ReactNode
  /** Right-aligned header slot after `meta`: copy and clear affordances. */
  actions?: ReactNode
  children: ReactNode
  /**
   * UX_SPEC 3.0: a result whose inputs have since changed drops to 55% and is
   * labelled, never hidden — stale results stay copyable.
   */
  dimmed?: boolean
  className?: string
}

/**
 * One half of the side-by-side conversion view (UX_SPEC 3.6).
 *
 * Both panes share a frame so a round trip reads as one comparison rather than
 * two unrelated boxes, and both headers name their representation explicitly —
 * the old app's silent transform is the thing this layout exists to fix.
 */
export function Pane({ label, meta, actions, children, dimmed = false, className }: PaneProps) {
  const headingId = `pane-${useId()}`

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-w-64 flex-1 basis-72 flex-col overflow-hidden rounded-sm border border-border-subtle bg-surface-1',
        className,
      )}
    >
      <header className="flex h-control-sm shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-2 px-2">
        <h3
          id={headingId}
          className="min-w-0 truncate text-2xs tracking-wide text-text-secondary uppercase"
        >
          {label}
        </h3>
        {meta != null && <span className="ml-auto shrink-0 text-2xs text-text-tertiary">{meta}</span>}
        {actions != null && (
          <div className={cn('flex shrink-0 items-center gap-0.5', meta == null && 'ml-auto')}>
            {actions}
          </div>
        )}
      </header>

      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-2 p-2',
          'transition-opacity duration-base ease-standard motion-reduce:transition-none',
          dimmed && 'opacity-55',
        )}
      >
        {children}
      </div>
    </section>
  )
}
