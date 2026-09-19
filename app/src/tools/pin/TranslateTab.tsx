/**
 * ATM Translate sub-tab (UX_SPEC 3.2d).
 *
 * Source and destination sit side by side, which is what the operation actually
 * is. Two pieces of hidden state from the old app are gone: `Load F52` loads
 * into the *visible* source block, and `Apply to F52` writes the *visible*
 * translated output — neither routes through a control belonging to another
 * sub-tool.
 */

import { useEffect, useMemo, useState, type RefObject } from 'react'
import { ArrowRight, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { HexInput } from '@/components/ui/HexInput'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { SecretInput } from '@/components/ui/SecretInput'
import { Select } from '@/components/ui/Select'
import { toast } from '@/components/ui/toast'
import { call } from '@/engine/client'
import { useBuffers } from '@/store/buffers'
import {
  ActionBar,
  CarryOver,
  ErrorStrip,
  Note,
  ResultBlock,
  Section,
  type CarryOverItem,
} from './parts'
import { fieldsWithValue, flashField, loadFieldHex, targetOptions } from './buffer'
import {
  DESTINATION_ALGORITHM_OPTIONS,
  SOURCE_ALGORITHM_OPTIONS,
  TRANSLATE_ALGORITHM_LABEL,
  TRANSLATE_FORMAT_LABEL,
  TRANSLATE_FORMAT_OPTIONS,
  hexError,
  keySizeLabel,
  panError,
  toDigits,
  toHex,
  translateKeyBytes,
  type Runner,
  type TabActions,
  type TabModel,
  type TranslateAlgorithm,
  type TranslateFormat,
  type TranslateModel,
} from './state'

export interface TranslateTabProps {
  model: TabModel<TranslateModel>
  runner: Runner
  carry: CarryOverItem[]
  provenance?: string
  actionsRef: RefObject<TabActions | null>
}

export function TranslateTab({ model, runner, carry, provenance, actionsRef }: TranslateTabProps) {
  const { state, patch } = model
  const [bufferNote, setBufferNote] = useState<string | null>(null)

  const tab = useBuffers((store) => store.tabs.find((candidate) => candidate.id === store.activeId))
  const update = useBuffers((store) => store.update)

  const sourceKeyBytes = translateKeyBytes(state.sourceAlgorithm)
  const destinationKeyBytes = translateKeyBytes(state.destinationAlgorithm)

  const issues = useMemo(
    () => ({
      sourceBlock: hexError(state.sourceBlock, { label: 'Source block', minBytes: 8 }),
      sourceKey: hexError(state.sourceKey, { label: 'Source key', bytes: sourceKeyBytes }),
      destinationKey: hexError(state.destinationKey, {
        label: 'Destination key',
        bytes: destinationKeyBytes,
      }),
      pan: panError(state.pan, false),
    }),
    [
      destinationKeyBytes,
      sourceKeyBytes,
      state.destinationKey,
      state.pan,
      state.sourceBlock,
      state.sourceKey,
    ],
  )

  function blocker(): string | undefined {
    if (state.sourceBlock.length === 0) return 'Enter or load the source PIN block.'
    if (issues.sourceBlock) return issues.sourceBlock
    if (state.sourceKey.length === 0) return 'The source key is required.'
    if (issues.sourceKey) return issues.sourceKey
    if (state.destinationKey.length === 0) return 'The destination key is required.'
    if (issues.destinationKey) return issues.destinationKey
    if (state.pan.length === 0) return 'The PAN is required — both ATM formats bind it.'
    if (issues.pan) return issues.pan
    return undefined
  }

  function translate(): void {
    const reason = blocker()
    if (reason) {
      runner.fail('pin.translateAtm', reason)
      return
    }
    void runner.run('pin.translateAtm', async () => {
      const data = await call<{ translatedHex: string; clearHex: string; pin: string }>(
        'pin.translateAtm',
        {
          blockHex: state.sourceBlock,
          pan: state.pan,
          sourceFormat: state.sourceFormat,
          sourceAlgorithm: state.sourceAlgorithm,
          sourceKeyHex: state.sourceKey,
          destinationFormat: state.destinationFormat,
          destinationAlgorithm: state.destinationAlgorithm,
          destinationKeyHex: state.destinationKey,
        },
      )
      return {
        rows: [
          {
            key: 'translated',
            label: 'Translated block',
            value: data.translatedHex,
            sensitive: true,
            useAs: 'use as source',
            onUseAs: () => patch({ sourceBlock: data.translatedHex }),
          },
          { key: 'clear', label: 'Clear block', value: data.clearHex, sensitive: true },
          { key: 'pin', label: 'Recovered PIN', value: data.pin, sensitive: true },
        ],
        provenance: [
          `${TRANSLATE_ALGORITHM_LABEL[state.sourceAlgorithm]} → ${TRANSLATE_ALGORITHM_LABEL[state.destinationAlgorithm]}`,
          `${TRANSLATE_FORMAT_LABEL[state.sourceFormat]} → ${TRANSLATE_FORMAT_LABEL[state.destinationFormat]}`,
          'PAN bound',
          `keys ${keySizeLabel(state.sourceKey)} / ${keySizeLabel(state.destinationKey)}`,
        ].join(' · '),
      }
    })
  }

  function loadSourceFromField(): void {
    const result = loadFieldHex(tab, state.targetField)
    if (!result.ok) {
      setBufferNote(result.message)
      return
    }
    setBufferNote(null)
    patch({ sourceBlock: result.hex })
    toast.success(`Loaded F${state.targetField} into the source block.`)
  }

  function applyTranslated(): void {
    const translated = runner.result?.rows.find((row) => row.key === 'translated')?.value
    if (!tab) {
      setBufferNote('No buffer is open.')
      return
    }
    if (!translated) {
      setBufferNote('Translate first — there is no translated block to apply.')
      return
    }
    update(tab.id, {
      fields: fieldsWithValue(tab, state.targetField, translated),
      dirty: true,
    })
    setBufferNote(null)
    flashField(state.targetField)
    toast.success(`Wrote the translated block into F${state.targetField} of ${tab.name}.`)
  }

  useEffect(() => {
    actionsRef.current = { primary: translate, primaryLabel: 'Translate' }
    return () => {
      actionsRef.current = null
    }
  })

  const touched =
    state.sourceBlock.length +
      state.sourceKey.length +
      state.destinationKey.length +
      state.pan.length >
    0
  const reason = touched ? blocker() : undefined
  const hasTranslated = runner.result?.rows.some((row) => row.key === 'translated') === true

  return (
    <div className="@container flex min-h-0 flex-col">
      <Section
        label={`Buffer · ${tab?.name ?? 'no buffer'}`}
        aside={<CarryOver items={carry} provenance={provenance} />}
      >
        <Field
          label="Target field"
          hint="Load reads this bit into the source block; Apply writes the translated block back."
        >
          <Select
            value={String(state.targetField)}
            onValueChange={(value) => patch({ targetField: Number(value) })}
            options={targetOptions(tab, state.targetField)}
            disabled={tab === undefined}
          />
        </Field>
        {bufferNote && (
          <InlineAlert tone="warn" onDismiss={() => setBufferNote(null)}>
            {bufferNote}
          </InlineAlert>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-0 border-t border-border-subtle @md:grid-cols-2">
        <Section label="Source" className="@md:border-r @md:border-r-border-subtle">
          <Field label="Block" error={issues.sourceBlock}>
            <HexInput
              value={state.sourceBlock}
              onValueChange={(value) => patch({ sourceBlock: value })}
              placeholder="Source PIN block hex"
              invalid={issues.sourceBlock !== undefined}
            />
          </Field>
          <Button
            size="xs"
            variant="subtle"
            icon={Download}
            onClick={loadSourceFromField}
            disabled={tab === undefined}
            className="self-start"
          >
            Load F{state.targetField}
          </Button>

          <Field label="Format">
            <Select
              value={state.sourceFormat}
              onValueChange={(value) => patch({ sourceFormat: value as TranslateFormat })}
              options={TRANSLATE_FORMAT_OPTIONS}
            />
          </Field>

          <Field label="Algorithm">
            <Select
              value={state.sourceAlgorithm}
              onValueChange={(value) =>
                patch({ sourceAlgorithm: value as TranslateAlgorithm })
              }
              options={SOURCE_ALGORITHM_OPTIONS}
            />
          </Field>

          <Field label="Key" error={issues.sourceKey}>
            <SecretInput
              value={state.sourceKey}
              onValueChange={(value) => patch({ sourceKey: toHex(value) })}
              placeholder={
                state.sourceAlgorithm === 'des'
                  ? 'Source DES key hex (8 bytes)'
                  : 'Source key hex (16 bytes)'
              }
              acceptedByteLengths={sourceKeyBytes}
            />
          </Field>
        </Section>

        <Section label="Destination" className="@md:border-t-0">
          <Field label="Format">
            <Select
              value={state.destinationFormat}
              onValueChange={(value) => patch({ destinationFormat: value as TranslateFormat })}
              options={TRANSLATE_FORMAT_OPTIONS}
            />
          </Field>

          <Field label="Algorithm" hint="TSN-DES is destination-only.">
            <Select
              value={state.destinationAlgorithm}
              onValueChange={(value) =>
                patch({ destinationAlgorithm: value as TranslateAlgorithm })
              }
              options={DESTINATION_ALGORITHM_OPTIONS}
            />
          </Field>

          <Field label="Key" error={issues.destinationKey}>
            <SecretInput
              value={state.destinationKey}
              onValueChange={(value) => patch({ destinationKey: toHex(value) })}
              placeholder={
                state.destinationAlgorithm === 'des'
                  ? 'Destination DES key hex (8 bytes)'
                  : 'Destination key hex (16 bytes)'
              }
              acceptedByteLengths={destinationKeyBytes}
            />
          </Field>
        </Section>
      </div>

      <Section label="Shared">
        <Field label="PAN" error={issues.pan} hint="Bound into both blocks. 12–19 digits.">
          <Input
            value={state.pan}
            onValueChange={(value) => patch({ pan: toDigits(value) })}
            mono
            inputMode="numeric"
            placeholder="Primary account number"
            invalid={issues.pan !== undefined}
          />
        </Field>
        <Note>
          {TRANSLATE_FORMAT_LABEL[state.sourceFormat]} →{' '}
          {TRANSLATE_FORMAT_LABEL[state.destinationFormat]} ·{' '}
          {TRANSLATE_ALGORITHM_LABEL[state.sourceAlgorithm]} →{' '}
          {TRANSLATE_ALGORITHM_LABEL[state.destinationAlgorithm]}
        </Note>
      </Section>

      <div className="flex flex-col gap-2 px-panel pb-3">
        <ResultBlock
          result={runner.result}
          stale={runner.stale}
          emptyHint="Translate a block to see the result."
          actions={
            <Button
              size="xs"
              variant="subtle"
              icon={Upload}
              onClick={applyTranslated}
              disabled={!hasTranslated || tab === undefined}
            >
              Apply to F{state.targetField}
            </Button>
          }
        />
        {runner.error && <ErrorStrip error={runner.error} onDismiss={runner.clear} />}
      </div>

      <ActionBar blocker={reason}>
        <Button
          variant="primary"
          icon={ArrowRight}
          loading={runner.busy === 'pin.translateAtm'}
          onClick={translate}
        >
          Translate
        </Button>
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            model.reset()
            runner.clear()
            setBufferNote(null)
          }}
        >
          Clear
        </Button>
      </ActionBar>
    </div>
  )
}
