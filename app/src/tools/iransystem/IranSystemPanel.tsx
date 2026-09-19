/**
 * IranSystem — UX_SPEC 3.6.
 *
 * The tool converts between IranSystem terminal bytes and Unicode, in both
 * profiles the core implements. The spec's four fixes are all here:
 *
 *  1. `Swap` is a real control (`swapIranSystemDirection` existed in the Qt
 *     build and nothing invoked it).
 *  2. A provenance line names the exact transform that ran, because the
 *     profile x direction x encoding matrix has twelve materially different
 *     branches and the old app showed none of them.
 *  3. `Convert digits to IranSystem` stays visible while decoding, disabled
 *     with a reason, instead of vanishing.
 *  4. The raw hex is a selectable, copyable field rather than an 11px meta
 *     label — and `Apply to Field` finally exists to match `Load Field`.
 *
 * Nothing this panel handles is secret: IranSystem payloads are message
 * content. It still keeps everything in memory only, since a payload may carry
 * cardholder text.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Eraser,
  Languages,
} from 'lucide-react'

import { EngineCallError } from '@/engine/protocol'
import { engineKind } from '@/engine/client'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { groupHex, normalizeHex } from '@/components/ui/HexInput'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { Kbd } from '@/components/ui/Kbd'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { reportToolStatus } from '@/shell/toolStatus'

import { Pane } from './Pane'
import {
  DIRECTION_OPTIONS,
  ENCODING_LABEL,
  ENCODING_OPTIONS,
  PROFILE_OPTIONS,
  countChars,
  provenanceLine,
  requestSignature,
  runConversion,
  validateFieldId,
  validateRequest,
  type ConversionOutcome,
  type ConversionRequest,
  type Direction,
  type Encoding,
  type Profile,
} from './matrix'
import './iransystem.css'

/** The Problems drawer groups by this string; keep it stable. */
const PROBLEM_SOURCE = 'IranSystem'

/** UX_SPEC 5.4: nothing for the first 120ms, then a 2px indeterminate bar. */
const PROGRESS_DELAY_MS = 120

const DEFAULT_FIELD_ID = '48'

interface EngineFailure {
  message: string
  code: string
  op: string
  detail?: Record<string, unknown> | undefined
}

/**
 * What the output pane is currently showing.
 *
 * `echo` is the other half of `Swap`: the old input moves across, but it was
 * never converted, so it carries no provenance and no byte hex. Modelling it
 * explicitly is what stops the panel from claiming a transform it did not run.
 */
type Output =
  | { kind: 'result'; outcome: ConversionOutcome; request: ConversionRequest; signature: string }
  | { kind: 'echo'; text: string }
  | null

export default function IranSystemPanel() {
  const [fieldIdText, setFieldIdText] = useState(DEFAULT_FIELD_ID)
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState<Profile>('normalized')
  const [direction, setDirection] = useState<Direction>('decode')
  const [encoding, setEncoding] = useState<Encoding>('utf8')
  const [convertNumbers, setConvertNumbers] = useState(true)

  const [output, setOutput] = useState<Output>(null)
  const [failure, setFailure] = useState<EngineFailure | null>(null)
  const [fieldMessage, setFieldMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showProgress, setShowProgress] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const buffer = useBuffers((state) => state.active())
  const updateField = useBuffers((state) => state.updateField)
  const addField = useBuffers((state) => state.addField)
  const addProblem = useProblems((state) => state.add)
  const clearProblems = useProblems((state) => state.clear)

  const request = useMemo<ConversionRequest>(
    () => ({ input, profile, direction, encoding, convertNumbers }),
    [input, profile, direction, encoding, convertNumbers],
  )

  const inputError = useMemo(() => validateRequest(request), [request])
  const fieldIdError = useMemo(() => validateFieldId(fieldIdText), [fieldIdText])

  const inputIsHex = direction === 'decode' && encoding === 'hex'
  const outputIsHex = output?.kind === 'result' ? output.outcome.outputIsHex : false

  const stale =
    output?.kind === 'result' ? output.signature !== requestSignature(request) : false

  const outputText = output === null ? '' : output.kind === 'result' ? output.outcome.text : output.text

  const inputLabel =
    direction === 'decode'
      ? `Input (IranSystem, ${ENCODING_LABEL[encoding]})`
      : 'Input (Unicode, UTF-8)'
  const outputLabel =
    direction === 'decode'
      ? 'Output (Unicode, UTF-8)'
      : `Output (IranSystem, ${ENCODING_LABEL[encoding]})`

  const inputMeta = inputIsHex
    ? `${normalizeHex(input).length / 2} bytes`
    : `${countChars(input)} chars`

  const canConvert = input.trim().length > 0 && inputError === null && !busy

  // UX_SPEC 1.2: the rail dot is how an operator sees a tool still holds state.
  useEffect(() => {
    reportToolStatus('iransystem', {
      result: output !== null,
      stale,
      error: failure !== null,
      secret: false,
    })
  }, [output, stale, failure])

  useEffect(() => {
    if (!busy) {
      setShowProgress(false)
      return
    }
    const timer = window.setTimeout(() => setShowProgress(true), PROGRESS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [busy])

  const handleConvert = useCallback(async () => {
    if (input.trim().length === 0 || inputError !== null || busy) return

    setBusy(true)
    setFieldMessage(null)
    try {
      const outcome = await runConversion(request)
      setOutput({ kind: 'result', outcome, request, signature: requestSignature(request) })
      setFailure(null)
      clearProblems(PROBLEM_SOURCE)
    } catch (error) {
      const next: EngineFailure =
        error instanceof EngineCallError
          ? { message: error.message, code: error.code, op: error.op, detail: error.detail }
          : {
              message: error instanceof Error ? error.message : 'The conversion failed.',
              code: 'INTERNAL',
              op: 'iransystem.convert',
              detail: undefined,
            }
      setFailure(next)
      addProblem({ severity: 'error', source: PROBLEM_SOURCE, message: next.message })
    } finally {
      setBusy(false)
    }
  }, [addProblem, busy, clearProblems, input, inputError, request])

  /**
   * UX_SPEC 3.6: "swaps input and output, flips the direction select, and
   * clears the meta line".
   */
  const handleSwap = useCallback(() => {
    const previousInput = input
    setInput(outputText)
    setOutput(previousInput === '' ? null : { kind: 'echo', text: previousInput })
    setDirection((current) => (current === 'decode' ? 'encode' : 'decode'))
    setFailure(null)
    setFieldMessage(null)
    clearProblems(PROBLEM_SOURCE)
  }, [clearProblems, input, outputText])

  const handleClear = useCallback(() => {
    setInput('')
    setOutput(null)
    setFailure(null)
    setFieldMessage(null)
    clearProblems(PROBLEM_SOURCE)
    inputRef.current?.focus()
  }, [clearProblems])

  const handleLoadField = useCallback(() => {
    setFieldMessage(null)
    if (fieldIdError !== null) return
    if (!buffer) {
      setFieldMessage('No buffer is open. Open or paste a message first.')
      return
    }
    const id = Number(fieldIdText)
    const row = buffer.fields.find((candidate) => candidate.id === id)
    if (!row) {
      // Verbatim from the Qt build, so the message an operator learned still
      // means the same thing.
      setFieldMessage(`Field ${id} is not present.`)
      return
    }
    setInput(row.value)
    setOutput(null)
    setFailure(null)
    if (row.hex === true && encoding !== 'hex') {
      toast.info(`Field ${id} is held as hex. Set Encoding to Hex to read it as bytes.`)
    } else {
      toast.success(`Loaded field ${id} from ${buffer.name}.`)
    }
  }, [buffer, encoding, fieldIdError, fieldIdText])

  const handleApplyToField = useCallback(() => {
    setFieldMessage(null)
    if (fieldIdError !== null) return
    if (!buffer) {
      setFieldMessage('No buffer is open. Open or paste a message first.')
      return
    }
    if (output === null) {
      setFieldMessage('Nothing to apply yet — convert first.')
      return
    }
    const id = Number(fieldIdText)
    if (!updateField(buffer.id, id, outputText)) {
      addField(buffer.id, id)
      updateField(buffer.id, id, outputText)
    }
    toast.success(`Applied ${outputText.length === 0 ? 'an empty value' : 'the output'} to field ${id} in ${buffer.name}.`)
  }, [addField, buffer, fieldIdError, fieldIdText, output, outputText, updateField])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void handleConvert()
    }
  }

  return (
    <div
      className="relative flex flex-col gap-group p-panel"
      onKeyDown={handleKeyDown}
      data-tool="iransystem"
    >
      {showProgress && (
        <div
          role="progressbar"
          aria-label="Converting"
          className="bx-progress absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-surface-2"
        >
          <span className="bx-progress-bar block h-full w-1/3 bg-accent" />
        </div>
      )}

      {/* ── Scope ─────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-field" aria-label="Scope">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-2xs tracking-wide text-text-secondary uppercase">Scope</h2>
          <span className="truncate text-2xs text-text-tertiary">
            {buffer ? buffer.name : 'no buffer open'}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-field">
          <Field
            label="Field"
            hint={fieldIdError === null ? '0–128' : undefined}
            error={fieldIdError ?? undefined}
            className="w-24"
          >
            <Input
              value={fieldIdText}
              onValueChange={setFieldIdText}
              inputMode="numeric"
              mono
              invalid={fieldIdError !== null}
              aria-label="Field number"
            />
          </Field>

          <Button
            icon={ArrowDownToLine}
            onClick={handleLoadField}
            disabled={fieldIdError !== null || !buffer}
            title={buffer ? undefined : 'Open a buffer to read a field from it.'}
          >
            Load Field
          </Button>

          <Button
            icon={ArrowUpFromLine}
            onClick={handleApplyToField}
            disabled={fieldIdError !== null || !buffer || output === null}
            title={
              !buffer
                ? 'Open a buffer to write a field into it.'
                : output === null
                  ? 'Convert something first.'
                  : undefined
            }
          >
            Apply to Field
          </Button>
        </div>

        {fieldMessage !== null && (
          <p className="flex items-start gap-1 text-xs text-error" role="alert">
            <AlertCircle
              size={14}
              strokeWidth={1.25}
              absoluteStrokeWidth
              className="mt-px shrink-0"
              aria-hidden="true"
            />
            <span>{fieldMessage}</span>
          </p>
        )}
      </section>

      <hr className="border-t border-border-subtle" />

      {/* ── Transform ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-field" aria-label="Transform">
        <h2 className="text-2xs tracking-wide text-text-secondary uppercase">Transform</h2>

        <div className="flex flex-wrap items-end gap-field">
          <Field label="Profile" className="min-w-36 flex-1">
            <Select
              value={profile}
              onValueChange={(value) => setProfile(value as Profile)}
              options={PROFILE_OPTIONS}
              aria-label="Conversion profile"
            />
          </Field>

          <div className="flex min-w-44 flex-1 items-end gap-1">
            <Field label="Direction" className="flex-1">
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as Direction)}
                options={DIRECTION_OPTIONS}
                aria-label="Conversion direction"
              />
            </Field>
            <IconButton
              icon={ArrowLeftRight}
              label="Swap input and output"
              onClick={handleSwap}
              className="mb-0.5"
            />
          </div>

          <Field label="Encoding" className="min-w-28 flex-1">
            <Select
              value={encoding}
              onValueChange={(value) => setEncoding(value as Encoding)}
              options={ENCODING_OPTIONS}
              aria-label="IranSystem representation"
            />
          </Field>
        </div>

        <Checkbox
          checked={convertNumbers}
          onCheckedChange={setConvertNumbers}
          disabled={direction !== 'encode'}
          label="Convert digits to IranSystem"
          description={
            direction === 'encode'
              ? 'Latin digits become their IranSystem code points.'
              : '(encode only)'
          }
        />
      </section>

      <hr className="border-t border-border-subtle" />

      {/* ── Conversion ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-field">
        <Pane
          label={inputLabel}
          meta={inputMeta}
          actions={
            <>
              <CopyButton value={input} label="Copy input" />
              <IconButton
                icon={Eraser}
                label="Clear input"
                size="xs"
                variant="ghost"
                onClick={() => {
                  setInput('')
                  inputRef.current?.focus()
                }}
              />
            </>
          }
        >
          <Textarea
            ref={inputRef}
            value={input}
            onValueChange={setInput}
            rows={6}
            autoResize
            spellCheck={false}
            invalid={inputError !== null}
            dir={inputIsHex ? 'ltr' : 'rtl'}
            aria-label={inputLabel}
            aria-invalid={inputError !== null}
            aria-describedby={inputError !== null ? 'iransystem-input-error' : undefined}
            placeholder={
              direction === 'decode'
                ? encoding === 'hex'
                  ? '81 92 A0 FE 20 …'
                  : 'IranSystem payload as text'
                : 'خرید از فروشگاه'
            }
            className={cn(inputIsHex ? 'font-mono text-mono-base' : 'bx-persian text-base')}
          />

          {inputError !== null && (
            <p
              id="iransystem-input-error"
              className="flex items-start gap-1 text-xs text-error"
              role="alert"
            >
              <AlertCircle
                size={14}
                strokeWidth={1.25}
                absoluteStrokeWidth
                className="mt-px shrink-0"
                aria-hidden="true"
              />
              <span>{inputError}</span>
            </p>
          )}
        </Pane>

        <Pane
          label={outputLabel}
          meta={
            output === null ? undefined : stale ? (
              <Badge tone="warn">stale</Badge>
            ) : output.kind === 'echo' ? (
              <Badge tone="neutral">swapped</Badge>
            ) : (
              `${output.outcome.chars} chars`
            )
          }
          actions={output === null ? undefined : <CopyButton value={outputText} label="Copy output" />}
          dimmed={stale}
        >
          {output === null ? (
            <EmptyState
              icon={Languages}
              title="Nothing converted yet."
              description="Paste an IranSystem payload or Persian text, or load a field from the buffer."
              hint={
                <span className="flex items-center gap-1">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>Enter</Kbd> to convert
                </span>
              }
            />
          ) : (
            <>
              <div
                dir={outputIsHex ? 'ltr' : 'rtl'}
                tabIndex={0}
                role="group"
                aria-label={outputLabel}
                aria-live="polite"
                className={cn(
                  'min-h-24 overflow-auto rounded-xs border border-border-subtle bg-surface-inset',
                  'px-cell-x py-cell-y break-words whitespace-pre-wrap select-text',
                  outputIsHex ? 'font-mono text-mono-base break-all' : 'bx-persian text-base',
                )}
              >
                {outputText === '' ? (
                  <span dir="ltr" className="text-text-tertiary italic">
                    (empty result)
                  </span>
                ) : (
                  outputText
                )}
              </div>

              {output.kind === 'result' && (
                <div className="flex items-center gap-2 rounded-xs bg-surface-inset px-cell-x py-cell-y">
                  <span className="shrink-0 text-2xs tracking-wide text-text-tertiary uppercase">
                    Hex
                  </span>
                  <code
                    dir="ltr"
                    className="min-w-0 flex-1 overflow-x-auto font-mono text-mono-xs break-all text-text select-text"
                  >
                    {output.outcome.hex === '' ? '—' : groupHex(output.outcome.hex, 2)}
                  </code>
                  <Badge tone="neutral">{output.outcome.bytes} bytes</Badge>
                  <CopyButton value={output.outcome.hex} label="Copy hex" />
                </div>
              )}
            </>
          )}
        </Pane>
      </div>

      {/* ── Provenance ────────────────────────────────────────────────── */}
      <p className={cn('text-2xs text-text-tertiary', stale && 'opacity-55')}>
        {output === null
          ? `Ready · ${engineKind() === 'native' ? 'native engine' : 'wasm engine'}`
          : output.kind === 'echo'
            ? 'Swapped — not converted yet. Press Convert to run this direction.'
            : provenanceLine(output.request, output.outcome, stale)}
      </p>

      {failure !== null && (
        <InlineAlert
          tone="error"
          title="Conversion failed"
          onDismiss={() => setFailure(null)}
          action={<CopyButton value={failure.message} label="Copy message" showLabel />}
        >
          <p>{failure.message}</p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs text-text-tertiary">Details</summary>
            <pre className="mt-1 overflow-x-auto rounded-xs bg-surface-inset px-cell-x py-cell-y font-mono text-mono-xs text-text-secondary">
              {JSON.stringify(
                { op: failure.op, code: failure.code, detail: failure.detail ?? null },
                null,
                2,
              )}
            </pre>
          </details>
        </InlineAlert>
      )}

      {/* ── Actions ───────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 -mx-panel -mb-panel flex items-center gap-2 border-t border-border-subtle bg-surface-1 px-panel py-2">
        <Tooltip content="Ctrl+Enter">
          <Button
            variant="primary"
            icon={Languages}
            loading={busy}
            disabled={!canConvert}
            onClick={() => void handleConvert()}
          >
            Convert
          </Button>
        </Tooltip>

        <Button icon={ArrowLeftRight} onClick={handleSwap}>
          Swap
        </Button>

        <Button variant="ghost" icon={Eraser} onClick={handleClear} className="ml-auto">
          Clear
        </Button>
      </div>
    </div>
  )
}
