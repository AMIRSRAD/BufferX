import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './IconButton'

export type AlertTone = 'error' | 'warn' | 'ok' | 'info'

export interface InlineAlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Present ⇒ the alert is advisory and dismissible. Absent ⇒ blocking. */
  onDismiss?: () => void
  /** The corrective action, as a button. §7 rule 3: every error carries its fix. */
  action?: ReactNode
  className?: string
}

const TONE: Record<AlertTone, string> = {
  error: 'border-error-border bg-error-bg',
  warn: 'border-warn-border bg-warn-bg',
  ok: 'border-ok-border bg-ok-bg',
  info: 'border-info-border bg-info-bg',
}

const TONE_INK: Record<AlertTone, string> = {
  error: 'text-error',
  warn: 'text-warn',
  ok: 'text-ok',
  info: 'text-info',
}

const TONE_ICON: Record<AlertTone, LucideIcon> = {
  error: XCircle,
  warn: AlertTriangle,
  ok: CheckCircle2,
  info: Info,
}

/**
 * DESIGN_SYSTEM.md §4.19 — **the app's primary error surface.**
 *
 * It replaces the single elided status-bar label entirely. Errors are a list,
 * never a global slot: render several of these stacked when several things
 * failed.
 */
export function InlineAlert({
  tone = 'error',
  title,
  children,
  onDismiss,
  action,
  className,
}: InlineAlertProps) {
  const Icon = TONE_ICON[tone]
  const blocking = tone === 'error' || tone === 'warn'

  return (
    <div
      role={blocking ? 'alert' : 'status'}
      aria-live={blocking ? 'assertive' : 'polite'}
      className={cn('flex items-start gap-2 rounded-sm border p-2.5', TONE[tone], className)}
    >
      <Icon
        size={16}
        strokeWidth={1.5}
        absoluteStrokeWidth
        className={cn('mt-px shrink-0', TONE_INK[tone])}
        aria-hidden="true"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {title && <p className={cn('text-base font-medium', TONE_INK[tone])}>{title}</p>}
        {children != null && (
          <div className="text-sm break-words text-text-secondary">{children}</div>
        )}
        {action != null && <div className="flex flex-wrap items-center gap-2 pt-0.5">{action}</div>}
      </div>

      {onDismiss && (
        <IconButton
          icon={X}
          size="xs"
          variant="ghost"
          label="Dismiss"
          className={cn('-mt-0.5 -mr-1', TONE_INK[tone])}
          onClick={onDismiss}
        />
      )}
    </div>
  )
}
