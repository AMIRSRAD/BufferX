/**
 * IBM 3624 sub-tab (UX_SPEC 3.2c).
 *
 * `Calculate Offset` is primary, `Verify` is secondary, and the results are two
 * labelled rows plus a verdict chip. The old app crammed
 * `"<status> | Natural PIN: <x>"` into a single text field, which meant the
 * operator could not copy either half cleanly and a stale verdict could sit
 * next to a fresh offset.
 */

import { useEffect, useMemo, type RefObject } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { SecretInput } from '@/components/ui/SecretInput'
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
  DEFAULT_DECIMALIZATION,
  digitError,
  hexError,
  keySizeLabel,
  pinError,
  toDigits,
  toHex,
  type IbmModel,
  type Runner,
  type TabActions,
  type TabModel,
} from './state'

const PVK_BYTES = [8, 16, 24] as const

export interface Ibm3624TabProps {
  model: TabModel<IbmModel>
  runner: Runner
  carry: CarryOverItem[]
  provenance?: string
  actionsRef: RefObject<TabActions | null>
}

export function Ibm3624Tab({ model, runner, carry, provenance, actionsRef }: Ibm3624TabProps) {
  const { state, patch } = model

  const issues = useMemo(
    () => ({
      clearPin: pinError(state.clearPin, false),
      validationData: digitError(state.validationData, {
        label: 'Validation data',
        exact: 16,
      }),
      decimalization: digitError(state.decimalization, {
        label: 'Decimalization table',
        exact: 16,
      }),
      pvk: hexError(state.pvk, { label: 'PVK', bytes: PVK_BYTES }),
      offset: digitError(state.offset, { label: 'PIN offset', min: 4, max: 12 }),
    }),
    [state.clearPin, state.decimalization, state.offset, state.pvk, state.validationData],
  )

  /** Rules shared by both actions. */
  function commonBlocker(): string | undefined {
    if (state.clearPin.length === 0) return 'The clear PIN is required.'
    if (issues.clearPin) return issues.clearPin
    if (state.validationData.length === 0) return 'Validation data is required — 16 digits.'
    if (issues.validationData) return issues.validationData
    if (state.decimalization.length === 0) return 'A decimalization table is required — 16 digits.'
    if (issues.decimalization) return issues.decimalization
    if (state.pvk.length === 0) return 'The PVK is required.'
    if (issues.pvk) return issues.pvk
    return undefined
  }

  function verifyBlocker(): string | undefined {
    const shared = commonBlocker()
    if (shared) return shared
    if (state.offset.length === 0) return 'Enter the PIN offset to verify against.'
    if (issues.offset) return issues.offset
    return undefined
  }

  function calculateOffset(): void {
    const reason = commonBlocker()
    if (reason) {
      runner.fail('pin.ibm3624Offset', reason)
      return
    }
    void runner.run('pin.ibm3624Offset', async () => {
      const data = await call<{ offset: string }>('pin.ibm3624Offset', {
        pin: state.clearPin,
        validationData: state.validationData,
        decimalizationTable: state.decimalization,
        pvkHex: state.pvk,
      })
      return {
        rows: [
          {
            key: 'offset',
            label: 'Offset',
            value: data.offset,
            useAs: 'use as input',
            onUseAs: () => patch({ offset: data.offset }),
          },
        ],
        provenance: `IBM 3624 · offset · PVK ${keySizeLabel(state.pvk)} · table ${state.decimalization}`,
      }
    })
  }

  function verify(): void {
    const reason = verifyBlocker()
    if (reason) {
      runner.fail('pin.verifyIbm3624', reason)
      return
    }
    void runner.run('pin.verifyIbm3624', async () => {
      const data = await call<{ valid: boolean; naturalPin: string }>('pin.verifyIbm3624', {
        pin: state.clearPin,
        offset: state.offset,
        validationData: state.validationData,
        decimalizationTable: state.decimalization,
        pvkHex: state.pvk,
      })
      return {
        rows: [
          { key: 'offset', label: 'Offset', value: state.offset },
          {
            key: 'natural',
            label: 'Natural PIN',
            value: data.naturalPin,
            sensitive: true,
          },
        ],
        verdict: data.valid
          ? { tone: 'ok' as const, label: 'MATCH' }
          : { tone: 'error' as const, label: 'MISMATCH' },
        provenance: `IBM 3624 · verify · PVK ${keySizeLabel(state.pvk)} · table ${state.decimalization}`,
      }
    })
  }

  useEffect(() => {
    actionsRef.current = {
      primary: calculateOffset,
      primaryLabel: 'Calculate Offset',
      secondary: verify,
      secondaryLabel: 'Verify',
    }
    return () => {
      actionsRef.current = null
    }
  })

  const tableIsDefault = state.decimalization === DEFAULT_DECIMALIZATION
  const touched =
    state.clearPin.length + state.validationData.length + state.pvk.length + state.offset.length > 0
  const reason = touched ? commonBlocker() : undefined

  return (
    <div className="flex min-h-0 flex-col">
      <Section label="PIN" aside={<CarryOver items={carry} provenance={provenance} />}>
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

        <Field
          label="PIN offset"
          error={issues.offset}
          hint="Required by Verify. Calculate Offset fills it through ↑ use as input."
        >
          <SecretInput
            value={state.offset}
            onValueChange={(value) => patch({ offset: toDigits(value) })}
            hex={false}
            placeholder="Offset digits"
          />
        </Field>
      </Section>

      <Section label="Validation">
        <Field label="Validation data" error={issues.validationData} hint="16 digits.">
          <Input
            value={state.validationData}
            onValueChange={(value) => patch({ validationData: toDigits(value).slice(0, 16) })}
            mono
            inputMode="numeric"
            maxLength={16}
            placeholder="16 digits"
            invalid={issues.validationData !== undefined}
          />
        </Field>

        <Field
          label="Decimalization table"
          error={issues.decimalization}
          hint="16 digits, one per hex nibble."
        >
          <Input
            value={state.decimalization}
            onValueChange={(value) => patch({ decimalization: toDigits(value).slice(0, 16) })}
            mono
            inputMode="numeric"
            maxLength={16}
            invalid={issues.decimalization !== undefined}
            suffix={
              tableIsDefault ? undefined : (
                <Button
                  size="xs"
                  variant="ghost"
                  icon={RotateCcw}
                  onClick={() => patch({ decimalization: DEFAULT_DECIMALIZATION })}
                >
                  reset to default
                </Button>
              )
            }
          />
        </Field>
      </Section>

      <Section label="Key material">
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
          emptyHint="Calculate an offset, or verify one you already hold."
        />
        {runner.error && <ErrorStrip error={runner.error} onDismiss={runner.clear} />}
      </div>

      <ActionBar blocker={reason}>
        <Button
          variant="primary"
          loading={runner.busy === 'pin.ibm3624Offset'}
          onClick={calculateOffset}
        >
          Calculate Offset
        </Button>
        <Button loading={runner.busy === 'pin.verifyIbm3624'} onClick={verify}>
          Verify
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
