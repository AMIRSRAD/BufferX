import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CopyButton } from '@/components/ui/CopyButton'

export interface ResultRowProps {
  label: string
  /** The exact text the copy button puts on the clipboard. */
  value: string
  /** Optional display form (grouped hex, an elided preview). Defaults to `value`. */
  display?: ReactNode
  mono?: boolean
  /** Announced by the copy button, e.g. `Copy wire hex`. */
  copyLabel?: string
  /** Shown in place of the value when there is nothing yet. */
  placeholder?: string
  className?: string
}

/**
 * One copyable readout (UX_SPEC 3.8: "response metadata becomes three separate
 * copyable rows" instead of one wrapping 11px label).
 *
 * The copy button is only rendered when there is something to copy -- a button
 * that silently copies an empty string is worse than no button.
 */
export function ResultRow({
  label,
  value,
  display,
  mono = true,
  copyLabel,
  placeholder = '--',
  className,
}: ResultRowProps) {
  const empty = value === ''

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <span className="w-20 shrink-0 pt-1 text-xs text-text-secondary">{label}</span>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-sm bg-surface-inset px-cell-x py-cell-y break-all',
          mono ? 'font-mono text-mono-xs' : 'text-xs',
          empty ? 'text-text-disabled' : 'text-text',
        )}
      >
        {empty ? placeholder : (display ?? value)}
      </div>
      <div className="w-7 shrink-0">
        {empty ? null : <CopyButton value={value} label={copyLabel ?? `Copy ${label}`} size="xs" />}
      </div>
    </div>
  )
}
