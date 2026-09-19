/**
 * PIN Blocks sub-tab (UX_SPEC 3.2a).
 *
 * Every control of the old panel survives, but three of its worst behaviours do
 * not: the PAN no longer greys out without a reason, the encrypted-block field
 * is no longer a hidden carrier for the ATM translate, and Decode/Decrypt write
 * into their own result rows instead of overwriting the operator's inputs.
 */

import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { HexInput } from '@/components/ui/HexInput'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { SecretInput } from '@/components/ui/SecretInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { toast } from '@/components/ui/toast'
import { call } from '@/engine/client'
import { useBuffers } from '@/store/buffers'
import {
  ActionBar,
  CarryOver,
  CountLabel,
  ErrorStrip,
  Note,
  ResultBlock,
  Section,
  type CarryOverItem,
} from './parts'
import { fieldsWithValue, flashField, loadFieldHex, targetOptions } from './buffer'
import {
  BLOCK_FORMAT_LABEL,
  BLOCK_FORMAT_OPTIONS,
  blockKeyBytes,
  hexError,
  isAesFormat,
  keySizeLabel,
  panError,
  pinError,
  toDigits,
  toHex,
  type BlockFormat,
  type BlocksModel,
  type Runner,
  type TabActions,
  type TabModel,
} from './state'

export interface PinBlocksTabProps {
  model: TabModel<BlocksModel>
  runner: Runner
  carry: CarryOverItem[]
  provenance?: string
  actionsRef: RefObject<TabActions | null>
}

interface BufferNote {
  message: string
  /** The bit is simply absent, so offering to create it is the useful next step. */
  offerAdd: boolean
}

export function PinBlocksTab({ model, runner, carry, provenance, actionsRef }: PinBlocksTabProps) {
  const { state, patch } = model
  const [bufferNote, setBufferNote] = useState<BufferNote | null>(null)

  const tab = useBuffers((store) => store.tabs.find((candidate) => candidate.id === store.activeId))
  const update = useBuffers((store) => store.update)

  const aes = isAesFormat(state.format)
  const formatLabel = BLOCK_FORMAT_LABEL[state.format]
  const keyBytes = blockKeyBytes(state.format)
  /** ISO-1 has no PAN in the block at all — the field is disabled, with a reason. */
  const panApplies = state.format !== 'iso1'

  const issues = useMemo(() => {
    return {
      pan: panApplies ? panError(state.pan, false) : undefined,
      clearPin: pinError(state.clearPin, false),
      clearBlock: aes
        ? undefined
        : hexError(state.clearBlock, { label: 'Clear PIN block', minBytes: 8 }),
      encryptedBlock: hexError(state.encryptedBlock, {
        label: 'Encrypted PIN block',
        minBytes: 8,
      }),
      key: hexError(state.key, { label: 'Key', bytes: keyBytes }),
    }
  }, [aes, keyBytes, panApplies, state.clearBlock, state.clearPin, state.encryptedBlock, state.key, state.pan])

  /* ── Pre-flight rules, per action ─────────────────────────────────────── */

  function createBlocker(): string | undefined {
    if (state.clearPin.length === 0) return 'Enter the clear PIN before creating a block.'
    if (issues.clearPin) return issues.clearPin
    if (panApplies && state.pan.length === 0) return `${formatLabel} binds the PAN — enter it.`
    if (issues.pan) return issues.pan
    if (aes && state.key.length === 0) return 'ISO-4 needs an AES key to create a block.'
    if (issues.key) return issues.key
    return undefined
  }

  function decodeBlocker(): string | undefined {
    const block = aes ? state.encryptedBlock : state.clearBlock
    if (block.length === 0) {
      return aes ? 'Enter the encrypted ISO-4 block to decode.' : 'Enter the clear PIN block to decode.'
    }
    if (aes ? issues.encryptedBlock : issues.clearBlock) {
      return (aes ? issues.encryptedBlock : issues.clearBlock) as string
    }
    if (panApplies && state.pan.length === 0) return `${formatLabel} binds the PAN — enter it.`
    if (issues.pan) return issues.pan
    if (aes && state.key.length === 0) return 'ISO-4 needs an AES key to decode a block.'
    if (issues.key) return issues.key
    return undefined
  }

  function encryptBlocker(): string | undefined {
    if (aes) return 'ISO-4 encrypts inside Create and Decode.'
    if (state.clearBlock.length === 0) return 'Enter the clear PIN block to encrypt.'
    if (issues.clearBlock) return issues.clearBlock
    if (state.key.length === 0) return 'A 3DES key is required to encrypt.'
    if (issues.key) return issues.key
    return undefined
  }

  function decryptBlocker(): string | undefined {
    if (aes) return 'ISO-4 decrypts inside Create and Decode.'
    if (state.encryptedBlock.length === 0) return 'Enter the encrypted PIN block to decrypt.'
    if (issues.encryptedBlock) return issues.encryptedBlock
    if (state.key.length === 0) return 'A 3DES key is required to decrypt.'
    if (issues.key) return issues.key
    return undefined
  }

  /* ── Engine calls ─────────────────────────────────────────────────────── */

  function runCreate(): void {
    const blocker = createBlocker()
    if (blocker) {
      runner.fail('pin.create', blocker)
      return
    }
    void runner.run('pin.create', async () => {
      const data = await call<{ hex: string; pin: string }>('pin.create', {
        format: state.format,
        pin: state.clearPin,
        pan: panApplies ? state.pan : '',
        keyHex: state.key,
      })
      return {
        rows: [
          {
            key: 'block',
            label: aes ? 'Encrypted PIN block' : 'Clear PIN block',
            value: data.hex,
            sensitive: true,
            useAs: 'use as input',
            onUseAs: () =>
              patch(aes ? { encryptedBlock: data.hex } : { clearBlock: data.hex }),
          },
        ],
        provenance: [
          `${formatLabel} · Create`,
          panApplies ? 'PAN bound' : 'PAN not bound',
          state.key.length > 0 ? `key ${keySizeLabel(state.key)}` : 'no key',
        ].join(' · '),
      }
    })
  }

  function runDecode(): void {
    const blocker = decodeBlocker()
    if (blocker) {
      runner.fail('pin.decode', blocker)
      return
    }
    const blockHex = aes ? state.encryptedBlock : state.clearBlock
    void runner.run('pin.decode', async () => {
      const data = await call<{ pin: string }>('pin.decode', {
        format: state.format,
        blockHex,
        pan: panApplies ? state.pan : '',
        keyHex: state.key,
      })
      return {
        rows: [
          {
            key: 'pin',
            label: 'Recovered PIN',
            value: data.pin,
            sensitive: true,
            note: `${data.pin.length} digits`,
            useAs: 'use as input',
            onUseAs: () => patch({ clearPin: data.pin }),
          },
        ],
        provenance: [
          `${formatLabel} · Decode`,
          `${blockHex.length / 2} byte block`,
          panApplies ? 'PAN bound' : 'PAN not bound',
        ].join(' · '),
      }
    })
  }

  function runEncrypt(): void {
    const blocker = encryptBlocker()
    if (blocker) {
      runner.fail('pin.encrypt', blocker)
      return
    }
    void runner.run('pin.encrypt', async () => {
      const data = await call<{ hex: string }>('pin.encrypt', {
        blockHex: state.clearBlock,
        keyHex: state.key,
      })
      return {
        rows: [
          {
            key: 'encrypted',
            label: 'Encrypted PIN block',
            value: data.hex,
            sensitive: true,
            useAs: 'use as input',
            onUseAs: () => patch({ encryptedBlock: data.hex }),
          },
        ],
        provenance: `3DES · Encrypt · key ${keySizeLabel(state.key)}`,
      }
    })
  }

  function runDecrypt(): void {
    const blocker = decryptBlocker()
    if (blocker) {
      runner.fail('pin.decrypt', blocker)
      return
    }
    void runner.run('pin.decrypt', async () => {
      const data = await call<{ hex: string }>('pin.decrypt', {
        blockHex: state.encryptedBlock,
        keyHex: state.key,
      })
      return {
        rows: [
          {
            key: 'clear',
            label: 'Recovered clear block',
            value: data.hex,
            sensitive: true,
            useAs: 'use as input',
            onUseAs: () => patch({ clearBlock: data.hex }),
          },
        ],
        provenance: `3DES · Decrypt · key ${keySizeLabel(state.key)}`,
      }
    })
  }

  /* ── Buffer exchange ──────────────────────────────────────────────────── */

  function loadFromField(): void {
    const result = loadFieldHex(tab, state.targetField)
    if (!result.ok) {
      setBufferNote({ message: result.message, offerAdd: result.reason === 'missing' })
      return
    }
    setBufferNote(null)
    patch({ encryptedBlock: result.hex })
    toast.success(`Loaded F${state.targetField} into the encrypted PIN block.`)
  }

  function applyToField(): void {
    if (!tab) {
      setBufferNote({ message: 'No buffer is open.', offerAdd: false })
      return
    }
    if (state.encryptedBlock.length === 0) {
      setBufferNote({
        message: 'The encrypted PIN block is empty — there is nothing to apply.',
        offerAdd: false,
      })
      return
    }
    update(tab.id, {
      fields: fieldsWithValue(tab, state.targetField, state.encryptedBlock),
      dirty: true,
    })
    setBufferNote(null)
    flashField(state.targetField)
    toast.success(`Wrote the encrypted PIN block into F${state.targetField} of ${tab.name}.`)
  }

  function addTargetField(): void {
    if (!tab) return
    update(tab.id, { fields: fieldsWithValue(tab, state.targetField, ''), dirty: true })
    setBufferNote(null)
    flashField(state.targetField)
  }

  /* ── Ctrl+Enter / Ctrl+Shift+Enter ────────────────────────────────────── */

  useEffect(() => {
    actionsRef.current = {
      primary: runCreate,
      secondary: runDecode,
      primaryLabel: 'Create',
      secondaryLabel: 'Decode',
    }
    return () => {
      actionsRef.current = null
    }
  })

  const busy = runner.busy

  return (
    <div className="flex min-h-0 flex-col">
      <Section
        label="Format"
        aside={<CarryOver items={carry} provenance={provenance} />}
      >
        <SegmentedControl
          value={state.format}
          onValueChange={(value) => patch({ format: value as BlockFormat })}
          options={BLOCK_FORMAT_OPTIONS}
        />
        {aes && <Note>ISO-4 is AES. Encryption happens inside Create and Decode.</Note>}
      </Section>

      <Section label="Identity">
        <Field
          label="PAN"
          error={issues.pan}
          hint={panApplies ? '12–19 digits. Bound into the block.' : undefined}
        >
          <Input
            value={state.pan}
            onValueChange={(value) => patch({ pan: toDigits(value) })}
            mono
            disabled={!panApplies}
            inputMode="numeric"
            placeholder="Primary account number"
            invalid={issues.pan !== undefined}
          />
        </Field>
        {!panApplies && <Note>ISO-1 does not bind the PAN.</Note>}

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

      <Section label="Blocks">
        {aes ? (
          <Note>ISO-4 has no clear block stage.</Note>
        ) : (
          <Field label="Clear PIN block" error={issues.clearBlock}>
            <HexInput
              value={state.clearBlock}
              onValueChange={(value) => patch({ clearBlock: value })}
              placeholder={`Clear ${formatLabel} PIN block hex`}
              invalid={issues.clearBlock !== undefined}
            />
          </Field>
        )}

        <Field label="Encrypted PIN block" error={issues.encryptedBlock}>
          <HexInput
            value={state.encryptedBlock}
            onValueChange={(value) => patch({ encryptedBlock: value })}
            placeholder={
              aes ? 'Encrypted ISO-4 PIN block hex' : '3DES encrypted PIN block hex'
            }
            invalid={issues.encryptedBlock !== undefined}
          />
        </Field>
      </Section>

      <Section label="Key">
        <Field label={aes ? 'AES key' : 'PIN key'} error={issues.key}>
          <SecretInput
            value={state.key}
            onValueChange={(value) => patch({ key: toHex(value) })}
            placeholder={
              aes
                ? 'AES key hex (16, 24, or 32 bytes)'
                : 'PIN key hex (16 or 24 bytes for optional 3DES)'
            }
            acceptedByteLengths={keyBytes}
          />
        </Field>
      </Section>

      <Section
        label={`Buffer · ${tab?.name ?? 'no buffer'}`}
        aside={
          <span className="text-2xs text-text-tertiary">
            target: F{state.targetField}
          </span>
        }
      >
        <Field label="Target field" hint="Load and Apply exchange the encrypted block with this bit.">
          <Select
            value={String(state.targetField)}
            onValueChange={(value) => patch({ targetField: Number(value) })}
            options={targetOptions(tab, state.targetField)}
            disabled={tab === undefined}
          />
        </Field>
        {bufferNote && (
          <InlineAlert
            tone="warn"
            onDismiss={() => setBufferNote(null)}
            action={
              bufferNote.offerAdd && tab ? (
                <Button size="xs" onClick={addTargetField}>
                  Add F{state.targetField}
                </Button>
              ) : undefined
            }
          >
            {bufferNote.message}
          </InlineAlert>
        )}
      </Section>

      <div className="flex flex-col gap-2 px-panel pb-3">
        <ResultBlock
          result={runner.result}
          stale={runner.stale}
          emptyHint="Create, Decode, Encrypt or Decrypt to produce a result."
        />
        {runner.error && <ErrorStrip error={runner.error} onDismiss={runner.clear} />}
      </div>

      <ActionBar blocker={aes ? 'ISO-4 encrypts inside Create and Decode.' : undefined}>
        <Button variant="primary" loading={busy === 'pin.create'} onClick={runCreate}>
          Create
        </Button>
        <Button loading={busy === 'pin.decode'} onClick={runDecode}>
          Decode
        </Button>
        <Button
          loading={busy === 'pin.encrypt'}
          disabled={aes}
          title={aes ? 'ISO-4 encrypts inside Create and Decode.' : undefined}
          onClick={runEncrypt}
        >
          Encrypt
        </Button>
        <Button
          loading={busy === 'pin.decrypt'}
          disabled={aes}
          title={aes ? 'ISO-4 decrypts inside Create and Decode.' : undefined}
          onClick={runDecrypt}
        >
          Decrypt
        </Button>
        <Button variant="subtle" icon={Download} onClick={loadFromField} disabled={tab === undefined}>
          Load F{state.targetField}
        </Button>
        <Button variant="subtle" icon={Upload} onClick={applyToField} disabled={tab === undefined}>
          Apply F{state.targetField}
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
