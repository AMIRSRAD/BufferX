/**
 * Visa PVV sub-tab (UX_SPEC 3.2b).
 *
 * `PAN` · `Clear PIN` · `PVKI (one digit)` · `PVK` → `Calculate PVV`, with the
 * PVV in its own copyable result row. The PVK is a secret input here; in the
 * old app it was plaintext while the ATM translate keys were masked.
 */

import { useEffect, useMemo, type RefObject } from 'react'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { SecretInput } from '@/components/ui/SecretInput'
import { Button } from '@/components/ui/Button'
import { call } from '@/engine/client'
import {
  ActionBar,
  CarryOver,
  CountLabel,
  ErrorStrip,
  ResultBlock,
  Section,
  type CarryOverItem,
} from './parts'
import {
  hexError,
  keySizeLabel,
  panError,
  pinError,
  digitError,
  toDigits,
  toHex,
  type PvvModel,
  type Runner,
  type TabActions,
  type TabModel,
} from './state'

const PVK_BYTES = [8, 16, 24] as const

export interface VisaPvvTabProps {
  model: TabModel<PvvModel>
  runner: Runner
  carry: CarryOverItem[]
  provenance?: string
  actionsRef: RefObject<TabActions | null>
}

export function VisaPvvTab({ model, runner, carry, provenance, actionsRef }: VisaPvvTabProps) {
  const { state, patch } = model

  const issues = useMemo(
    () => ({
      pan: panError(state.pan, false),
      clearPin: pinError(state.clearPin, false),
      pvki: digitError(state.pvki, { label: 'PVKI', exact: 1 }),
      pvk: hexError(state.pvk, { label: 'PVK', bytes: PVK_BYTES }),
    }),
    [state.clearPin, state.pan, state.pvk, state.pvki],
  )

  function blocker(): string | undefined {
    if (state.pan.length === 0) return 'The PAN is required for a PVV.'
    if (issues.pan) return issues.pan
    if (state.clearPin.length === 0) return 'The clear PIN is required for a PVV.'
    if (issues.clearPin) return issues.clearPin
    if (state.pvki.length === 0) return 'The PVKI is required — one digit.'
    if (issues.pvki) return issues.pvki
    if (state.pvk.length === 0) return 'The PVK is required.'
    if (issues.pvk) return issues.pvk
    return undefined
  }

  function calculate(): void {
    const reason = blocker()
    if (reason) {
      runner.fail('pin.visaPvv', reason)
      return
    }
    void runner.run('pin.visaPvv', async () => {
      const data = await call<{ pvv: string }>('pin.visaPvv', {
        pin: state.clearPin,
        pan: state.pan,
        pvki: state.pvki,
        pvkHex: state.pvk,
      })
      return {
        rows: [{ key: 'pvv', label: 'PVV', value: data.pvv }],
        provenance: `Visa PVV · PVKI ${state.pvki} · PVK ${keySizeLabel(state.pvk)} · PIN ${state.clearPin.length} digits`,
      }
    })
  }

  useEffect(() => {
    actionsRef.current = { primary: calculate, primaryLabel: 'Calculate PVV' }
    return () => {
      actionsRef.current = null
    }
  })

  // The blocker line explains a refusal; it should not lecture an untouched form.
  const touched =
    state.pan.length + state.clearPin.length + state.pvki.length + state.pvk.length > 0
  const reason = touched ? blocker() : undefined

  return (
    <div className="flex min-h-0 flex-col">
      <Section label="Cardholder" aside={<CarryOver items={carry} provenance={provenance} />}>
        <Field label="PAN" error={issues.pan} hint="12–19 digits.">
          <Input
            value={state.pan}
            onValueChange={(value) => patch({ pan: toDigits(value) })}
            mono
            inputMode="numeric"
            placeholder="Primary account number"
            invalid={issues.pan !== undefined}
          />
        </Field>

        <Field
          label={<CountLabel text="Clear PIN" count={state.clearPin.length} />}
          error={issues.clearPin}
        >
          <SecretInput
            value={state.clearPin}
            onValueChange={(value) => patch({ clearPin: toDigits(value) })}
            hex={false}
            placeholder="4–12 digits"
          />
        </Field>
      </Section>

      <Section label="Key material">
        <Field label="PVKI" error={issues.pvki} hint="One digit, 0–9.">
          <Input
            value={state.pvki}
            onValueChange={(value) => patch({ pvki: toDigits(value).slice(0, 1) })}
            mono
            inputMode="numeric"
            maxLength={1}
            placeholder="0"
            className="w-16"
            invalid={issues.pvki !== undefined}
          />
        </Field>

        <Field label="PVK" error={issues.pvk}>
          <SecretInput
            value={state.pvk}
            onValueChange={(value) => patch({ pvk: toHex(value) })}
            placeholder="PVK hex (8, 16, or 24 bytes)"
            acceptedByteLengths={PVK_BYTES}
          />
        </Field>
      </Section>

      <div className="flex flex-col gap-2 px-panel pb-3">
        <ResultBlock
          result={runner.result}
          stale={runner.stale}
          emptyHint="Calculate a PVV to see it here."
        />
        {runner.error && <ErrorStrip error={runner.error} onDismiss={runner.clear} />}
      </div>

      <ActionBar blocker={reason}>
        <Button variant="primary" loading={runner.busy === 'pin.visaPvv'} onClick={calculate}>
          Calculate PVV
        </Button>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            model.reset()
            runner.clear()
          }}
        >
          Clear
        </Button>
      </ActionBar>
    </div>
  )
}
