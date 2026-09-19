/**
 * Layout primitives shared by the Settings sections.
 *
 * Settings is a full workspace tab with a left sub-nav and a right content pane
 * (UX_SPEC 3.9), so it needs one more layer than the dock's tool frame supplies:
 * a section card, a labelled setting row, and a read-only readout row with a
 * copy affordance. All three are pure presentation over design tokens.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CopyButton } from '@/components/ui/CopyButton'

/** A titled block inside a section. `action` sits opposite the title. */
export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col gap-field rounded-md border border-border-subtle bg-surface-1 p-panel',
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-start justify-between gap-group">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-2xs font-medium tracking-wide text-text-tertiary uppercase">{title}</h3>
          {description ? <p className="text-xs text-text-secondary">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </header>
      {children}
    </section>
  )
}

/**
 * One setting: label and help on the left, control on the right, error beneath.
 *
 * `htmlFor` is required whenever `control` renders a single focusable element,
 * so the label is a real label. Composite controls (a segmented control, a
 * switch that renders its own label) pass `labelAs="span"` instead.
 */
export function SettingRow({
  label,
  hint,
  error,
  htmlFor,
  control,
  labelAs = 'label',
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  htmlFor?: string
  control: ReactNode
  labelAs?: 'label' | 'span'
  className?: string
}) {
  const LabelTag = labelAs
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex flex-wrap items-center justify-between gap-group">
        <div className="flex min-w-48 flex-1 flex-col gap-0.5">
          <LabelTag
            className="text-sm font-medium text-text"
            {...(labelAs === 'label' && htmlFor ? { htmlFor } : {})}
          >
            {label}
          </LabelTag>
          {hint ? <span className="text-xs text-text-secondary">{hint}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{control}</div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A read-only value with a copy button — every result gets one (UX_SPEC 5.2). */
export function Readout({
  label,
  value,
  display,
  tone,
  copyable = true,
}: {
  label: string
  /** The exact text the copy button puts on the clipboard. */
  value: string
  /** What is shown, when it differs from what is copied. */
  display?: ReactNode
  tone?: 'default' | 'muted'
  copyable?: boolean
}) {
  const empty = value === ''
  return (
    <div className="flex items-start justify-between gap-group border-b border-border-subtle py-cell-y last:border-b-0">
      <span className="min-w-40 shrink-0 text-xs text-text-secondary">{label}</span>
      <span className="flex min-w-0 flex-1 items-start justify-end gap-1">
        <span
          className={cn(
            'truncate text-right font-mono text-mono-xs',
            empty || tone === 'muted' ? 'text-text-tertiary' : 'text-text',
          )}
          title={typeof display === 'string' || display === undefined ? value : undefined}
        >
          {display ?? (empty ? '—' : value)}
        </span>
        {copyable && !empty ? <CopyButton value={value} size="xs" variant="ghost" /> : null}
      </span>
    </div>
  )
}

/** A group of `Readout`s with a shared copy-everything button. */
export function ReadoutGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col rounded-sm border border-border-subtle bg-surface-inset px-cell-x">{children}</div>
}

/** Thin divider used between control groups inside one card. */
export function Divider() {
  return <hr className="border-0 border-t border-border-subtle" />
}
