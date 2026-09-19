/**
 * The IranSystem conversion matrix.
 *
 * UX_SPEC 3.6 asks for a provenance line that "names the exact transform that
 * ran", because "the profile x direction x encoding matrix produces materially
 * different bytes; the old app gave no clue which of the ~12 branches
 * executed". That is only honest if the branch selection lives in one readable
 * place, so it lives here rather than inside the panel's event handlers.
 *
 * The model, stated once:
 *
 * - One side of every conversion is **IranSystem bytes**; the other side is
 *   **Unicode text**. `Direction` says which side is the input.
 * - `Encoding` is the textual representation of the *IranSystem* side only.
 *   `Hex` is hex digits, `ANSI` is Windows-1256 (one character per byte), and
 *   `UTF-8` is a raw UTF-8 decoding of those same bytes.
 * - Everything therefore funnels through a hex byte string, which is also what
 *   the panel shows in its copyable `Hex` row.
 *
 * The engine ops `text.iranSystemTextToUtf8` and `text.utf8ToIranSystemText`
 * are exactly the ANSI cells of this matrix (`toUnicode(utf8ToCp1256(text))`
 * and its inverse). They are not called here only because they do not return
 * the byte hex the panel must display; the composed path below produces
 * byte-identical results.
 *
 * Nothing in this module logs, and nothing it handles is secret -- IranSystem
 * payloads are message content, not key material.
 */

import { call } from '@/engine/client'
import { normalizeHex } from '@/components/ui/HexInput'
import type { SelectOption } from '@/components/ui/Select'

export type Profile = 'normalized' | 'atm'
export type Direction = 'decode' | 'encode'
export type Encoding = 'utf8' | 'ansi' | 'hex'

/** Labels are the Qt panel's strings, preserved verbatim (Appendix A). */
export const PROFILE_OPTIONS: SelectOption[] = [
  { value: 'normalized', label: 'Normalized', hint: 'round-trips' },
  { value: 'atm', label: 'ATM Engine', hint: 'legacy bytes' },
]

export const DIRECTION_OPTIONS: SelectOption[] = [
  { value: 'decode', label: 'Decode IranSys', hint: 'bytes to text' },
  { value: 'encode', label: 'Encode IranSys', hint: 'text to bytes' },
]

export const ENCODING_OPTIONS: SelectOption[] = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'ansi', label: 'ANSI', hint: 'CP1256' },
  { value: 'hex', label: 'Hex' },
]

export const ENCODING_LABEL: Record<Encoding, string> = {
  utf8: 'UTF-8',
  ansi: 'ANSI',
  hex: 'Hex',
}

export const PROFILE_LABEL: Record<Profile, string> = {
  normalized: 'Normalized',
  atm: 'ATM Engine',
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  decode: 'Decode IranSys',
  encode: 'Encode IranSys',
}

export interface ConversionRequest {
  input: string
  profile: Profile
  direction: Direction
  encoding: Encoding
  /** `Convert digits to IranSystem`. Only consulted when encoding. */
  convertNumbers: boolean
}

export interface ConversionOutcome {
  /** What the output pane renders. */
  text: string
  /** The IranSystem bytes involved, uppercase hex, no separators. */
  hex: string
  /** Engine ops that ran, in order, without the `text.` prefix. */
  ops: string[]
  /** Length of the IranSystem byte string. */
  bytes: number
  /** Code points in `text`. */
  chars: number
  /** Code points in the input. */
  inputChars: number
  /** The output pane is hex digits rather than natural-language text. */
  outputIsHex: boolean
}

/** Code points, not UTF-16 units -- Persian text is BMP, but emoji get pasted. */
export function countChars(text: string): number {
  return Array.from(text).length
}

/** Separators an operator legitimately pastes inside hex. */
const HEX_SEPARATORS = /[\s:_,-]+/g

/** Strips accepted separators without discarding anything else. */
function stripSeparators(raw: string): string {
  return raw.replace(HEX_SEPARATORS, '')
}

/**
 * Client-side precondition check, so a mistyped payload never becomes an
 * engine round trip and a red alert. Returns the message to show under the
 * input, or `null` when the request is well formed.
 */
export function validateRequest(request: ConversionRequest): string | null {
  if (request.direction !== 'decode' || request.encoding !== 'hex') return null

  const stripped = stripSeparators(request.input)
  const offenders = new Set<string>()
  for (const ch of stripped) {
    if (!/[0-9a-fA-F]/.test(ch)) offenders.add(ch)
  }
  if (offenders.size > 0) {
    return `Not hexadecimal. Remove ${[...offenders].map((ch) => `"${ch}"`).join(', ')}, or switch Encoding to UTF-8 or ANSI.`
  }
  if (stripped.length % 2 !== 0) {
    return `Hex needs an even number of digits — ${stripped.length} given. Add a leading zero to the odd byte.`
  }
  return null
}

/** The lowest and highest field ids the packager model allows. */
export const MIN_FIELD_ID = 0
export const MAX_FIELD_ID = 128

/** Validates the `Field` spinner. Returns a message or `null`. */
export function validateFieldId(raw: string): string | null {
  if (raw.trim() === '') return 'Enter a field number.'
  if (!/^\d+$/.test(raw.trim())) return 'Field must be a whole number.'
  const value = Number(raw)
  if (value < MIN_FIELD_ID || value > MAX_FIELD_ID) {
    return `Field must be between ${MIN_FIELD_ID} and ${MAX_FIELD_ID}.`
  }
  return null
}

/** Which engine op turns IranSystem bytes into Unicode, per profile. */
function decodeOp(profile: Profile): string {
  return profile === 'atm' ? 'text.atmEngineIranSystemToUnicode' : 'text.iranSystemToUnicode'
}

/** Which engine op turns Unicode into IranSystem bytes, per profile. */
function encodeOp(profile: Profile): string {
  return profile === 'atm' ? 'text.unicodeToAtmEngineIranSystem' : 'text.unicodeToIranSystem'
}

/** Strips the `text.` namespace so the provenance line stays readable. */
function shortOp(op: string): string {
  return op.startsWith('text.') ? op.slice('text.'.length) : op
}

/**
 * Renders the IranSystem side of a conversion from its textual form to hex.
 * `Hex` is handled locally; the other two are engine conversions so the code
 * pages stay in one implementation (the C++ core), not two.
 */
async function toIranSystemHex(
  input: string,
  encoding: Encoding,
): Promise<{ hex: string; ops: string[] }> {
  if (encoding === 'hex') {
    return { hex: normalizeHex(input), ops: [] }
  }
  const op = encoding === 'ansi' ? 'text.utf8ToAnsiHex' : 'text.utf8ToHex'
  const result = await call<{ hex: string }>(op, { text: input })
  return { hex: normalizeHex(result.hex ?? ''), ops: [shortOp(op)] }
}

/**
 * Renders IranSystem bytes into the textual form `encoding` selects. `Hex`
 * needs no engine call; the other two do, for the same reason as above.
 */
async function fromIranSystemHex(
  hex: string,
  encoding: Encoding,
): Promise<{ text: string; ops: string[] }> {
  if (encoding === 'hex') return { text: hex, ops: [] }
  if (hex === '') return { text: '', ops: [] }
  const op = encoding === 'ansi' ? 'text.ansiHexToUtf8' : 'text.hexToUtf8'
  const result = await call<{ text: string }>(op, { hex })
  return { text: result.text ?? '', ops: [shortOp(op)] }
}

/**
 * Runs one cell of the matrix.
 *
 * Throws `EngineCallError` on failure; the panel renders it inline (UX_SPEC
 * 5.1) rather than catching it into a modal.
 */
export async function runConversion(request: ConversionRequest): Promise<ConversionOutcome> {
  const { input, profile, direction, encoding, convertNumbers } = request
  const inputChars = countChars(input)

  if (direction === 'decode') {
    const source = await toIranSystemHex(input, encoding)
    const op = decodeOp(profile)
    const text =
      source.hex === ''
        ? ''
        : ((await call<{ text: string }>(op, { payload: source.hex, inputHex: true })).text ?? '')

    return {
      text,
      hex: source.hex,
      ops: source.hex === '' ? source.ops : [...source.ops, shortOp(op)],
      bytes: source.hex.length / 2,
      chars: countChars(text),
      inputChars,
      outputIsHex: false,
    }
  }

  const op = encodeOp(profile)
  const encoded = await call<{ hex: string; text: string }>(op, { text: input, convertNumbers })
  const hex = normalizeHex(encoded.hex ?? '')
  const rendered = await fromIranSystemHex(hex, encoding)

  return {
    text: rendered.text,
    hex,
    ops: [shortOp(op), ...rendered.ops],
    bytes: hex.length / 2,
    chars: encoding === 'hex' ? hex.length / 2 : countChars(rendered.text),
    inputChars,
    outputIsHex: encoding === 'hex',
  }
}

/**
 * A stable fingerprint of everything a result depended on. The panel compares
 * it against the live controls to decide whether the result block is stale
 * (UX_SPEC 3.0: "changing any input greys the result block ... and adds
 * `inputs changed` to the provenance line").
 */
export function requestSignature(request: ConversionRequest): string {
  return [
    request.profile,
    request.direction,
    request.encoding,
    request.direction === 'encode' ? String(request.convertNumbers) : 'n/a',
    request.input,
  ].join(' ')
}

/** `Transform: utf8ToAnsiHex → atmEngineIranSystemToUnicode · 24 bytes in / 17 chars out`. */
export function provenanceLine(
  request: ConversionRequest,
  outcome: ConversionOutcome,
  stale: boolean,
): string {
  const parts: string[] = []
  parts.push(`Transform: ${outcome.ops.length > 0 ? outcome.ops.join(' → ') : 'none'}`)
  if (request.direction === 'encode') {
    parts.push(request.convertNumbers ? 'digits converted' : 'digits unchanged')
    parts.push(`${outcome.inputChars} chars in / ${outcome.bytes} bytes out`)
  } else {
    parts.push(`${outcome.bytes} bytes in / ${outcome.chars} chars out`)
  }
  parts.push(`${PROFILE_LABEL[request.profile]} · ${ENCODING_LABEL[request.encoding]}`)
  if (stale) parts.push('inputs changed')
  return parts.join(' · ')
}
