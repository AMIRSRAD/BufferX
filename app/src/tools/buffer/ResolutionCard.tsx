/**
 * Encode recovery (UX_SPEC 2.5).
 *
 * The Qt app string-matched the backend's error text and opened a Yes/No dialog
 * that named no field, showed no expected value, and applied a global flag
 * blindly. This is the replacement: an inline card at the top of the fields
 * pane with a per-field choice, the exact before/after values, and a single
 * `Apply all suggested` for operators who want the old global behaviour.
 *
 * Nothing here string-matches an engine message. Items are built from the
 * structured error detail (`fieldId`, `expectedLength`, `actualLength`) and
 * from the client-side validators in `model.ts`.
 */

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

export interface ResolutionItem {
  fieldId: number
  /** `Binary length mismatch`, `Numeric field contains non-digits`. */
  title: string
  /** `declared 8 bytes · value is 6 bytes`. */
  detail: string
  before: string
  after: string
  /** `Pad with zeros`, `Strip non-digits`. */
  actionLabel: string
}

export interface ResolutionCardProps {
  items: readonly ResolutionItem[]
  onApply(item: ResolutionItem): void
  onApplyAll(): void
  onEdit(fieldId: number): void
  onSkip(fieldId: number): void
  onBuildAnyway(): void
  onDismiss(): void
  className?: string
}

export function ResolutionCard({
  items,
  onApply,
  onApplyAll,
  onEdit,
  onSkip,
  onBuildAnyway,
  onDismiss,
  className,
}: ResolutionCardProps) {
  if (items.length === 0) return null

  return (
    <section
      aria-label="Build blocked"
      className={cn(
        'shrink-0 rounded-md border border-error-border bg-error-bg p-panel',
        className,
      )}
    >
      <h3 className="flex items-center gap-1.5 text-base text-text">
        <AlertTriangle
          size={16}
          strokeWidth={1.5}
          absoluteStrokeWidth
          aria-hidden="true"
          className="text-error"
        />
        Build blocked — {items.length} field{items.length === 1 ? '' : 's'} need attention
      </h3>

      <ul className="mt-2 flex flex-col gap-2">
        {items.map((item) => (
          <li key={`${item.fieldId}-${item.title}`} className="flex flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span className="w-12 shrink-0 font-mono text-mono-sm text-text">
                F{item.fieldId}
              </span>
              <span className="text-sm text-text">{item.title}</span>
            </span>
            <span className="pl-14 text-xs text-text-secondary">{item.detail}</span>
            <span className="flex flex-wrap items-center gap-1 pl-14 font-mono text-mono-xs">
              <span className="rounded-xs bg-surface-2 px-1 text-text-secondary">
                {item.before === '' ? '(empty)' : item.before}
              </span>
              <span aria-hidden="true" className="text-text-tertiary">
                →
              </span>
              <span className="rounded-xs bg-surface-2 px-1 text-text">{item.after}</span>
            </span>
            <span className="flex flex-wrap items-center gap-field pt-0.5 pl-14">
              <Button size="xs" variant="primary" onClick={() => onApply(item)}>
                {item.actionLabel}
              </Button>
              <Button size="xs" onClick={() => onEdit(item.fieldId)}>
                Edit field
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onSkip(item.fieldId)}>
                Skip
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-field">
        <Button size="sm" variant="primary" onClick={onApplyAll}>
          Apply all suggested
        </Button>
        <span className="ml-auto flex items-center gap-field">
          <Button size="sm" onClick={onBuildAnyway}>
            Build anyway
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </span>
      </div>
      <p className="mt-1 text-2xs text-text-tertiary">
        “Build anyway” re-runs the encode with binary padding and numeric sanitising enabled — the
        engine decides, and every change lands as one undo entry.
      </p>
    </section>
  )
}
