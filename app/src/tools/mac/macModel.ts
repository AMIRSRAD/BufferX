/**
 * MAC tool domain model (UX_SPEC 3.1).
 *
 * Everything here is pure: option inventories, client-side validation rules,
 * the input signature that drives result staleness, and the byte-level diff
 * behind the Received / Expected comparison.
 *
 * Secrets discipline: no function in this module logs, persists, or returns a
 * key. `keyFingerprint` deliberately collapses the key to a 32-bit hash so the
 * staleness signature can be compared without carrying key material around.
 */

import type { SelectOption } from '@/components/ui/Select'
import type { FieldRow, HeaderConfig } from '@/store/buffers'

/** The engine's `paddingMode` enum, exactly. */
export type PaddingMode = 'iso9797-1' | 'iso9797-2'

/** Both options the legacy panel offered, with their operator-facing labels. */
export const PADDING_OPTIONS: readonly SelectOption[] = [
  { value: 'iso9797-1', label: 'ISO9797 M1', hint: 'zero padding' },
  { value: 'iso9797-2', label: 'ISO9797 M2', hint: '0x80 then zero padding' },
]

export const PADDING_LABEL: Record<PaddingMode, string> = {
  'iso9797-1': 'ISO9797 M1',
  'iso9797-2': 'ISO9797 M2',
}

export function isPaddingMode(value: string): value is PaddingMode {
  return value === 'iso9797-1' || value === 'iso9797-2'
}

/** Enforced by the engine (`readMacKeyHex`) and mirrored here so the operator is told first. */
export const MAC_KEY_BYTE_LENGTHS: readonly number[] = [8, 16, 24]

/** ISO 8583 bit numbers. 0 is legal — the engine only rejects negatives. */
export const MIN_MAC_FIELD_ID = 0
export const MAX_MAC_FIELD_ID = 128

/** The bit the legacy panel defaulted to when a packager declared nothing. */
export const FALLBACK_MAC_FIELD_ID = 64

/** Summary returned by `packager.list` / `packager.loadXml` (ABI `packagerSummary`). */
export interface PackagerSummary {
  name: string
  macMethod: string
  macSize: number
  macConfigured: boolean
  bitmapIndex: number
  secondPartBitmap: boolean
  fieldCount: number
  lenFormat: string
  lenLen: number
  fieldDefinitionCount: number
  macFieldIds: number[]
}

export interface CalculatedResult {
  hex: string
  /** Input signature at the moment the engine answered. Drives staleness. */
  signature: string
  at: number
}

export interface VerificationResult {
  valid: boolean
  expectedHex: string
  actualHex: string
  /** The bit the received MAC was read from, so the result can say `← from F64`. */
  fieldId: number
  signature: string
  at: number
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const HEX_ONLY = /^[0-9A-F]*$/

/**
 * The key rule, client-side. Returns operator-facing text or `null`.
 * Never quotes the key back.
 */
export function macKeyProblem(keyHex: string): string | null {
  if (keyHex.length === 0) return 'A MAC key is required.'
  if (!HEX_ONLY.test(keyHex)) return 'The key must be hexadecimal (0-9, A-F).'
  if (keyHex.length % 2 === 1) return 'The key has an odd number of hex characters — hex needs whole bytes.'
  const bytes = keyHex.length / 2
  if (!MAC_KEY_BYTE_LENGTHS.includes(bytes)) {
    return `The key is ${bytes} bytes. A MAC key must be 8, 16, or 24 bytes (16, 32, or 48 hex characters).`
  }
  return null
}

/** Parses and range-checks the MAC field input. Returns text or `null`. */
export function macFieldProblem(raw: string): string | null {
  if (raw.trim().length === 0) return 'A MAC field id is required.'
  if (!/^\d+$/.test(raw.trim())) return 'The MAC field id must be a whole number.'
  const id = Number(raw.trim())
  if (id < MIN_MAC_FIELD_ID || id > MAX_MAC_FIELD_ID) {
    return `The MAC field id must be between ${MIN_MAC_FIELD_ID} and ${MAX_MAC_FIELD_ID}.`
  }
  return null
}

export function parseMacFieldId(raw: string): number | null {
  return macFieldProblem(raw) === null ? Number(raw.trim()) : null
}

/**
 * Why the length header cannot be included, or `null`.
 * The engine rejects `enabled` with `size <= 0` and cannot frame with mode `none`.
 */
export function headerProblem(header: HeaderConfig, include: boolean): string | null {
  if (!include) return null
  if (header.mode === 'none') {
    return 'The buffer has no framing. Choose ASCII or Binary framing in the raw pane before including a length header.'
  }
  if (header.size <= 0) return 'The buffer’s header size is 0. Set a header size of 1-8 bytes in the raw pane.'
  return null
}

/* ------------------------------------------------------------------ */
/* Staleness signature                                                 */
/* ------------------------------------------------------------------ */

/**
 * 32-bit FNV-1a. Used only to detect *change*, never as a security primitive —
 * its job is to keep the key out of the signature string.
 */
export function keyFingerprint(keyHex: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < keyHex.length; i += 1) {
    hash ^= keyHex.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

export interface SignatureInput {
  packager: string
  macFieldId: string
  padding: PaddingMode
  includeHeader: boolean
  header: HeaderConfig
  legacyEngine: boolean
  fields: readonly FieldRow[]
  keyHex: string
}

/**
 * Everything a MAC depends on, folded into one comparable string. A change in
 * any of it retires the current result — UX_SPEC 3.1: "the verdict clears the
 * moment any input changes".
 */
export function inputSignature(input: SignatureInput): string {
  const fields = input.fields.map((field) => `${field.id}=${field.value}`).join('')
  return [
    input.packager,
    input.macFieldId,
    input.padding,
    input.includeHeader ? '1' : '0',
    `${input.header.mode}:${input.header.size}`,
    input.legacyEngine ? 'legacy' : 'strict',
    keyFingerprint(input.keyHex),
    fields,
  ].join('')
}

/* ------------------------------------------------------------------ */
/* Hex presentation and diffing                                        */
/* ------------------------------------------------------------------ */

/** Splits hex into byte pairs. A trailing half-byte is kept so it stays visible. */
export function splitBytes(hex: string): string[] {
  const out: string[] = []
  for (let i = 0; i < hex.length; i += 2) out.push(hex.slice(i, i + 2))
  return out
}

/** `9A4C71E288B03D51` -> `9A4C 71E2 88B0 3D51` (two bytes per group, as in the spec). */
export function groupMac(hex: string): string {
  const bytes = splitBytes(hex)
  const groups: string[] = []
  for (let i = 0; i < bytes.length; i += 2) groups.push(bytes.slice(i, i + 2).join(''))
  return groups.join(' ')
}

export interface MacDiff {
  /** Zero-based indices of bytes that differ, including length overhang. */
  differing: ReadonlySet<number>
  /** 1-based index of the first differing byte, or `null` when identical. */
  firstDifferenceAt: number | null
  differingCount: number
  lengthMismatch: boolean
}

export function diffMac(expectedHex: string, actualHex: string): MacDiff {
  const expected = splitBytes(expectedHex)
  const actual = splitBytes(actualHex)
  const length = Math.max(expected.length, actual.length)
  const differing = new Set<number>()
  for (let i = 0; i < length; i += 1) {
    if (expected[i] !== actual[i]) differing.add(i)
  }
  const first = differing.size > 0 ? Math.min(...differing) + 1 : null
  return {
    differing,
    firstDifferenceAt: first,
    differingCount: differing.size,
    lengthMismatch: expected.length !== actual.length,
  }
}

/** `MISMATCH · differs at byte 8`, or the length-aware variant. */
export function mismatchSummary(diff: MacDiff): string {
  if (diff.lengthMismatch) {
    return `MISMATCH · length differs${
      diff.firstDifferenceAt === null ? '' : ` · first difference at byte ${diff.firstDifferenceAt}`
    }`
  }
  if (diff.firstDifferenceAt === null) return 'MISMATCH'
  return diff.differingCount === 1
    ? `MISMATCH · differs at byte ${diff.firstDifferenceAt}`
    : `MISMATCH · differs at byte ${diff.firstDifferenceAt} · ${diff.differingCount} bytes differ`
}

/* ------------------------------------------------------------------ */
/* Readouts                                                            */
/* ------------------------------------------------------------------ */

/** `Method FULL · Size 8 · Fields 64, 128` (UX_SPEC 3.1 metadata readout). */
export function macMetadataLine(summary: PackagerSummary): string {
  const method = summary.macMethod.trim().length > 0 ? summary.macMethod.trim() : 'unspecified'
  const fields = summary.macFieldIds.length > 0 ? summary.macFieldIds.join(', ') : 'none declared'
  return `Method ${method} · Size ${summary.macSize} · Fields ${fields}`
}

export interface ProvenanceInput {
  padding: PaddingMode
  keyHex: string
  kcv: string | null
  scope: string
  fieldCount: number
  includeHeader: boolean
  header: HeaderConfig
  legacyEngine: boolean
  manual: boolean
}

/**
 * The 11px muted line under a result:
 * `ISO9797 M2 · key 16 bytes (KCV 4A2B71) · scope FULL · 12 fields · header included (ascii, 4 bytes)`.
 */
export function provenanceLine(input: ProvenanceInput): string {
  const parts: string[] = [PADDING_LABEL[input.padding]]
  const bytes = Math.floor(input.keyHex.length / 2)
  parts.push(input.kcv ? `key ${bytes} bytes (KCV ${input.kcv})` : `key ${bytes} bytes`)
  parts.push(`scope ${input.scope}${input.manual ? ' (manual)' : ''}`)
  parts.push(`${input.fieldCount} ${input.fieldCount === 1 ? 'field' : 'fields'}`)
  parts.push(
    input.includeHeader
      ? `header included (${input.header.mode}, ${input.header.size} bytes)`
      : 'header excluded',
  )
  if (input.legacyEngine) parts.push('legacy engine')
  return parts.join(' · ')
}
