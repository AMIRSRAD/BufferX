import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'error' | 'info' | 'accent'

export interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
  /** Pairs an 8px status dot with the word. §4.14 forbids a bare coloured dot. */
  dot?: boolean
  /** Mono when the content is a code — `F002`, `STX21`, `0200`. */
  mono?: boolean
  className?: string
  title?: string
}

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-border-subtle bg-surface-raised text-text-secondary',
  accent: 'border-accent/40 bg-accent-muted text-accent',
  ok: 'border-ok-border bg-ok-bg text-ok',
  warn: 'border-warn-border bg-warn-bg text-warn',
  error: 'border-error-border bg-error-bg text-error',
  info: 'border-info-border bg-info-bg text-info',
}

/** DESIGN_SYSTEM.md §4.14. 16px tall, `radius-sm`, `text-2xs`, weight 500. */
export function Badge({ tone = 'neutral', children, dot = false, mono = false, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-4 shrink-0 items-center gap-1 rounded-sm border px-1.5',
        'text-2xs font-medium whitespace-nowrap',
        TONE[tone],
        mono && 'font-mono',
        className,
      )}
    >
      {dot && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  )
}
