/**
 * The RSA tool's local presentation parts.
 *
 * These implement the common tool chrome of UX_SPEC 3.0 — section label,
 * tinted result block with provenance, error strip above a sticky action bar —
 * for the parts the dock does not supply. They are deliberately local to this
 * folder: the shell owns the frame, a tool owns its body.
 */

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { cn } from '@/lib/cn'
import type { ToolError } from './model'

/* ── Section ─────────────────────────────────────────────────────────────── */

export interface SectionProps {
  title: string
  /** Right-aligned control on the section header row. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** 11px uppercase label over a single column of controls (UX_SPEC 3.0). */
export function Section({ title, action, children, className }: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-field', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-2xs tracking-wider text-text-tertiary uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** 1px rule between sections. */
export function Divider() {
  return <hr className="border-0 border-t border-border-subtle" />
}

/* ── Result block ────────────────────────────────────────────────────────── */

export interface ResultBlockProps {
  title?: string
  /** UX_SPEC 3.0: a result whose inputs changed greys to 55% and says so. */
  stale?: boolean
  /** The 11px muted line under the values. */
  provenance?: ReactNode
  /** Buttons rendered on the result header, beside the copy-all. */
  actions?: ReactNode
  /** Text handed to the block-level copy affordance. */
  copyValue?: string
  copyLabel?: string
  children: ReactNode
}

/**
 * The tinted read-only panel. Stale results stay copyable — they are labelled,
 * not disabled, because an operator often wants the value they just computed
 * even after typing the next input.
 */
export function ResultBlock({
  title = 'Result',
  stale = false,
  provenance: provenanceLine,
  actions,
  copyValue,
  copyLabel = 'Copy result',
  children,
}: ResultBlockProps) {
  return (
    <div
      data-stale={stale ? 'true' : 'false'}
      className={cn(
        'flex flex-col gap-1.5 rounded-sm border border-border-subtle bg-surface-inset p-2',
        'transition-opacity duration-base ease-standard motion-reduce:transition-none',
        stale && 'opacity-55',
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h4 className="text-2xs tracking-wider text-text-tertiary uppercase">{title}</h4>
        <div className="flex items-center gap-1">
          {actions}
          {copyValue !== undefined && copyValue !== '' ? (
            <CopyButton value={copyValue} label={copyLabel} size="xs" />
          ) : null}
        </div>
      </div>

      {children}

      {provenanceLine != null ? (
        <p className="text-2xs break-words text-text-tertiary">
          {provenanceLine}
          {stale ? <span className="text-warn"> · inputs changed</span> : null}
        </p>
      ) : null}
    </div>
  )
}

export interface ResultRowProps {
  label: string
  value: string
  /** Long Base64 wraps anywhere rather than forcing a horizontal scrollbar. */
  wrap?: boolean
  mono?: boolean
  /** Extra affordances such as `↑ use as plaintext`. */
  actions?: ReactNode
  /** Copy button label, so screen readers hear which value is being copied. */
  copyLabel?: string
}

/** One labelled, copyable read-only value (UX_SPEC 5.2: every value copies). */
export function ResultRow({
  label,
  value,
  wrap = true,
  mono = true,
  actions,
  copyLabel,
}: ResultRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <span className="w-28 shrink-0 pt-0.5 text-xs text-text-secondary">{label}</span>
        <output
          className={cn(
            'min-w-0 flex-1 text-text',
            mono ? 'font-mono text-mono-xs' : 'text-sm',
            wrap ? 'break-all' : 'truncate',
          )}
        >
          {value === '' ? <span className="text-text-tertiary">—</span> : value}
        </output>
        {value === '' ? null : (
          <CopyButton value={value} label={copyLabel ?? `Copy ${label.toLowerCase()}`} size="xs" />
        )}
      </div>
      {actions != null ? <div className="flex flex-wrap items-center gap-2 pl-30">{actions}</div> : null}
    </div>
  )
}

/* ── Verdict chip ────────────────────────────────────────────────────────── */

/**
 * `MATCH` / `MISMATCH`, never colour alone (UX_SPEC 3.1, 6.2) — the glyph and
 * the word both carry the verdict.
 */
export function VerdictChip({ valid }: { valid: boolean }) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-2xs font-medium',
        valid ? 'border-ok-border bg-ok-bg text-ok' : 'border-error-border bg-error-bg text-error',
      )}
    >
      <span aria-hidden="true">{valid ? '✓' : '✕'}</span>
      {valid ? 'MATCH' : 'MISMATCH'}
    </span>
  )
}

/* ── Error strip ─────────────────────────────────────────────────────────── */

/**
 * UX_SPEC 3.0: errors render immediately above the action bar, wrapped, in
 * full, with a copy affordance and a `Details` disclosure carrying the raw
 * engine payload. The payload is the *response* envelope only — request
 * arguments are never included, because they hold key material.
 */
export function ErrorStrip({ error, onDismiss }: { error: ToolError; onDismiss(): void }) {
  const [showDetails, setShowDetails] = useState(false)
  const raw = JSON.stringify(
    { op: error.op, code: error.code, message: error.message, detail: error.detail ?? null },
    null,
    2,
  )

  return (
    <InlineAlert
      tone="error"
      title={error.title}
      onDismiss={onDismiss}
      action={
        <>
          <Button
            size="xs"
            variant="subtle"
            aria-expanded={showDetails}
            onClick={() => setShowDetails((current) => !current)}
          >
            {showDetails ? 'Hide details' : 'Details'}
          </Button>
          <CopyButton value={raw} label="Copy error details" size="xs" variant="subtle" showLabel />
        </>
      }
    >
      <p className="break-words">{error.message}</p>
      {showDetails ? (
        <pre className="mt-1.5 max-h-40 overflow-auto rounded-xs bg-surface-inset p-2 font-mono text-mono-xs text-text-secondary">
          {raw}
        </pre>
      ) : null}
    </InlineAlert>
  )
}

/* ── Action bar ──────────────────────────────────────────────────────────── */

/** The sticky 44px footer that holds the primary/secondary pair (UX_SPEC 3.0). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-border bg-surface-1 px-2 py-2">
      {children}
    </div>
  )
}

/* ── Progress ────────────────────────────────────────────────────────────── */

/**
 * The 2px indeterminate bar of UX_SPEC 5.4. It is mounted only after the
 * 120ms threshold, so a sub-millisecond call never flashes a spinner.
 */
export function BusyBar({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-hidden={!active}
      className={cn(
        'h-0.5 w-full overflow-hidden',
        active ? 'bg-accent-muted' : 'bg-transparent',
      )}
    >
      {active ? (
        <div className="h-full w-1/3 animate-pulse bg-accent motion-reduce:animate-none" />
      ) : null}
    </div>
  )
}
