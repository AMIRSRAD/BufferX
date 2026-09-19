/**
 * `→ Send to field…` (UX_SPEC 3.3 fix 3, and the "Crypto → anywhere" row of the
 * cross-tool wiring table in §6).
 *
 * The old app could produce a ciphertext and then leave the operator to select
 * it by hand and paste it into the field table. This picks the bit, creates it
 * when it is absent, and states which buffer it is writing into — the tool
 * never writes into an invisible target.
 */

import { useMemo, useState } from 'react'
import { CornerUpRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Popover } from '@/components/ui/Popover'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import type { FieldRow } from '@/store/buffers'

export interface SendToFieldPopoverProps {
  /** Rows of the active buffer, for the quick-pick list. */
  fields: readonly FieldRow[]
  /** Named in the popover so the write target is never implicit. */
  bufferName: string | undefined
  disabled: boolean
  /** Why the trigger is disabled. Rendered as the tooltip — never silent grey. */
  disabledReason?: string
  onSend: (fieldId: number) => void
}

const MAX_FIELD_ID = 128

function parseFieldId(raw: string): { id: number } | { error: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: 'Enter a field id between 0 and 128.' }
  if (!/^\d+$/.test(trimmed)) {
    return { error: `Field id must be a number between 0 and 128. Got '${trimmed}'.` }
  }
  const id = Number.parseInt(trimmed, 10)
  if (id > MAX_FIELD_ID) {
    return { error: `Field id must be a number between 0 and 128. Got '${trimmed}'.` }
  }
  return { id }
}

export function SendToFieldPopover({
  fields,
  bufferName,
  disabled,
  disabledReason,
  onSend,
}: SendToFieldPopoverProps) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')

  const parsed = useMemo(() => parseFieldId(raw), [raw])
  const error = 'error' in parsed && raw.trim() !== '' ? parsed.error : undefined
  const targetId = 'id' in parsed ? parsed.id : null
  const existing = targetId === null ? undefined : fields.find((row) => row.id === targetId)

  const commit = (id: number) => {
    onSend(id)
    setOpen(false)
    setRaw('')
  }

  const trigger = (
    <Button size="xs" variant="ghost" icon={CornerUpRight} disabled={disabled} aria-disabled={disabled}>
      Send to field…
    </Button>
  )

  if (disabled) {
    return <Tooltip content={disabledReason ?? 'Unavailable'}>{trigger}</Tooltip>
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setRaw('')
      }}
      trigger={trigger}
      align="end"
    >
      <form
        className="flex flex-col gap-field"
        onSubmit={(event) => {
          event.preventDefault()
          if (targetId !== null) commit(targetId)
        }}
      >
        <p className="text-xs text-text-secondary">
          Write the output into a field of{' '}
          <span className="font-mono text-mono-xs text-text">{bufferName ?? 'the active buffer'}</span>.
        </p>

        <Field
          label="Field id"
          hint="0 to 128. A missing field is created."
          error={error}
          htmlFor="crypto-send-field-id"
        >
          <Input
            id="crypto-send-field-id"
            value={raw}
            onValueChange={setRaw}
            mono
            inputMode="numeric"
            autoFocus
            placeholder="52"
            invalid={Boolean(error)}
            suffix={
              <span className="text-2xs text-text-tertiary">
                {existing ? 'overwrites' : targetId === null ? '' : 'new field'}
              </span>
            }
          />
        </Field>

        {fields.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs font-medium tracking-wide text-text-secondary uppercase">
              Decoded fields
            </span>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
              {fields.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => commit(row.id)}
                  title={row.desc ?? `Field ${row.id}`}
                  className={cn(
                    'rounded-xs border border-border-subtle bg-surface-2 px-1.5 py-0.5',
                    'font-mono text-mono-xs text-text-secondary',
                    'hover:border-border-strong hover:text-text',
                  )}
                >
                  F{String(row.id).padStart(3, '0')}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="xs" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="xs" variant="primary" type="submit" disabled={targetId === null}>
            {targetId === null
              ? 'Apply to field'
              : `Apply to F${String(targetId).padStart(3, '0')}`}
          </Button>
        </div>
      </form>
    </Popover>
  )
}
