/**
 * Presentation primitives for the About tool.
 *
 * The dock supplies the tool frame (UX_SPEC 3.0), so all this layer adds is the
 * section label, the read-only value row, and the tinted result block. Pure
 * token consumers — no colour, size or radius is written literally.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CopyButton } from '@/components/ui/CopyButton'
import { Skeleton } from '@/components/ui/Skeleton'

/** A labelled group of controls, matching the tool-chrome section header. */
export function Section({
  label,
  action,
  children,
  className,
}: {
  label: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-label={label} className={cn('flex flex-col gap-field', className)}>
      <header className="flex items-center justify-between gap-group">
        <h3 className="text-2xs font-medium tracking-wide text-text-tertiary uppercase">{label}</h3>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** A boxed list of `Readout`s. */
export function ReadoutGroup({ children }: { children: ReactNode }) {
  return (
    <dl className="flex flex-col rounded-sm border border-border-subtle bg-surface-inset px-cell-x">
      {children}
    </dl>
  )
}

export interface ReadoutProps {
  label: string
  /** The exact text the copy button places on the clipboard. */
  value: string | null
  /** Shown instead of `value` when the display form differs. */
  display?: ReactNode
  /** Replaces the value with a muted sentence when there is nothing to show. */
  emptyText?: string
  /** Renders a skeleton in the value slot while a call is in flight. */
  loading?: boolean
  /** Mono is the default: these are versions, hashes and paths. */
  mono?: boolean
  /** One line under the value — why a value is missing, what it means. */
  note?: ReactNode
}

/**
 * One diagnostic value. Every non-empty value carries a copy button
 * (UX_SPEC 5.2: every read-only value has a copy affordance).
 */
export function Readout({
  label,
  value,
  display,
  emptyText = 'Not reported',
  loading = false,
  mono = true,
  note,
}: ReadoutProps) {
  const empty = value === null || value === ''

  return (
    <div className="flex flex-col gap-0.5 border-b border-border-subtle py-cell-y last:border-b-0">
      <div className="flex items-start justify-between gap-group">
        <dt className="min-w-36 shrink-0 text-xs text-text-secondary">{label}</dt>
        <dd className="flex min-w-0 flex-1 items-start justify-end gap-1">
          {loading ? (
            <Skeleton width="8rem" height="0.875rem" />
          ) : (
            <>
              <span
                className={cn(
                  'min-w-0 text-right break-all',
                  mono ? 'font-mono text-mono-xs' : 'text-xs',
                  empty ? 'text-text-tertiary italic' : 'text-text',
                )}
              >
                {empty ? emptyText : (display ?? value)}
              </span>
              {empty ? null : (
                <CopyButton value={value} label={`Copy ${label}`} size="xs" variant="ghost" />
              )}
            </>
          )}
        </dd>
      </div>
      {note ? <p className="text-2xs text-text-tertiary">{note}</p> : null}
    </div>
  )
}

/** The tinted result block from the tool frame, used for the report preview. */
export function ResultBlock({
  title,
  action,
  children,
  provenance,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  provenance?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-field rounded-sm border border-border-subtle bg-surface-2 p-panel">
      <div className="flex items-center justify-between gap-group">
        <h4 className="text-2xs font-medium tracking-wide text-text-tertiary uppercase">{title}</h4>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </div>
      {children}
      {provenance ? <p className="text-2xs text-text-tertiary">{provenance}</p> : null}
    </div>
  )
}
