/**
 * UX_SPEC 3.0 — "Errors render in a red-tinted strip immediately above the
 * action bar, wrapped, full text, with a copy and a `Details` disclosure
 * carrying the raw engine payload."
 *
 * The engine's error payload names arguments (`keyHex`) and constraints, never
 * values, so the disclosure is safe to copy.
 */

import { CopyButton } from '@/components/ui/CopyButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import type { EngineCallError } from '@/engine/protocol'

export interface MacErrorStripProps {
  title: string
  error: EngineCallError
  onDismiss: () => void
}

export function MacErrorStrip({ title, error, onDismiss }: MacErrorStripProps) {
  const payload = JSON.stringify(
    { op: error.op, code: error.code, message: error.message, detail: error.detail ?? null },
    null,
    2,
  )

  return (
    <InlineAlert
      tone="error"
      title={title}
      onDismiss={onDismiss}
      action={<CopyButton value={payload} label="Copy error details" size="xs" variant="subtle" showLabel />}
    >
      <p className="break-words">{error.message}</p>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-xs text-text-secondary select-none">Details</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-border-subtle bg-surface-inset p-2 font-mono text-mono-xs text-text-secondary">
          {payload}
        </pre>
      </details>
    </InlineAlert>
  )
}
