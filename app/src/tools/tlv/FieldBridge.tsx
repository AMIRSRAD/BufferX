/**
 * `Field` + `Load field` + `Apply to field` (UX_SPEC 3.5, 5.6).
 *
 * The Qt panel had a Load with no counterpart, so the only way back into the
 * workspace was a manual copy/paste — and Build hid the field controls
 * altogether. Here the pair is one component, shared by Parse and Build, so
 * every load has an apply in both modes.
 */

import { useId, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { toast } from '@/components/ui/toast'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { hexByteLength } from './model'

export const MIN_FIELD_ID = 0
export const MAX_FIELD_ID = 128

export interface FieldBridgeProps {
  fieldId: string
  onFieldIdChange: (value: string) => void
  /** Receives the field's stored value and whether that value is hex. */
  onLoad: (value: string, isHex: boolean) => void
  /** Compact hex written back by `Apply to field`. Empty disables Apply. */
  applyValue: string
  /** Why there is nothing to apply yet, shown on the disabled button. */
  applyEmptyReason: string
}

function parseFieldId(raw: string): number | null {
  const trimmed = raw.trim()
  if (!/^\d{1,3}$/.test(trimmed)) return null
  const value = Number.parseInt(trimmed, 10)
  if (value < MIN_FIELD_ID || value > MAX_FIELD_ID) return null
  return value
}

export function FieldBridge({
  fieldId,
  onFieldIdChange,
  onLoad,
  applyValue,
  applyEmptyReason,
}: FieldBridgeProps) {
  const inputId = useId()
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const update = useBuffers((state) => state.update)
  const addField = useBuffers((state) => state.addField)
  const addProblem = useProblems((state) => state.add)

  const [missing, setMissing] = useState<number | null>(null)

  const tab = tabs.find((candidate) => candidate.id === activeId)
  const numericId = parseFieldId(fieldId)
  const idError =
    numericId === null
      ? `Field id must be a number between ${MIN_FIELD_ID} and ${MAX_FIELD_ID}. Got '${fieldId.trim() || '(empty)'}'.`
      : undefined

  const label = numericId === null ? 'field' : `F${String(numericId).padStart(3, '0')}`

  const report = (message: string) => {
    addProblem({ severity: 'error', source: 'TLV', message, ...(numericId === null ? {} : { fieldId: numericId }) })
  }

  const handleLoad = () => {
    if (tab === undefined || numericId === null) return
    const row = tab.fields.find((candidate) => candidate.id === numericId)
    if (row === undefined) {
      setMissing(numericId)
      report(`No field ${numericId} in the decoded message.`)
      return
    }
    setMissing(null)
    onLoad(row.value, row.hex === true)
  }

  const handleApply = () => {
    if (tab === undefined || numericId === null || applyValue === '') return
    const row = tab.fields.find((candidate) => candidate.id === numericId)
    if (row === undefined) {
      setMissing(numericId)
      report(`No field ${numericId} in the decoded message.`)
      return
    }
    setMissing(null)

    update(tab.id, {
      fields: tab.fields.map((candidate) =>
        candidate.id === numericId
          ? { ...candidate, value: applyValue, hex: true, invalid: undefined }
          : candidate,
      ),
    })

    const bytes = hexByteLength(applyValue)
    toast.success(`Applied ${bytes} ${bytes === 1 ? 'byte' : 'bytes'} to ${label}.`)
    addProblem({
      severity: 'info',
      source: 'TLV',
      message: `Applied ${bytes} ${bytes === 1 ? 'byte' : 'bytes'} of TLV to ${label} in ${tab.name}.`,
      fieldId: numericId,
    })
  }

  const handleAddMissing = () => {
    if (tab === undefined || missing === null) return
    if (addField(tab.id, missing)) {
      toast.success(`Added field ${missing} to ${tab.name}.`)
      setMissing(null)
    }
  }

  const noBuffer = tab === undefined

  return (
    <div className="flex flex-col gap-field">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Field" htmlFor={inputId} error={idError} className="w-24 shrink-0">
          <Input
            id={inputId}
            value={fieldId}
            onValueChange={onFieldIdChange}
            size="sm"
            mono
            inputMode="numeric"
            invalid={idError !== undefined}
          />
        </Field>

        <Button
          size="sm"
          variant="default"
          icon={ArrowDownToLine}
          disabled={noBuffer || numericId === null}
          onClick={handleLoad}
          title={
            noBuffer
              ? 'Open a buffer to load a field.'
              : `Copy ${label} from the workspace into the payload box.`
          }
        >
          Load field
        </Button>

        <Button
          size="sm"
          variant="default"
          icon={ArrowUpFromLine}
          disabled={noBuffer || numericId === null || applyValue === ''}
          onClick={handleApply}
          title={
            noBuffer
              ? 'Open a buffer to apply a value.'
              : applyValue === ''
                ? applyEmptyReason
                : `Write the encoded TLV into ${label}.`
          }
        >
          Apply to field
        </Button>
      </div>

      {missing !== null ? (
        <InlineAlert
          tone="error"
          title={`No field ${missing} in the decoded message.`}
          onDismiss={() => setMissing(null)}
          action={
            <Button size="xs" variant="default" onClick={handleAddMissing}>
              Add field {missing}
            </Button>
          }
        >
          Decode a buffer that carries the field, or add it and set its value here.
        </InlineAlert>
      ) : null}
    </div>
  )
}
