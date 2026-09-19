/**
 * PIN tool state, option inventory and client-side validation (UX_SPEC 3.2).
 *
 * The four sub-tools are four sub-tabs with **fully independent state**. That
 * independence is the whole point of the rewrite: the old panel had one
 * combobox with show/hide rules, so a PAN typed for a PVV calculation silently
 * leaked into an ATM translate. Here every tab owns its own model, and sharing
 * happens only through the explicit `Carry over` action.
 *
 * Secrets discipline (UX_SPEC 5.5): every value in this module lives in React
 * state for the lifetime of the mounted panel and nowhere else. Nothing here is
 * persisted, logged, put in a URL, or written into `data-*`. The "input
 * version" counter exists so staleness can be tracked *without* keeping a
 * second copy of the inputs around for comparison.
 */

import { useCallback, useState } from 'react'
import { EngineCallError } from '@/engine/protocol'

/* ── Option inventory ────────────────────────────────────────────────────── */

/** PIN block formats (UX_SPEC 3.2a). All four are preserved. */
export type BlockFormat = 'iso0' | 'iso1' | 'iso3' | 'iso4'

export const BLOCK_FORMAT_OPTIONS: { value: BlockFormat; label: string }[] = [
  { value: 'iso0', label: 'ISO-0' },
  { value: 'iso1', label: 'ISO-1' },
  { value: 'iso3', label: 'ISO-3' },
  { value: 'iso4', label: 'ISO-4' },
]

export const BLOCK_FORMAT_LABEL: Record<BlockFormat, string> = {
  iso0: 'ISO-0',
  iso1: 'ISO-1',
  iso3: 'ISO-3',
  iso4: 'ISO-4',
}

/**
 * ISO-4 is an AES format: the key sizes differ, there is no clear-block stage,
 * and encryption happens inside Create/Decode rather than as its own step.
 */
export function isAesFormat(format: BlockFormat): boolean {
  return format === 'iso4'
}

/** Legal key byte lengths for a block format. */
export function blockKeyBytes(format: BlockFormat): readonly number[] {
  return isAesFormat(format) ? [16, 24, 32] : [8, 16, 24]
}

/** ATM translate formats (UX_SPEC 3.2d). Source and destination share the set. */
export type TranslateFormat = 'ansiiso0atm' | 'iso1atm'

export const TRANSLATE_FORMAT_OPTIONS: { value: TranslateFormat; label: string }[] = [
  { value: 'ansiiso0atm', label: 'ANSI / ISO-0 (ATM)' },
  { value: 'iso1atm', label: 'ISO-1 (ATM)' },
]

export const TRANSLATE_FORMAT_LABEL: Record<TranslateFormat, string> = {
  ansiiso0atm: 'ANSI / ISO-0',
  iso1atm: 'ISO-1',
}

/** ATM translate algorithms. `tsndes` is destination-only, as in the old app. */
export type TranslateAlgorithm = 'des' | '2key3des' | 'tsndes'

export const SOURCE_ALGORITHM_OPTIONS: { value: TranslateAlgorithm; label: string; hint: string }[] =
  [
    { value: 'des', label: 'DES', hint: '8-byte key' },
    { value: '2key3des', label: '2-key 3DES', hint: '16-byte key' },
  ]

export const DESTINATION_ALGORITHM_OPTIONS: {
  value: TranslateAlgorithm
  label: string
  hint: string
}[] = [
  ...SOURCE_ALGORITHM_OPTIONS,
  { value: 'tsndes', label: 'TSN-DES', hint: 'destination only · 16-byte key' },
]

export const TRANSLATE_ALGORITHM_LABEL: Record<TranslateAlgorithm, string> = {
  des: 'DES',
  '2key3des': '2-key 3DES',
  tsndes: 'TSN-DES',
}

/** Legal key byte length for a translate algorithm. */
export function translateKeyBytes(algorithm: TranslateAlgorithm): readonly number[] {
  return algorithm === 'des' ? [8] : [16]
}

/** The IBM 3624 decimalization table the old app shipped as its default. */
export const DEFAULT_DECIMALIZATION = '0123456789012345'

/* ── Tab models ──────────────────────────────────────────────────────────── */

export interface BlocksModel {
  format: BlockFormat
  pan: string
  clearPin: string
  clearBlock: string
  key: string
  encryptedBlock: string
  /** Which bit the Load/Apply pair targets. `52` (PIN DATA) by default. */
  targetField: number
}

export const BLOCKS_INITIAL: BlocksModel = {
  format: 'iso0',
  pan: '',
  clearPin: '',
  clearBlock: '',
  key: '',
  encryptedBlock: '',
  targetField: 52,
}

export interface PvvModel {
  pan: string
  clearPin: string
  pvki: string
  pvk: string
}

export const PVV_INITIAL: PvvModel = { pan: '', clearPin: '', pvki: '', pvk: '' }

export interface IbmModel {
  clearPin: string
  validationData: string
  decimalization: string
  pvk: string
  offset: string
}

export const IBM_INITIAL: IbmModel = {
  clearPin: '',
  validationData: '',
  decimalization: DEFAULT_DECIMALIZATION,
  pvk: '',
  offset: '',
}

export interface TranslateModel {
  sourceBlock: string
  sourceFormat: TranslateFormat
  sourceAlgorithm: TranslateAlgorithm
  sourceKey: string
  destinationFormat: TranslateFormat
  destinationAlgorithm: TranslateAlgorithm
  destinationKey: string
  pan: string
  targetField: number
}

export const TRANSLATE_INITIAL: TranslateModel = {
  sourceBlock: '',
  sourceFormat: 'ansiiso0atm',
  sourceAlgorithm: 'des',
  sourceKey: '',
  destinationFormat: 'ansiiso0atm',
  destinationAlgorithm: 'des',
  destinationKey: '',
  pan: '',
  targetField: 52,
}

/** Which keys of each model hold secret material and are wiped on lock. */
export const BLOCKS_SECRET_KEYS = ['clearPin', 'key', 'clearBlock', 'encryptedBlock', 'pan'] as const
export const PVV_SECRET_KEYS = ['clearPin', 'pvk', 'pan'] as const
export const IBM_SECRET_KEYS = ['clearPin', 'pvk', 'offset'] as const
export const TRANSLATE_SECRET_KEYS = ['sourceBlock', 'sourceKey', 'destinationKey', 'pan'] as const

/* ── The model hook ──────────────────────────────────────────────────────── */

export interface TabModel<T extends object> {
  state: T
  /** Merges a partial state and bumps the input version (invalidating results). */
  patch(next: Partial<T>): void
  /**
   * Monotonic counter of input edits. A result records the version it was
   * produced at; when the counter has moved on, the result is stale
   * (UX_SPEC 3.0: "results go stale visibly").
   */
  version: number
  /** Restores the tab's defaults. */
  reset(): void
}

export function useTabModel<T extends object>(initial: T): TabModel<T> {
  const [state, setState] = useState<T>(initial)
  const [version, setVersion] = useState(0)

  const patch = useCallback((next: Partial<T>) => {
    setState((current) => ({ ...current, ...next }))
    setVersion((current) => current + 1)
  }, [])

  const reset = useCallback(() => {
    setState(initial)
    setVersion((current) => current + 1)
    // `initial` is a module constant; the identity is stable.
  }, [initial])

  return { state, patch, version, reset }
}

/* ── Results ─────────────────────────────────────────────────────────────── */

export interface ResultRowData {
  key: string
  label: string
  value: string
  /**
   * A recovered PIN or clear block. Rendered masked with an explicit reveal,
   * the same discipline as the inputs.
   */
  sensitive?: boolean
  /** Short qualifier rendered under the value, e.g. `from F52`. */
  note?: string
  /** Label for the `↑ use as input` action. Omit to hide the action. */
  useAs?: string
  onUseAs?: () => void
}

export interface RunOutcome {
  rows: ResultRowData[]
  /** The 11px line under the result: algorithm, key size, scope. */
  provenance: string
  verdict?: { tone: 'ok' | 'error'; label: string }
}

export type RunResult = RunOutcome & { version: number; at: number; operation: string }

export interface Runner {
  result: RunResult | null
  error: EngineCallError | null
  /** Label of the operation in flight, or `null`. */
  busy: string | null
  /** The result was produced before the current input version. */
  stale: boolean
  run(operation: string, exec: () => Promise<RunOutcome>): Promise<void>
  /** Raises a failure without calling the engine (pre-flight refusals). */
  fail(operation: string, message: string): void
  clear(): void
}

/**
 * Runs one engine operation and owns the result / error / busy triad for a tab.
 *
 * Failures never throw out of here and never become a modal: they land in
 * `error` and the tab renders them in an `InlineAlert` above the action bar
 * (UX_SPEC 3.0).
 */
export function useRunner(version: number): Runner {
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<EngineCallError | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const run = useCallback(
    async (operation: string, exec: () => Promise<RunOutcome>) => {
      // The version is captured *before* the await, so an edit made while the
      // engine is working correctly marks the arriving result stale.
      const at = version
      setBusy(operation)
      setError(null)
      try {
        const outcome = await exec()
        setResult({ ...outcome, version: at, at: Date.now(), operation })
      } catch (cause) {
        setResult(null)
        setError(
          cause instanceof EngineCallError
            ? cause
            : new EngineCallError('pin', {
                code: 'INTERNAL',
                message: cause instanceof Error ? cause.message : String(cause),
              }),
        )
      } finally {
        setBusy(null)
      }
    },
    [version],
  )

  const fail = useCallback((operation: string, message: string) => {
    setResult(null)
    setError(new EngineCallError(operation, { code: 'BAD_ARGUMENT', message }))
  }, [])

  const clear = useCallback(() => {
    setResult(null)
    setError(null)
  }, [])

  return {
    result,
    error,
    busy,
    stale: result !== null && result.version !== version,
    run,
    fail,
    clear,
  }
}

/**
 * What a sub-tab binds to `Ctrl+Enter` / `Ctrl+Shift+Enter`. The panel forwards
 * the shell's region action to whichever sub-tab is showing (UX_SPEC 4.2).
 */
export interface TabActions {
  primary(): void
  primaryLabel: string
  secondary?: () => void
  secondaryLabel?: string
}

/* ── Client-side validation ──────────────────────────────────────────────── */

/** Keeps only hex digits and uppercases. Mirrors `HexInput`'s normalisation. */
export function toHex(raw: string): string {
  let out = ''
  for (const ch of raw) if (/[0-9a-fA-F]/.test(ch)) out += ch
  return out.toUpperCase()
}

/** Keeps only decimal digits. Used for PAN, PIN, offset and table inputs. */
export function toDigits(raw: string): string {
  let out = ''
  for (const ch of raw) if (ch >= '0' && ch <= '9') out += ch
  return out
}

export function hexBytes(hex: string): number {
  return Math.floor(hex.length / 2)
}

export interface HexRule {
  label: string
  required?: boolean
  /** Every legal byte length. Omit to accept any whole number of bytes. */
  bytes?: readonly number[]
  /** Minimum byte length, when there is no fixed set. */
  minBytes?: number
}

/** Returns a message for the control, or `undefined` when the value is legal. */
export function hexError(value: string, rule: HexRule): string | undefined {
  if (value.length === 0) {
    return rule.required ? `${rule.label} is required.` : undefined
  }
  if (value.length % 2 !== 0) {
    return `${rule.label} has an odd nibble count — hex needs whole bytes.`
  }
  const bytes = hexBytes(value)
  if (rule.bytes && !rule.bytes.includes(bytes)) {
    const legal = rule.bytes.join(', ')
    return `${rule.label} is ${bytes} bytes; ${legal} ${rule.bytes.length === 1 ? 'is' : 'are'} accepted.`
  }
  if (rule.minBytes !== undefined && bytes < rule.minBytes) {
    return `${rule.label} is ${bytes} bytes; at least ${rule.minBytes} are needed.`
  }
  return undefined
}

export interface DigitRule {
  label: string
  required?: boolean
  min?: number
  max?: number
  exact?: number
}

export function digitError(value: string, rule: DigitRule): string | undefined {
  if (value.length === 0) {
    return rule.required ? `${rule.label} is required.` : undefined
  }
  if (rule.exact !== undefined && value.length !== rule.exact) {
    return `${rule.label} must be exactly ${rule.exact} digits; this is ${value.length}.`
  }
  if (rule.min !== undefined && value.length < rule.min) {
    return `${rule.label} must be at least ${rule.min} digits; this is ${value.length}.`
  }
  if (rule.max !== undefined && value.length > rule.max) {
    return `${rule.label} must be at most ${rule.max} digits; this is ${value.length}.`
  }
  return undefined
}

/** ISO 7812 allows 12–19 digits. Anything else is a client-side refusal. */
export function panError(value: string, required: boolean): string | undefined {
  return digitError(value, { label: 'PAN', required, min: 12, max: 19 })
}

export function pinError(value: string, required = true): string | undefined {
  return digitError(value, { label: 'Clear PIN', required, min: 4, max: 12 })
}

/** The first message in `issues`, used to explain a disabled action. */
export function firstIssue(issues: Record<string, string | undefined>): string | undefined {
  for (const key of Object.keys(issues)) {
    const message = issues[key]
    if (message) return message
  }
  return undefined
}

/** `true` when nothing in `issues` is set. */
export function isClean(issues: Record<string, string | undefined>): boolean {
  return firstIssue(issues) === undefined
}

/** `16 bytes` / `8 bytes` — used in provenance lines. Never prints the key. */
export function keySizeLabel(hex: string): string {
  return `${hexBytes(hex)} bytes`
}
