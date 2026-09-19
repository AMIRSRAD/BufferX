import { useId } from 'react'
import { Field } from '@/components/ui/Field'
import { HexInput, normalizeHex } from '@/components/ui/HexInput'
import { Input } from '@/components/ui/Input'
import { SecretInput } from '@/components/ui/SecretInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Textarea } from '@/components/ui/Textarea'
import { NumberField } from './NumberField'
import {
  effectiveInputKind,
  effectiveInputLabel,
  issueFor,
  parameterIsInert,
  type Issue,
  type OperationDef,
  type OperationState,
} from './operations'

export interface OperationFormProps {
  operation: OperationDef
  state: OperationState
  onChange: (patch: Partial<OperationState>) => void
  issues: readonly Issue[]
  disabled: boolean
}

/**
 * The per-operation form (UX_SPEC 3.7).
 *
 * Every control here is declared by the operation itself, so nothing inert is
 * ever rendered enabled. The one exception is deliberate: the BCD `Digits`
 * parameter stays visible on the encode operations, disabled, with the reason —
 * the same treatment UX_SPEC 3.6 gives `Convert digits to IranSystem`, because
 * a control that vanishes hides state.
 */
export function OperationForm({
  operation,
  state,
  onChange,
  issues,
  disabled,
}: OperationFormProps) {
  const modeLabelId = useId()
  const kind = effectiveInputKind(operation, state)
  const inputError = issueFor(issues, 'input')
  const secondaryError = issueFor(issues, 'secondary')
  const parameterError = issueFor(issues, 'parameter')
  const spec = operation.input

  return (
    <div className="flex flex-col gap-field">
      {operation.inputMode && (
        <div className="flex flex-col gap-1">
          <span id={modeLabelId} className="text-xs text-text-secondary">
            Input mode
          </span>
          <SegmentedControl
            aria-labelledby={modeLabelId}
            value={state.hashMode}
            onValueChange={(value) => onChange({ hashMode: value === 'hex' ? 'hex' : 'text' })}
            disabled={disabled}
            options={[
              { value: 'text', label: 'Text input' },
              { value: 'hex', label: 'Hex input' },
            ]}
          />
        </div>
      )}

      {spec && kind && (
        <Field
          label={effectiveInputLabel(operation, state)}
          hint={spec.hint}
          error={inputError}
          required
        >
          {kind === 'secretHex' ? (
            <SecretInput
              value={state.input}
              onValueChange={(value) => onChange({ input: normalizeHex(value) })}
              placeholder="Key bytes as hex"
              disabled={disabled}
              {...(operation.id === 'kcv' ? { acceptedByteLengths: [8, 16, 24, 32] as const } : {})}
            />
          ) : kind === 'hex' ? (
            <HexInput
              value={state.input}
              onValueChange={(value) => onChange({ input: value })}
              placeholder={spec.placeholder ?? ''}
              invalid={inputError !== undefined}
              disabled={disabled}
            />
          ) : kind === 'digits' ? (
            <Input
              value={state.input}
              onValueChange={(value) => onChange({ input: value.replace(/[^0-9]/g, '') })}
              placeholder={spec.placeholder ?? ''}
              invalid={inputError !== undefined}
              disabled={disabled}
              mono
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              suffix={
                <span className="font-mono text-mono-xs tabular-nums text-text-tertiary">
                  {state.input.length} digits
                </span>
              }
            />
          ) : (
            <Textarea
              value={state.input}
              onValueChange={(value) => onChange({ input: value })}
              placeholder={spec.placeholder ?? ''}
              invalid={inputError !== undefined}
              disabled={disabled}
              mono={kind !== 'text' || operation.group === 'base64'}
              rows={3}
              autoResize
              spellCheck={false}
            />
          )}
        </Field>
      )}

      {operation.secondary && (
        <Field
          label={operation.secondary.label}
          hint={operation.secondary.hint}
          error={secondaryError}
          required
        >
          <HexInput
            value={state.secondary}
            onValueChange={(value) => onChange({ secondary: value })}
            placeholder={operation.secondary.placeholder ?? ''}
            invalid={secondaryError !== undefined}
            disabled={disabled}
          />
        </Field>
      )}

      {operation.parameter && (
        <Field
          label={operation.parameter.label}
          hint={parameterIsInert(operation) ? operation.parameter.inertNote : operation.parameter.hint}
          error={parameterIsInert(operation) ? undefined : parameterError}
        >
          <NumberField
            value={state.parameter}
            onValueChange={(value) => onChange({ parameter: value })}
            min={operation.parameter.min}
            max={operation.parameter.max}
            allowed={operation.parameter.allowed}
            unit={operation.parameter.unit}
            invalid={!parameterIsInert(operation) && parameterError !== undefined}
            disabled={disabled || parameterIsInert(operation)}
          />
        </Field>
      )}
    </div>
  )
}
