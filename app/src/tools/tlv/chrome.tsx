/**
 * The shared frame pieces every TLV section uses (UX_SPEC 3.0).
 *
 * The dock owns the tool header; these are the parts *inside* the body: the
 * uppercase section labels, the tinted result block with its provenance line
 * and staleness rule, the sticky action bar, and the 120ms-deferred progress
 * strip. They live here so the three modes cannot drift apart visually.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** 11px uppercase label plus a single-column control stack. */
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-field', className)}>
      <header className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-2xs tracking-wide text-text-secondary uppercase">{title}</h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

export function Divider() {
  return <hr className="border-t border-border-subtle" />
}

/**
 * The result block. Stale results grey to 55% and say so — they stay copyable,
 * because a stale answer is still an answer you may need to paste.
 */
export function ResultBlock({
  title,
  stale = false,
  provenance,
  actions,
  children,
  className,
}: {
  title: string
  stale?: boolean
  provenance?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'flex flex-col gap-field rounded-md border border-border-subtle bg-surface-2 p-2',
        stale && 'opacity-55',
        className,
      )}
    >
      <header className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-2xs tracking-wide text-text-secondary uppercase">{title}</h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      {children}
      {provenance ? (
        <p className="text-2xs text-text-tertiary">
          {provenance}
          {stale ? ' · inputs changed' : null}
        </p>
      ) : null}
    </section>
  )
}

/** Sticky 44px action bar at the foot of the panel body. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-panel -mb-panel mt-auto flex min-h-11 flex-wrap items-center gap-2 border-t border-border bg-surface-1 px-panel py-2">
      {children}
    </div>
  )
}

/**
 * 2px indeterminate strip along the top edge of the affected region
 * (UX_SPEC 5.4). The caller decides when it appears; the 0–120ms silence is
 * enforced by `useDeferredBusy`.
 */
export function ProgressStrip({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-hidden={!active}
      className={cn('h-0.5 w-full overflow-hidden rounded-full', active ? 'bg-surface-raised' : 'bg-transparent')}
    >
      <div
        className={cn(
          'h-full w-1/3 rounded-full bg-accent',
          active ? 'animate-pulse motion-reduce:animate-none' : 'opacity-0',
        )}
      />
    </div>
  )
}

/** A labelled read-only mono value with room for a copy affordance beside it. */
export function ReadonlyMono({
  value,
  emptyText,
  className,
  dir,
}: {
  value: string
  emptyText: string
  className?: string
  dir?: 'ltr' | 'rtl'
}) {
  return (
    <output
      dir={dir ?? 'ltr'}
      className={cn(
        'block max-h-40 min-w-0 overflow-auto rounded-sm border border-border-subtle bg-surface-inset px-2 py-1',
        'font-mono text-mono-sm break-all whitespace-pre-wrap',
        value === '' ? 'text-text-tertiary' : 'text-text',
        className,
      )}
    >
      {value === '' ? emptyText : value}
    </output>
  )
}
