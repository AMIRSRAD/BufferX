/**
 * Shared chrome for the PIN sub-tabs (UX_SPEC 3.0 and 3.2).
 *
 * The dock owns the tool header; everything below it — sections, the result
 * block, the error strip and the sticky action bar — is the tool-panel
 * contract, and all four PIN sub-tabs render it through these parts so the
 * frame is identical across them.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUp, ChevronDown, Eye, EyeOff } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Popover } from '@/components/ui/Popover'
import { EngineCallError } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import type { ResultRowData, RunResult } from './state'

/* ── Sections ────────────────────────────────────────────────────────────── */

export interface SectionProps {
  label: string
  /** Rendered at the right of the section label row. */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/** One labelled group of controls, single column, with a top divider. */
export function Section({ label, aside, children, className }: SectionProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-field border-t border-border-subtle px-panel py-3 first:border-t-0',
        className,
      )}
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-2xs font-medium tracking-wider text-text-tertiary uppercase">
          {label}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * A field label carrying a live length badge — the `4` next to `Clear PIN`
 * (UX_SPEC 3.2a). The badge prints the *length*, never the value.
 */
export function CountLabel({
  text,
  count,
  unit = 'digits',
}: {
  text: string
  count: number
  unit?: string
}) {
  return (
    <span className="flex items-center gap-1.5">
      {text}
      {count > 0 && (
        <Badge tone="neutral" mono>
          {count} {unit}
        </Badge>
      )}
    </span>
  )
}

/** A short explanatory line under a control, e.g. a stated disabled reason. */
export function Note({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <p className={cn('text-xs', tone === 'warn' ? 'text-warn' : 'text-text-tertiary')}>{children}</p>
  )
}

/* ── Result block ────────────────────────────────────────────────────────── */

export interface ResultBlockProps {
  result: RunResult | null
  stale: boolean
  /** Placeholder line shown before the first run. */
  emptyHint: string
  /** Extra actions rendered in the result header, e.g. `Apply to F52`. */
  actions?: ReactNode
}

/**
 * The tinted result panel. Stale results dim to 55% and gain
 * `inputs changed` in the provenance line — they stay copyable, they are just
 * labelled (UX_SPEC 3.0).
 */
export function ResultBlock({ result, stale, emptyHint, actions }: ResultBlockProps) {
  const copyAll =
    result === null
      ? ''
      : result.rows.map((row) => `${row.label}: ${row.value}`).join('\n')

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-sm border border-border-subtle bg-surface-inset p-2.5',
        'transition-opacity duration-base ease-standard motion-reduce:transition-none',
        stale && 'opacity-55',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-2xs font-medium tracking-wider text-text-tertiary uppercase">
            Result
          </h3>
          {result?.verdict && (
            <Badge tone={result.verdict.tone} dot>
              {result.verdict.label}
            </Badge>
          )}
          {stale && result !== null && <Badge tone="warn">stale</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {result !== null && result.rows.length > 1 && (
            <CopyButton value={copyAll} label="Copy all" size="xs" variant="ghost" showLabel />
          )}
        </div>
      </div>

      {result === null ? (
        <p className="text-sm text-text-tertiary">{emptyHint}</p>
      ) : (
        <>
          <dl className="flex flex-col gap-1.5">
            {result.rows.map((row) => (
              <ResultRow key={row.key} row={row} />
            ))}
          </dl>
          <p className="text-2xs text-text-tertiary">
            {result.provenance}
            {stale && ' · inputs changed'}
          </p>
        </>
      )}
    </div>
  )
}

const MASK = '••••••••••••'

/** One `label · value · copy` row. Sensitive values reveal on demand. */
export function ResultRow({ row }: { row: ResultRowData }) {
  const [revealed, setRevealed] = useState(false)

  // A new value always comes back masked.
  useEffect(() => {
    setRevealed(false)
  }, [row.value])

  const hidden = row.sensitive === true && !revealed

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-start gap-2">
        <dt className="w-32 shrink-0 pt-0.5 text-xs text-text-secondary">{row.label}</dt>
        <dd
          className="min-w-0 flex-1 font-mono text-mono-sm break-all text-text select-text"
          data-sensitive={row.sensitive === true ? 'true' : undefined}
        >
          {hidden ? <span aria-hidden="true">{MASK}</span> : row.value || '—'}
          {hidden && <span className="sr-only">Value hidden. Use the reveal button.</span>}
        </dd>
        <div className="flex shrink-0 items-center gap-0.5">
          {row.sensitive === true && (
            <IconButton
              icon={revealed ? EyeOff : Eye}
              size="xs"
              variant="ghost"
              label={revealed ? `Hide ${row.label}` : `Reveal ${row.label}`}
              aria-pressed={revealed}
              onClick={() => setRevealed((current) => !current)}
            />
          )}
          {row.useAs && row.onUseAs && (
            <Button size="xs" variant="ghost" icon={ArrowUp} onClick={row.onUseAs}>
              {row.useAs}
            </Button>
          )}
          <CopyButton value={row.value} label={`Copy ${row.label}`} size="xs" variant="ghost" />
        </div>
      </div>
      {row.note && <p className="pl-34 text-2xs text-text-tertiary">{row.note}</p>}
    </div>
  )
}

/* ── Error strip ─────────────────────────────────────────────────────────── */

/**
 * Engine failures render here, immediately above the action bar: wrapped, full
 * text, copyable, with the raw payload behind a `Details` disclosure. Never a
 * modal, never a truncated status line.
 */
export function ErrorStrip({
  error,
  onDismiss,
}: {
  error: EngineCallError
  onDismiss: () => void
}) {
  const raw = JSON.stringify({ op: error.op, code: error.code, detail: error.detail }, null, 2)

  return (
    <InlineAlert
      tone="error"
      title={`${error.op} failed`}
      onDismiss={onDismiss}
      action={
        <CopyButton
          value={`${error.op} · ${error.code}: ${error.message}`}
          label="Copy error"
          size="xs"
          showLabel
        />
      }
    >
      <p className="break-words">{error.message}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-text-tertiary select-none">Details</summary>
        <pre className="mt-1 overflow-x-auto rounded-xs bg-surface-inset p-2 font-mono text-mono-xs text-text-secondary">
          {raw}
        </pre>
      </details>
    </InlineAlert>
  )
}

/* ── Action bar ──────────────────────────────────────────────────────────── */

/**
 * The sticky 44px action row. `blocker` is the first unmet client-side rule; it
 * is shown above the buttons so a disabled primary always states its reason.
 */
export function ActionBar({ blocker, children }: { blocker?: string; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-1.5 border-t border-border bg-surface-1 px-panel py-2">
      {blocker && (
        <p role="status" className="text-xs text-warn">
          {blocker}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/* ── Carry over ──────────────────────────────────────────────────────────── */

export interface CarryOverItem {
  /** `PAN from Visa PVV` — the label the operator reads and the chip shows. */
  label: string
  value: string
  onApply(): void
}

/**
 * Explicit cross-tab copy of PAN / Clear PIN (UX_SPEC 3.2). The old app shared
 * these invisibly; here it is one deliberate click with visible provenance.
 */
export function CarryOver({
  items,
  provenance,
}: {
  items: CarryOverItem[]
  provenance?: string
}) {
  const [open, setOpen] = useState(false)
  const available = items.filter((item) => item.value.length > 0)

  return (
    <div className="flex items-center gap-1.5">
      {provenance && <Badge tone="info">{provenance}</Badge>}
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        padded={false}
        trigger={
          <Button size="xs" variant="ghost" iconRight={ChevronDown}>
            Carry over
          </Button>
        }
      >
        <div className="flex flex-col p-1.5">
          <p className="px-1.5 pt-1 pb-2 text-xs text-text-secondary">
            Copy a value from another sub-tab. Nothing is shared automatically.
          </p>
          {available.length === 0 ? (
            <p className="px-1.5 pb-1.5 text-xs text-text-tertiary">
              No other sub-tab holds a PAN or a clear PIN yet.
            </p>
          ) : (
            available.map((item) => (
              <button
                key={item.label}
                type="button"
                className={cn(
                  'rounded-xs px-1.5 py-1.5 text-left text-sm text-text',
                  'hover:bg-surface-raised focus-visible:bg-surface-raised',
                )}
                onClick={() => {
                  item.onApply()
                  setOpen(false)
                }}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      </Popover>
    </div>
  )
}
