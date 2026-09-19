/**
 * MAC — UX_SPEC 3.1.
 *
 * Sections: Scope · Key · Options · Result, with a sticky action bar carrying
 * Calculate (primary), Verify (secondary) and Clear. The panel renders only its
 * own body; the dock owns the header, collapse, promote and close.
 *
 * What this rewrite fixes, explicitly:
 * - Calculate and Verify no longer share one output slot.
 * - The verify verdict clears the moment any input changes.
 * - A packager with no MAC metadata gets an actionable empty state instead of a
 *   dead panel.
 * - Engine failures render inline, in full, with the raw payload available.
 *
 * Secrets: the MAC key lives in this component's state and nowhere else. It is
 * never persisted, never logged, never copied (the KCV is what gets copied),
 * and is wiped on unmount and on `Clear all secrets`.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CornerDownLeft, Eraser, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { normalizeHex } from '@/components/ui/HexInput'
import { SecretInput } from '@/components/ui/SecretInput'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { toast } from '@/components/ui/toast'
import { tryCall } from '@/engine/client'
import type { EngineCallError } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { SHELL_ACTION_EVENT, SHELL_COMMAND_EVENT } from '@/shell/useShortcuts'
import type { ShellActionDetail, ShellCommandDetail } from '@/shell/useShortcuts'
import { reportToolStatus } from '@/shell/toolStatus'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { MacEmptyState } from './MacEmptyState'
import { MacErrorStrip } from './MacErrorStrip'
import { MacResultBlock } from './MacResultBlock'
import { useDelayedProgress, useKcv, usePackagerSummaries } from './macHooks'
import {
  FALLBACK_MAC_FIELD_ID,
  MAC_KEY_BYTE_LENGTHS,
  MAX_MAC_FIELD_ID,
  MIN_MAC_FIELD_ID,
  PADDING_OPTIONS,
  headerProblem,
  inputSignature,
  isPaddingMode,
  macFieldProblem,
  macKeyProblem,
  macMetadataLine,
  parseMacFieldId,
  provenanceLine,
  type CalculatedResult,
  type PaddingMode,
  type VerificationResult,
} from './macModel'

const TOOL_ID = 'mac'

/** 11px uppercase section label with its controls, per the shared tool frame. */
function Section({
  label,
  children,
  trailing,
}: {
  label: string
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-field">
      <div className="flex items-center gap-2">
        <h3 className="text-2xs tracking-wider text-text-tertiary uppercase">{label}</h3>
        {trailing}
      </div>
      {children}
    </section>
  )
}

export default function MacPanel() {
  /* ── Workspace ─────────────────────────────────────────────────────────── */

  const buffer = useBuffers((state) => state.active())
  const updateBuffer = useBuffers((state) => state.update)
  const updateField = useBuffers((state) => state.updateField)
  const addField = useBuffers((state) => state.addField)
  const newTab = useBuffers((state) => state.newTab)
  const addProblem = useProblems((state) => state.add)
  const legacyEngine = useSettings((state) => state.legacyEngine)

  /* ── Tool state (all memory-only) ──────────────────────────────────────── */

  const [macFieldRaw, setMacFieldRaw] = useState(String(FALLBACK_MAC_FIELD_ID))
  const [padding, setPadding] = useState<PaddingMode>('iso9797-1')
  const [keyHex, setKeyHex] = useState('')
  const [includeHeader, setIncludeHeader] = useState(false)
  const [manual, setManual] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const [calculated, setCalculated] = useState<CalculatedResult | null>(null)
  const [verification, setVerification] = useState<VerificationResult | null>(null)
  const [failure, setFailure] = useState<{ title: string; error: EngineCallError } | null>(null)
  const [busy, setBusy] = useState<'calculate' | 'verify' | null>(null)
  const [lastAction, setLastAction] = useState<'calculate' | 'verify' | null>(null)

  const { summaries, loading: packagersLoading, error: packagersError, reload } = usePackagerSummaries()
  const { kcv, computing: kcvComputing, error: kcvError } = useKcv(keyHex)
  const progressVisible = useDelayedProgress(busy !== null)

  const packagerName = buffer?.packager ?? ''
  const summary = useMemo(
    () => summaries.find((candidate) => candidate.name === packagerName) ?? null,
    [summaries, packagerName],
  )
  const macCandidates = useMemo(() => summaries.filter((entry) => entry.macConfigured), [summaries])

  /* Seed the MAC field from the packager, once per packager. */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!summary || seededFor.current === summary.name) return
    seededFor.current = summary.name
    const first = summary.macFieldIds[0]
    setMacFieldRaw(String(first ?? FALLBACK_MAC_FIELD_ID))
  }, [summary])

  /* Manual configuration is scoped to the packager that needed it. */
  useEffect(() => {
    setManual(false)
  }, [packagerName])

  /* ── Derived validity ──────────────────────────────────────────────────── */

  const fields = useMemo(() => buffer?.fields ?? [], [buffer])
  const macFieldId = parseMacFieldId(macFieldRaw)
  const macFieldError = macFieldProblem(macFieldRaw)
  const keyError = macKeyProblem(keyHex)
  const headerError = buffer ? headerProblem(buffer.header, includeHeader) : null

  const receivedRow = macFieldId === null ? undefined : fields.find((field) => field.id === macFieldId)
  const receivedMissing = receivedRow === undefined
  const receivedEmpty = receivedRow !== undefined && receivedRow.value.trim().length === 0

  const signature = useMemo(
    () =>
      buffer
        ? inputSignature({
            packager: buffer.packager,
            macFieldId: macFieldRaw,
            padding,
            includeHeader,
            header: buffer.header,
            legacyEngine,
            fields,
            keyHex,
          })
        : '',
    [buffer, macFieldRaw, padding, includeHeader, legacyEngine, fields, keyHex],
  )

  const scopeLabel = manual
    ? 'manual'
    : summary && summary.macMethod.trim().length > 0
      ? summary.macMethod.trim()
      : 'FULL'

  const provenance = provenanceLine({
    padding,
    keyHex,
    kcv,
    scope: scopeLabel,
    fieldCount: fields.length,
    includeHeader,
    header: buffer?.header ?? { enabled: false, mode: 'none', size: 0 },
    legacyEngine,
    manual,
  })

  const blockingProblem =
    !buffer
      ? 'No buffer is open.'
      : fields.length === 0
        ? `${buffer.name} has no fields yet. Decode the buffer before running a MAC.`
        : keyError !== null
          ? keyError
          : macFieldError !== null
            ? macFieldError
            : headerError !== null
              ? headerError
              : null

  const verifyProblem =
    blockingProblem ??
    (receivedMissing
      ? `Field ${macFieldId} is not present in ${buffer?.name ?? 'this buffer'}.`
      : receivedEmpty
        ? `Field ${macFieldId} is empty. Verify needs the received MAC.`
        : null)

  /* ── Status reporting (rail dots) ──────────────────────────────────────── */

  const calculatedStale = calculated !== null && calculated.signature !== signature
  const verificationStale = verification !== null && verification.signature !== signature

  useEffect(() => {
    reportToolStatus(TOOL_ID, {
      result: calculated !== null || verification !== null,
      stale: calculatedStale || verificationStale,
      error: failure !== null,
      secret: keyHex.length > 0,
    })
  }, [calculated, verification, calculatedStale, verificationStale, failure, keyHex])

  /* ── Engine runs ───────────────────────────────────────────────────────── */

  const buildArgs = useCallback(() => {
    if (!buffer || macFieldId === null) return null
    return {
      packager: buffer.packager,
      fields: fields.map((field) => ({ id: field.id, value: field.value })),
      macFieldId,
      keyHex,
      paddingMode: padding,
      legacyEngine,
      header: {
        enabled: includeHeader,
        mode: buffer.header.mode,
        size: buffer.header.size,
      },
    }
  }, [buffer, fields, macFieldId, keyHex, padding, legacyEngine, includeHeader])

  const runCalculate = useCallback(async () => {
    setAttempted(true)
    const args = buildArgs()
    if (args === null || blockingProblem !== null || busy !== null) return

    setBusy('calculate')
    setLastAction('calculate')
    setFailure(null)
    const at = signature
    const result = await tryCall<{ macHex: string }>('mac.calculate', args)
    setBusy(null)

    if (!result.ok) {
      setFailure({ title: 'MAC calculation failed', error: result.error })
      addProblem({
        severity: 'error',
        source: 'MAC',
        message: `Calculate failed: ${result.error.message}`,
        fieldId: args.macFieldId,
      })
      return
    }
    setCalculated({ hex: result.data.macHex, signature: at, at: Date.now() })
  }, [addProblem, blockingProblem, buildArgs, busy, signature])

  const runVerify = useCallback(async () => {
    setAttempted(true)
    const args = buildArgs()
    if (args === null || verifyProblem !== null || busy !== null) return

    setBusy('verify')
    setLastAction('verify')
    setFailure(null)
    const at = signature
    const result = await tryCall<{ valid: boolean; expectedHex: string; actualHex: string }>(
      'mac.verify',
      args,
    )
    setBusy(null)

    if (!result.ok) {
      setFailure({ title: 'MAC verification failed', error: result.error })
      addProblem({
        severity: 'error',
        source: 'MAC',
        message: `Verify failed: ${result.error.message}`,
        fieldId: args.macFieldId,
      })
      return
    }

    setVerification({
      valid: result.data.valid,
      expectedHex: result.data.expectedHex,
      actualHex: result.data.actualHex,
      fieldId: args.macFieldId,
      signature: at,
      at: Date.now(),
    })
    if (!result.data.valid) {
      addProblem({
        severity: 'warning',
        source: 'MAC',
        message: `MAC mismatch on field ${args.macFieldId}: received ${result.data.actualHex}, expected ${result.data.expectedHex}.`,
        fieldId: args.macFieldId,
      })
    }
  }, [addProblem, buildArgs, busy, signature, verifyProblem])

  const rerun = useCallback(() => {
    if (lastAction === 'verify') void runVerify()
    else void runCalculate()
  }, [lastAction, runCalculate, runVerify])

  /* ── Shell wiring: Ctrl+Enter / Ctrl+Shift+Enter and Clear all secrets ─── */

  useEffect(() => {
    function onAction(event: Event) {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (detail.region !== 'dock' || detail.tool !== TOOL_ID) return
      if (detail.kind === 'primary') void runCalculate()
      else void runVerify()
    }
    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    return () => document.removeEventListener(SHELL_ACTION_EVENT, onAction)
  }, [runCalculate, runVerify])

  useEffect(() => {
    function onCommand(event: Event) {
      const detail = (event as CustomEvent<ShellCommandDetail>).detail
      if (detail.command !== 'clear-secrets') return
      setKeyHex('')
    }
    document.addEventListener(SHELL_COMMAND_EVENT, onCommand)
    return () => document.removeEventListener(SHELL_COMMAND_EVENT, onCommand)
  }, [])

  /* ── Workspace writes ──────────────────────────────────────────────────── */

  const applyToField = useCallback(() => {
    if (!buffer || !calculated || macFieldId === null) return
    if (!fields.some((field) => field.id === macFieldId)) addField(buffer.id, macFieldId)
    updateField(buffer.id, macFieldId, calculated.hex)
    toast.success(`MAC written to field ${macFieldId} in ${buffer.name}.`)
  }, [addField, buffer, calculated, fields, macFieldId, updateField])

  const addMacField = useCallback(() => {
    if (!buffer || macFieldId === null) return
    addField(buffer.id, macFieldId)
    toast.success(`Added field ${macFieldId} to ${buffer.name}.`)
  }, [addField, buffer, macFieldId])

  const clearTool = useCallback(() => {
    setKeyHex('')
    setCalculated(null)
    setVerification(null)
    setFailure(null)
    setAttempted(false)
  }, [])

  /* ── Empty / loading gates ─────────────────────────────────────────────── */

  if (!buffer) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No buffer is open."
        description="A MAC is computed over a buffer's fields. Open or create one first."
        action={
          <Button size="sm" variant="primary" onClick={() => newTab()}>
            New buffer
          </Button>
        }
      />
    )
  }

  if (packagersLoading) {
    return (
      <div className="flex flex-col gap-group p-panel">
        <Skeleton height={16} width="45%" />
        <Skeleton height={30} />
        <Skeleton height={30} />
        <Skeleton height={72} />
      </div>
    )
  }

  if (packagersError !== null) {
    return (
      <div className="p-panel">
        <InlineAlert
          tone="error"
          title="Packager registry unavailable"
          action={
            <Button size="xs" variant="default" onClick={reload}>
              Retry
            </Button>
          }
        >
          {packagersError}
        </InlineAlert>
      </div>
    )
  }

  const macConfigured = summary?.macConfigured ?? false
  if (!macConfigured && !manual) {
    return (
      <MacEmptyState
        packagerName={packagerName || 'unknown'}
        candidates={macCandidates}
        onChoosePackager={(name) => updateBuffer(buffer.id, { packager: name })}
        onXmlLoaded={reload}
        onConfigureManually={() => setManual(true)}
      />
    )
  }

  const macFieldOptions = (summary?.macFieldIds ?? []).map((id) => ({
    value: String(id),
    label: `Field ${id}`,
    hint: fields.find((field) => field.id === id)?.desc,
  }))
  const useSelect = macFieldOptions.length > 1

  const showKeyError = keyError !== null && (attempted || keyHex.length > 0)
  const showMacFieldError = macFieldError !== null && attempted
  const applyDisabled = calculated === null || calculatedStale || macFieldId === null
  const applyReason =
    calculated === null
      ? 'Calculate a MAC before applying it to a field.'
      : calculatedStale
        ? 'The inputs changed after this MAC was calculated. Calculate again before applying it.'
        : macFieldId === null
          ? 'Set a valid MAC field id first.'
          : null

  return (
    <div className="flex min-h-0 flex-col">
      {/* 120ms–2s progress, per UX_SPEC 5.4. Never a blocking overlay. */}
      <div className="h-0.5 shrink-0 overflow-hidden" aria-hidden={!progressVisible}>
        {progressVisible && (
          <div
            role="progressbar"
            aria-label={busy === 'verify' ? 'Verifying MAC' : 'Calculating MAC'}
            className="h-full w-full animate-pulse bg-accent motion-reduce:animate-none"
          />
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-group overflow-y-auto p-panel">
        {/* ── Scope ───────────────────────────────────────────────────────── */}
        <Section
          label="Scope"
          trailing={
            manual ? (
              <Badge tone="warn">
                <TriangleAlert size={11} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
                manual config — not from packager
              </Badge>
            ) : null
          }
        >
          <p className="text-xs text-text-secondary">
            <span className="font-mono text-mono-sm text-text">{buffer.name}</span>
            {' · '}
            <span className="font-mono text-mono-sm text-text">{buffer.packager}</span>
            {' · '}
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
            {buffer.stale && ' · fields edited since the last decode'}
          </p>

          <p className="font-mono text-mono-sm text-text-secondary">
            {summary ? macMetadataLine(summary) : 'No packager metadata — values below are yours.'}
          </p>

          {useSelect ? (
            <Field
              label="MAC field"
              hint="This packager declares more than one MAC-bearing field."
              error={showMacFieldError ? macFieldError : undefined}
            >
              <Select value={macFieldRaw} onValueChange={setMacFieldRaw} options={macFieldOptions} mono />
            </Field>
          ) : (
            <Field
              label="MAC field"
              hint={`Bit ${MIN_MAC_FIELD_ID}–${MAX_MAC_FIELD_ID}. The MAC field is excluded from the MAC input.`}
              error={showMacFieldError ? macFieldError : undefined}
            >
              <Input
                value={macFieldRaw}
                onValueChange={setMacFieldRaw}
                mono
                inputMode="numeric"
                invalid={showMacFieldError}
                suffix={<span className="text-2xs text-text-tertiary">bit</span>}
              />
            </Field>
          )}

          {macFieldId !== null && receivedMissing && (
            <InlineAlert
              tone="info"
              action={
                <Button size="xs" variant="default" onClick={addMacField}>
                  Add field {macFieldId}
                </Button>
              }
            >
              Field {macFieldId} is not present in {buffer.name}. Calculate works without it; Verify
              needs the received MAC.
            </InlineAlert>
          )}
          {macFieldId !== null && receivedEmpty && (
            <InlineAlert tone="info">
              Field {macFieldId} is empty. Verify needs the received MAC in that field.
            </InlineAlert>
          )}
        </Section>

        <div className="border-t border-border-subtle" />

        {/* ── Key ─────────────────────────────────────────────────────────── */}
        <Section label="Key">
          <Field
            label="MAC key"
            hint={`Hex. ${MAC_KEY_BYTE_LENGTHS.join(', ')} bytes. Held in memory only — never saved, never logged.`}
            error={showKeyError ? keyError : undefined}
          >
            <SecretInput
              value={keyHex}
              onValueChange={(next) => setKeyHex(normalizeHex(next))}
              placeholder="MAC key hex (8, 16, or 24 bytes)"
              acceptedByteLengths={MAC_KEY_BYTE_LENGTHS}
              hex
            />
          </Field>

          <div className="flex min-h-6 items-center gap-2">
            {kcv !== null ? (
              <>
                <span className="text-xs text-text-secondary">KCV</span>
                <span className="font-mono text-mono-sm text-text">{kcv}</span>
                <CopyButton value={kcv} label="Copy KCV" size="xs" variant="ghost" />
                <span className="text-2xs text-text-tertiary">
                  Copy the check value, never the key.
                </span>
              </>
            ) : kcvComputing ? (
              <span className="text-2xs text-text-tertiary">Deriving key check value…</span>
            ) : kcvError !== null ? (
              <span className="text-2xs text-warn">KCV unavailable: {kcvError}</span>
            ) : (
              <span className="text-2xs text-text-tertiary">
                The key check value appears once the key is a legal length.
              </span>
            )}
          </div>
        </Section>

        <div className="border-t border-border-subtle" />

        {/* ── Options ─────────────────────────────────────────────────────── */}
        <Section label="Options">
          <Field label="Padding" hint="ISO 9797-1 padding method used before the ANSI X9.19 MAC.">
            <Select
              value={padding}
              onValueChange={(next) => {
                if (isPaddingMode(next)) setPadding(next)
              }}
              options={[...PADDING_OPTIONS]}
            />
          </Field>

          <Checkbox
            checked={includeHeader}
            onCheckedChange={setIncludeHeader}
            label="Include length header in MAC input"
            description={
              buffer.header.mode === 'none'
                ? 'The buffer declares no framing.'
                : `${buffer.header.mode} header, ${buffer.header.size} bytes, from the raw pane.`
            }
          />
          {headerError !== null && (
            <p className="text-xs text-error">{headerError}</p>
          )}

          {legacyEngine && (
            <p className="text-2xs text-text-tertiary">
              Legacy engine is on: a packager whose method is PARTIAL MACs only its flagged field
              values.
            </p>
          )}
        </Section>

        <div className="border-t border-border-subtle" />

        {/* ── Result ──────────────────────────────────────────────────────── */}
        <MacResultBlock
          calculated={calculated}
          verification={verification}
          currentSignature={signature}
          provenance={provenance}
          bufferName={buffer.name}
          onRerun={rerun}
          rerunDisabled={busy !== null || lastAction === null || blockingProblem !== null}
        />

        {failure && (
          <MacErrorStrip
            title={failure.title}
            error={failure.error}
            onDismiss={() => setFailure(null)}
          />
        )}

        {attempted && blockingProblem !== null && failure === null && (
          <InlineAlert tone="warn" title="Nothing was sent to the engine">
            {blockingProblem}
          </InlineAlert>
        )}
      </div>

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'sticky bottom-0 flex shrink-0 flex-wrap items-center gap-2',
          'border-t border-border bg-surface-1 px-panel py-2',
        )}
      >
        <Button
          size="sm"
          variant="primary"
          icon={ShieldCheck}
          loading={busy === 'calculate' && progressVisible}
          disabled={busy !== null || blockingProblem !== null}
          title={blockingProblem ?? 'Calculate the MAC over the active buffer (Ctrl+Enter)'}
          onClick={() => void runCalculate()}
        >
          Calculate
        </Button>
        <Button
          size="sm"
          variant="default"
          icon={Check}
          loading={busy === 'verify' && progressVisible}
          disabled={busy !== null || verifyProblem !== null}
          title={verifyProblem ?? 'Verify the received MAC (Ctrl+Shift+Enter)'}
          onClick={() => void runVerify()}
        >
          Verify
        </Button>
        <Button
          size="sm"
          variant="subtle"
          icon={CornerDownLeft}
          disabled={applyDisabled}
          title={applyReason ?? `Write the calculated MAC into field ${macFieldId ?? ''} of ${buffer.name}`}
          onClick={applyToField}
        >
          {macFieldId === null ? 'Apply to field' : `Apply to F${macFieldId}`}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" icon={Eraser} onClick={clearTool}>
          Clear
        </Button>
      </div>
    </div>
  )
}
