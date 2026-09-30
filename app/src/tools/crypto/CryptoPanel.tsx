/**
 * The Crypto tool (UX_SPEC 3.3).
 *
 * Every control of the old Qt panel survives — algorithm, `Text In`/`Hex In`,
 * `Text Out`/`Hex Out`, key, IV, `Use block padding`, the input body and the
 * output body — reorganized into `Algorithm` / `Key material` / `Data`, with
 * the three fixes the spec calls for:
 *
 *   1. The algorithm select states the required key size per option and the key
 *      is validated **before** Run, so an algorithm switch that leaves a stale
 *      key disables Encrypt/Decrypt with a sentence instead of producing a
 *      terse backend error afterwards.
 *   2. The IV is disabled for ECB with `ECB does not use an IV.` The old
 *      always-enabled IV was silently ignored.
 *   3. The output block carries `Copy`, `Send output to input`, `Send to
 *      buffer` and `Send to field…`.
 *
 * Secrets: the key lives in this component's state and nowhere else. It is
 * never persisted, never logged, never placed in the recent-runs history, and
 * it is wiped on unmount and on `Clear all secrets` (`Ctrl+Alt+L`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ArrowRightLeft, CornerUpRight, Eraser, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { Field } from '@/components/ui/Field'
import { HexInput } from '@/components/ui/HexInput'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { SecretInput } from '@/components/ui/SecretInput'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { tryCall } from '@/engine/client'
import { SHELL_ACTION_EVENT, SHELL_COMMAND_EVENT } from '@/shell/useShortcuts'
import type { ShellActionDetail, ShellCommandDetail } from '@/shell/useShortcuts'
import { reportToolStatus } from '@/shell/toolStatus'
import { useBuffers, type FieldRow } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { cn } from '@/lib/cn'
import {
  CRYPTO_ALGORITHMS,
  DEFAULT_ALGORITHM,
  isCryptoAlgorithm,
  keyBytesPhrase,
  requirementHint,
  scanHex,
  specFor,
  validateIv,
  validateKey,
  validatePayload,
  type CryptoAlgorithm,
  type CryptoOperation,
} from './algorithms'
import { ResultBlock } from './ResultBlock'
import { RecentRuns, RECENT_RUN_LIMIT, makeRunId, type CryptoRun } from './RecentRuns'
import { SendToFieldPopover } from './SendToFieldPopover'

const TOOL_ID = 'crypto'
const SOURCE = 'Crypto'

/** Everything one run needs. Assembled from state, or replayed from history. */
interface RunConfig {
  algorithm: CryptoAlgorithm
  operation: CryptoOperation
  /** The input body exactly as typed, in `inputHex`'s representation. */
  payloadRaw: string
  inputHex: boolean
  outputHex: boolean
  usePadding: boolean
  ivHex: string
}

interface CryptoResultState {
  hex: string
  text: string
  algorithm: CryptoAlgorithm
  operation: CryptoOperation
  inBytes: number
  outBytes: number
  usePadding: boolean
  at: number
  /** Inputs at the moment of the run. Drives the stale badge. */
  signature: string
}

interface EngineFailure {
  operation: CryptoOperation
  message: string
  code: string
}

interface TransformData {
  hex: string
  text: string
  byteLength: number
}

/**
 * FNV-1a over the key, used only to notice that the key changed since the last
 * run. It is held in memory alongside the key it summarizes, is never
 * rendered, never copied and never persisted.
 */
function fingerprint(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function clockTime(at: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function CryptoPanel() {
  /* ── Controls ───────────────────────────────────────────────────────────── */

  const [algorithm, setAlgorithm] = useState<CryptoAlgorithm>(DEFAULT_ALGORITHM)
  const [keyHex, setKeyHex] = useState('')
  const [ivHex, setIvHex] = useState('')
  const [usePadding, setUsePadding] = useState(true)
  const [inputHex, setInputHex] = useState(false)
  const [outputHex, setOutputHex] = useState(true)
  const [input, setInput] = useState('')

  /* ── Run state ──────────────────────────────────────────────────────────── */

  const [result, setResult] = useState<CryptoResultState | null>(null)
  const [failure, setFailure] = useState<EngineFailure | null>(null)
  const [running, setRunning] = useState<CryptoOperation | null>(null)
  const [runs, setRuns] = useState<CryptoRun[]>([])

  const spec = useMemo(() => specFor(algorithm), [algorithm])

  /* ── Workspace context ──────────────────────────────────────────────────── */

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const updateBuffer = useBuffers((state) => state.update)
  const newTab = useBuffers((state) => state.newTab)
  const addProblem = useProblems((state) => state.add)

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId),
    [tabs, activeId],
  )

  /* ── Validation, all of it client-side and all of it pre-flight ─────────── */

  const keyProblem = useMemo(() => validateKey(keyHex, spec), [keyHex, spec])
  const ivProblem = useMemo(() => validateIv(ivHex, spec), [ivHex, spec])
  const encryptPayload = useMemo(
    () => validatePayload(input, inputHex, spec, 'encrypt', usePadding),
    [input, inputHex, spec, usePadding],
  )
  const decryptPayload = useMemo(
    () => validatePayload(input, inputHex, spec, 'decrypt', usePadding),
    [input, inputHex, spec, usePadding],
  )

  const canEncrypt = !keyProblem && !ivProblem && !encryptPayload.problem && running === null
  const canDecrypt = !keyProblem && !ivProblem && !decryptPayload.problem && running === null

  /** Why the primary/secondary button is unavailable, for its tooltip. */
  function blockedReason(operation: CryptoOperation): string | undefined {
    if (running !== null) return `A ${running} run is in flight.`
    if (keyProblem) return keyProblem.message
    if (ivProblem) return ivProblem.message
    const payload = operation === 'encrypt' ? encryptPayload : decryptPayload
    return payload.problem?.message
  }

  /* ── Staleness (UX_SPEC 3.0) ────────────────────────────────────────────── */

  const signature = useMemo(() => {
    const payloadClean = inputHex ? scanHex(input).clean : input
    const iv = spec.ivBytes === 0 ? '' : scanHex(ivHex).clean
    return [algorithm, payloadClean, String(inputHex), String(usePadding), iv, String(fingerprint(keyHex))].join(
      '',
    )
  }, [algorithm, input, inputHex, ivHex, keyHex, spec.ivBytes, usePadding])

  const stale = result !== null && result.signature !== signature

  /* ── Rail state dots. Booleans only, never material. ────────────────────── */

  useEffect(() => {
    reportToolStatus(TOOL_ID, {
      result: result !== null,
      stale,
      error: failure !== null,
      secret: keyHex.length > 0,
    })
  }, [failure, keyHex.length, result, stale])

  /* ── The run ────────────────────────────────────────────────────────────── */

  const runRef = useRef<((operation: CryptoOperation) => void) | null>(null)

  const execute = useCallback(
    async (config: RunConfig) => {
      const activeSpec = specFor(config.algorithm)
      const key = validateKey(keyHex, activeSpec)
      if (key) {
        setFailure({ operation: config.operation, message: key.message, code: 'BAD_LENGTH' })
        return
      }
      const iv = validateIv(config.ivHex, activeSpec)
      if (iv) {
        setFailure({ operation: config.operation, message: iv.message, code: 'BAD_LENGTH' })
        return
      }
      const payload = validatePayload(
        config.payloadRaw,
        config.inputHex,
        activeSpec,
        config.operation,
        config.usePadding,
      )
      if (payload.problem) {
        setFailure({ operation: config.operation, message: payload.problem.message, code: 'BAD_ARGUMENT' })
        return
      }

      setFailure(null)
      setRunning(config.operation)

      const response = await tryCall<TransformData>('crypto.transform', {
        algorithm: config.algorithm,
        operation: config.operation,
        payload: payload.payload,
        inputHex: config.inputHex,
        keyHex: scanHex(keyHex).clean,
        ivHex: activeSpec.ivBytes === 0 ? '' : scanHex(config.ivHex).clean,
        usePadding: config.usePadding,
      })

      setRunning(null)

      if (!response.ok) {
        const message = response.error.message
        setFailure({ operation: config.operation, message, code: response.error.code })
        addProblem({
          severity: 'error',
          source: SOURCE,
          message: `${config.algorithm} ${config.operation} failed: ${message}`,
        })
        return
      }

      const at = Date.now()
      const ivClean = activeSpec.ivBytes === 0 ? '' : scanHex(config.ivHex).clean
      const runSignature = [
        config.algorithm,
        payload.payload,
        String(config.inputHex),
        String(config.usePadding),
        ivClean,
        String(fingerprint(keyHex)),
      ].join('')

      setResult({
        hex: response.data.hex,
        text: response.data.text,
        algorithm: config.algorithm,
        operation: config.operation,
        inBytes: payload.byteLength,
        outBytes: response.data.byteLength,
        usePadding: config.usePadding,
        at,
        signature: runSignature,
      })

      setRuns((previous) =>
        [
          {
            id: makeRunId(),
            algorithm: config.algorithm,
            operation: config.operation,
            payload: config.payloadRaw,
            inputHex: config.inputHex,
            outputHex: config.outputHex,
            usePadding: config.usePadding,
            ivHex: ivClean,
            inBytes: payload.byteLength,
            outBytes: response.data.byteLength,
            at,
          },
          ...previous,
        ].slice(0, RECENT_RUN_LIMIT),
      )
    },
    [addProblem, keyHex],
  )

  const runOperation = useCallback(
    (operation: CryptoOperation) => {
      void execute({
        algorithm,
        operation,
        payloadRaw: input,
        inputHex,
        outputHex,
        usePadding,
        ivHex,
      })
    },
    [algorithm, execute, input, inputHex, ivHex, outputHex, usePadding],
  )

  runRef.current = runOperation

  /* ── Shell wiring: Ctrl+Enter / Ctrl+Shift+Enter and Clear all secrets ──── */

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (!detail) return
      // The shell names the active tool in focused and split layouts.
      const mine = detail.tool === TOOL_ID
      if (!mine) return
      runRef.current?.(detail.kind === 'primary' ? 'encrypt' : 'decrypt')
    }
    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    return () => document.removeEventListener(SHELL_ACTION_EVENT, onAction)
  }, [])

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<ShellCommandDetail>).detail
      if (detail?.command !== 'clear-secrets') return
      setKeyHex('')
    }
    document.addEventListener(SHELL_COMMAND_EVENT, onCommand)
    return () => document.removeEventListener(SHELL_COMMAND_EVENT, onCommand)
  }, [])

  // Closing the tool unmounts this component, which discards the key, the IV,
  // the result and the run history along with it (UX_SPEC 3.0, 5.5). Nothing
  // here is held in a ref or a module-level cache, so there is no second copy
  // to wipe.

  /* ── Output plumbing ────────────────────────────────────────────────────── */

  const outputValue = result === null ? '' : outputHex ? result.hex : result.text

  const provenance =
    result === null
      ? ''
      : [
          result.algorithm,
          result.operation,
          `${result.inBytes} bytes in / ${result.outBytes} bytes out`,
          result.usePadding ? 'padding on' : 'padding off',
          clockTime(result.at),
        ].join(' · ')

  const sendOutputToInput = useCallback(() => {
    if (result === null) return
    const value = outputHex ? result.hex : result.text
    setInput(value)
    setInputHex(outputHex)
    toast.success(`Output moved to input as ${outputHex ? 'hex' : 'text'}.`)
  }, [outputHex, result])

  const sendToBuffer = useCallback(() => {
    if (result === null) return
    const value = outputHex ? result.hex : result.text
    if (activeTab) {
      updateBuffer(activeTab.id, { raw: value, inputHex: outputHex })
      toast.success(`Wrote ${result.outBytes} bytes into ${activeTab.name}.`)
      addProblem({
        severity: 'info',
        source: SOURCE,
        message: `${result.algorithm} ${result.operation} output (${result.outBytes} bytes) replaced the raw pane of ${activeTab.name}.`,
      })
      return
    }
    newTab({ raw: value, inputHex: outputHex })
    toast.success(`Opened a new buffer with ${result.outBytes} bytes.`)
  }, [activeTab, addProblem, newTab, outputHex, result, updateBuffer])

  const sendToField = useCallback(
    (fieldId: number) => {
      if (result === null || !activeTab) return
      const existing = activeTab.fields.find((row) => row.id === fieldId)
      // Match the row's own representation when it already has one, so a hex
      // field never receives a text rendering of the same bytes.
      const asHex = existing ? (existing.hex ?? false) : outputHex
      const value = asHex ? result.hex : result.text

      const next: FieldRow[] = existing
        ? activeTab.fields.map((row) =>
            row.id === fieldId ? { ...row, value, hex: asHex, invalid: undefined } : row,
          )
        : [...activeTab.fields, { id: fieldId, value, hex: asHex }].sort((a, b) => a.id - b.id)

      updateBuffer(activeTab.id, { fields: next })
      const label = `F${String(fieldId).padStart(3, '0')}`
      toast.success(`Applied ${result.outBytes} bytes to ${label} in ${activeTab.name}.`)
      addProblem({
        severity: 'info',
        source: SOURCE,
        fieldId,
        message: `${result.algorithm} ${result.operation} output (${result.outBytes} bytes) was applied to ${label} in ${activeTab.name}.`,
      })
    },
    [activeTab, addProblem, outputHex, result, updateBuffer],
  )

  const rerun = useCallback(
    (run: CryptoRun) => {
      setAlgorithm(run.algorithm)
      setInput(run.payload)
      setInputHex(run.inputHex)
      setOutputHex(run.outputHex)
      setUsePadding(run.usePadding)
      setIvHex(run.ivHex)
      if (keyHex.trim() === '') {
        setFailure({
          operation: run.operation,
          message: `The Key field is empty. Keys are never stored in history — enter the ${keyBytesPhrase(specFor(run.algorithm))}-byte ${specFor(run.algorithm).family} key and run again.`,
          code: 'BAD_ARGUMENT',
        })
        return
      }
      void execute({
        algorithm: run.algorithm,
        operation: run.operation,
        payloadRaw: run.payload,
        inputHex: run.inputHex,
        outputHex: run.outputHex,
        usePadding: run.usePadding,
        ivHex: run.ivHex,
      })
    },
    [execute, keyHex],
  )

  const clearData = useCallback(() => {
    setInput('')
    setResult(null)
    setFailure(null)
  }, [])

  /* ── Render ─────────────────────────────────────────────────────────────── */

  // A problem both operations share (empty, bad hex, odd nibble) is an error on
  // the input itself. A problem only one operation has (block alignment) is a
  // note naming that operation — it must not paint the field red for a run the
  // operator is not attempting.
  const sharedProblem =
    encryptPayload.problem && decryptPayload.problem && encryptPayload.problem.message === decryptPayload.problem.message
      ? encryptPayload.problem.message
      : undefined
  const encryptOnlyProblem = sharedProblem ? undefined : encryptPayload.problem?.message
  const decryptOnlyProblem = sharedProblem ? undefined : decryptPayload.problem?.message
  const inputByteLabel = `${encryptPayload.byteLength} bytes`

  const algorithmOptions = CRYPTO_ALGORITHMS.map((id) => ({
    value: id,
    label: id,
    hint: requirementHint(specFor(id)),
  }))

  return (
    <div className="flex min-h-0 flex-col gap-group p-panel">
      {/* ── Algorithm ──────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-field">
        <h3 className="text-2xs font-medium tracking-wide text-text-secondary uppercase">Algorithm</h3>

        <Field
          label="Algorithm"
          hint={`${algorithm} · ${requirementHint(spec)} · ${spec.blockBytes}-byte blocks`}
          htmlFor="crypto-algorithm"
        >
          <Select
            id="crypto-algorithm"
            mono
            value={algorithm}
            onValueChange={(value) => {
              if (isCryptoAlgorithm(value)) setAlgorithm(value)
            }}
            options={algorithmOptions}
          />
        </Field>

        <Checkbox
          checked={usePadding}
          onCheckedChange={setUsePadding}
          label="Use block padding"
          description={`PKCS#7 to a ${spec.blockBytes}-byte boundary. Off requires an exact multiple of ${spec.blockBytes} bytes.`}
        />
      </section>

      {/* ── Key material ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-field border-t border-border-subtle pt-2">
        <h3 className="text-2xs font-medium tracking-wide text-text-secondary uppercase">Key material</h3>

        <Field
          label="Key"
          hint={`${keyBytesPhrase(spec)} bytes hex`}
          error={keyHex.trim() === '' ? undefined : keyProblem?.message}
          htmlFor="crypto-key"
        >
          <SecretInput
            id="crypto-key"
            value={keyHex}
            onValueChange={setKeyHex}
            placeholder={`${spec.family} key hex (${keyBytesPhrase(spec)} bytes)`}
            acceptedByteLengths={spec.keyBytes}
          />
        </Field>

        <Field
          label="IV"
          hint={
            spec.ivBytes === 0
              ? 'ECB does not use an IV.'
              : `${spec.ivBytes} bytes hex, required by ${spec.mode}.`
          }
          error={ivHex.trim() === '' ? undefined : ivProblem?.message}
          htmlFor="crypto-iv"
        >
          <HexInput
            id="crypto-iv"
            value={ivHex}
            onValueChange={setIvHex}
            disabled={spec.ivBytes === 0}
            {...(spec.ivBytes === 0 ? {} : { expectedBytes: spec.ivBytes })}
            invalid={Boolean(ivProblem)}
            placeholder={spec.ivBytes === 0 ? 'Not used in ECB' : `${spec.ivBytes}-byte IV`}
          />
        </Field>
      </section>

      {/* ── Data ───────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-field border-t border-border-subtle pt-2">
        <h3 className="text-2xs font-medium tracking-wide text-text-secondary uppercase">Data</h3>

        <div className="flex flex-wrap items-center gap-2">
          <span id="crypto-input-mode-label" className="text-xs text-text-secondary">
            Input
          </span>
          <SegmentedControl
            aria-labelledby="crypto-input-mode-label"
            value={inputHex ? 'hex' : 'text'}
            onValueChange={(value) => setInputHex(value === 'hex')}
            options={[
              { value: 'text', label: 'Text In' },
              { value: 'hex', label: 'Hex In' },
            ]}
          />
          <span
            className={cn(
              'ml-auto font-mono text-mono-xs tabular-nums',
              sharedProblem ? 'text-warn' : 'text-text-tertiary',
            )}
          >
            {inputByteLabel}
          </span>
        </div>

        <Textarea
          id="crypto-input"
          aria-label="Input body"
          aria-describedby="crypto-input-notes"
          value={input}
          onValueChange={setInput}
          mono={inputHex}
          rows={4}
          autoResize
          invalid={input !== '' && Boolean(sharedProblem)}
          placeholder={inputHex ? 'Payload hex, e.g. 4142 4344' : 'Payload text'}
          spellCheck={false}
        />

        <div id="crypto-input-notes" className="flex flex-col gap-1 empty:hidden">
          {input !== '' && sharedProblem && (
            <p className="flex items-start gap-1 text-xs text-error">
              <AlertCircle size={14} strokeWidth={1.25} absoluteStrokeWidth className="mt-px shrink-0" aria-hidden="true" />
              <span>{sharedProblem}</span>
            </p>
          )}
          {encryptOnlyProblem && (
            <p className="text-xs text-warn">Encrypt is blocked: {encryptOnlyProblem}</p>
          )}
          {decryptOnlyProblem && (
            <p className="text-xs text-warn">Decrypt is blocked: {decryptOnlyProblem}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span id="crypto-output-mode-label" className="text-xs text-text-secondary">
            Output
          </span>
          <SegmentedControl
            aria-labelledby="crypto-output-mode-label"
            value={outputHex ? 'hex' : 'text'}
            onValueChange={(value) => setOutputHex(value === 'hex')}
            options={[
              { value: 'text', label: 'Text Out' },
              { value: 'hex', label: 'Hex Out' },
            ]}
          />
          <span className="text-xs text-text-tertiary">
            Both representations come back from one run — switching does not re-run.
          </span>
        </div>
      </section>

      {/* ── Result ─────────────────────────────────────────────────────── */}
      <ResultBlock
        value={outputValue}
        isHex={outputHex}
        provenance={provenance}
        stale={stale}
        running={running !== null}
        hasResult={result !== null}
        actions={
          <>
            <Button size="xs" variant="ghost" icon={ArrowRightLeft} onClick={sendOutputToInput}>
              Send output to input
            </Button>
            <Button size="xs" variant="ghost" icon={CornerUpRight} onClick={sendToBuffer}>
              {activeTab ? `Send to ${activeTab.name}` : 'Send to a new buffer'}
            </Button>
            <SendToFieldPopover
              fields={activeTab?.fields ?? []}
              bufferName={activeTab?.name}
              disabled={!activeTab}
              disabledReason="No buffer is open. Open or create a buffer to apply the output to a field."
              onSend={sendToField}
            />
            <CopyButton value={outputValue} label="Copy output" showLabel size="xs" />
          </>
        }
      />

      {/* ── Recent runs ────────────────────────────────────────────────── */}
      <RecentRuns
        runs={runs}
        onRerun={rerun}
        onClear={() => setRuns([])}
        keyPresent={keyHex.trim() !== ''}
      />

      {/* ── Error strip, immediately above the action bar ──────────────── */}
      {failure && (
        <InlineAlert
          tone="error"
          title={`${failure.operation === 'encrypt' ? 'Encrypt' : 'Decrypt'} failed`}
          onDismiss={() => setFailure(null)}
          action={<CopyButton value={`${failure.code}: ${failure.message}`} label="Copy error" />}
        >
          <p className="break-words">{failure.message}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-text-secondary">Details</summary>
            <pre className="mt-1 overflow-x-auto font-mono text-mono-xs text-text-secondary">
              {`op    crypto.transform
code  ${failure.code}
algo  ${algorithm}
mode  ${failure.operation}`}
            </pre>
          </details>
        </InlineAlert>
      )}

      {/* ── Action bar ─────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-surface-1 py-2">
        <Tooltip content={blockedReason('encrypt')}>
          <Button
            variant="primary"
            icon={Lock}
            loading={running === 'encrypt'}
            disabled={!canEncrypt}
            aria-disabled={!canEncrypt}
            onClick={() => runOperation('encrypt')}
          >
            Encrypt
          </Button>
        </Tooltip>

        <Tooltip content={blockedReason('decrypt')}>
          <Button
            variant="default"
            icon={Unlock}
            loading={running === 'decrypt'}
            disabled={!canDecrypt}
            aria-disabled={!canDecrypt}
            onClick={() => runOperation('decrypt')}
          >
            Decrypt
          </Button>
        </Tooltip>

        <Tooltip content="Clears the input, the output and the last error. The key and IV stay.">
          <Button variant="ghost" icon={Eraser} className="ml-auto" onClick={clearData}>
            Clear
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
