/**
 * Pure model for the buffer workspace (UX_SPEC 2).
 *
 * Everything in this file is side-effect free and engine-free: byte plumbing,
 * encoding sniffing, the byte-region map that powers field-to-byte linking, the
 * client-side validators, the packager catalogue grouping, and the buffer file
 * format. Keeping it pure is what makes the workspace testable and what keeps
 * the React files about layout rather than arithmetic.
 *
 * Secrets note: a buffer holds real message content (PAN in F2, track data in
 * F35, a PIN block in F52). Nothing here logs, serialises to storage, or writes
 * to a URL. The only serialiser is `encodeBufferFile`, which the operator
 * invokes explicitly and which is written to a file they choose.
 */
import type { NewTabInit } from '@/store/buffers'

/* ────────────────────────────────────────────────────────────────────────────
   Unknown-shape helpers
   The engine contract is JSON over an ABI boundary, so every response is
   validated rather than cast. A malformed payload degrades; it never throws.
   ──────────────────────────────────────────────────────────────────────────── */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/* ────────────────────────────────────────────────────────────────────────────
   Bytes
   ──────────────────────────────────────────────────────────────────────────── */

const HEX_DIGITS = '0123456789ABCDEF'

export function isHexChar(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')
  )
}

/** Strips separators and uppercases. The model value never carries grouping. */
export function normalizeHex(raw: string): string {
  let out = ''
  for (const ch of raw) if (isHexChar(ch)) out += ch
  return out.toUpperCase()
}

export function groupHex(hex: string, groupBy = 2): string {
  if (groupBy <= 0) return hex
  const parts: string[] = []
  for (let index = 0; index < hex.length; index += groupBy) {
    parts.push(hex.slice(index, index + groupBy))
  }
  return parts.join(' ')
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = normalizeHex(hex)
  const length = Math.floor(clean.length / 2)
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) {
    out += HEX_DIGITS[(byte >> 4) & 0xf] ?? '0'
    out += HEX_DIGITS[byte & 0xf] ?? '0'
  }
  return out
}

export function textToBytes(text: string): Uint8Array {
  if (typeof TextEncoder === 'undefined') {
    const out = new Uint8Array(text.length)
    for (let index = 0; index < text.length; index += 1) out[index] = text.charCodeAt(index) & 0xff
    return out
  }
  return new TextEncoder().encode(text)
}

export function bytesToText(bytes: Uint8Array): string {
  if (typeof TextDecoder === 'undefined') {
    let out = ''
    for (const byte of bytes) out += String.fromCharCode(byte)
    return out
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** The raw pane's contents as bytes, honouring its Text/Hex representation. */
export function rawToBytes(raw: string, inputHex: boolean): Uint8Array {
  return inputHex ? hexToBytes(raw) : textToBytes(raw)
}

export function byteLengthOf(raw: string, inputHex: boolean): number {
  if (inputHex) return Math.floor(normalizeHex(raw).length / 2)
  return textToBytes(raw).length
}

/** Odd-nibble tail in Hex mode — a warning, never an error (UX_SPEC 2.3). */
export function hasHalfByte(raw: string, inputHex: boolean): boolean {
  return inputHex && normalizeHex(raw).length % 2 === 1
}

export function offsetLabel(offset: number): string {
  return `0x${offset.toString(16).toUpperCase().padStart(4, '0')}`
}

/* ────────────────────────────────────────────────────────────────────────────
   Encoding sniff (UX_SPEC 2.1 step 1)
   ──────────────────────────────────────────────────────────────────────────── */

export type EncodingGuess = 'hex' | 'text'

/**
 * Hex when every character is a hex digit or whitespace *and* the nibble count
 * is even. The result is a proposal, never applied silently.
 */
export function sniffEncoding(raw: string): EncodingGuess {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return 'text'
  let nibbles = 0
  for (const ch of trimmed) {
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue
    if (!isHexChar(ch)) return 'text'
    nibbles += 1
  }
  return nibbles > 0 && nibbles % 2 === 0 ? 'hex' : 'text'
}

/** Byte offsets that cannot survive a switch to Text mode. */
export function nonAsciiOffsets(bytes: Uint8Array): number[] {
  const out: number[] = []
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index] ?? 0
    if (byte < 0x20 || byte > 0x7e) out.push(index)
  }
  return out
}

export function hasNonAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return true
  }
  return false
}

/* ────────────────────────────────────────────────────────────────────────────
   Packager catalogue (UX_SPEC 2.2)
   ──────────────────────────────────────────────────────────────────────────── */

export interface PackagerInfo {
  name: string
  desc?: string
  /** `LenLen` from the XML — drives the framing header size. */
  lenLen?: number
  macMethod?: string
  macSize?: number
  macFieldIds?: number[]
  fieldCount?: number
}

/**
 * The 32 shipped entries, grouped for scanning. Grouping is presentational
 * only; search is flat and fuzzy. Any packager the engine reports that is not
 * listed here lands in `Other`, so a custom XML is never hidden.
 */
export const PACKAGER_GROUPS: ReadonlyArray<{ label: string; names: readonly string[] }> = [
  { label: 'Hosts', names: ['SLM', 'NEGIN', 'NEGINLink', 'INFOTECH', 'HYPERCOM', 'SHETAB7'] },
  { label: 'Datasets', names: ['DATASET', 'BIT121'] },
  {
    label: 'Tables',
    names: ['TABLE71', 'TABLE73', 'TABLE62', 'TABLE69', 'TABLE74', 'TABLE89', 'TABLE27'],
  },
  { label: 'Amount / Statement', names: ['AMNT87', 'AMNT2003', 'STMNT2003'] },
  {
    label: 'STX',
    names: [
      'STX10',
      'STX11',
      'STX12',
      'STX13',
      'STX14',
      'STX15',
      'STX20',
      'STX21',
      'STX01',
      'STX60',
      'STX61',
      'STX62',
      'STX65',
      'STX67',
    ],
  },
]

export const KNOWN_PACKAGERS: readonly string[] = PACKAGER_GROUPS.flatMap((group) => group.names)

export function normalizePackagerList(data: unknown): PackagerInfo[] {
  const record = asRecord(data)
  const list = asArray(record?.packagers ?? data)
  const out: PackagerInfo[] = []

  for (const entry of list) {
    if (typeof entry === 'string') {
      out.push({ name: entry })
      continue
    }
    const item = asRecord(entry)
    if (!item) continue
    const name = asString(item.name) ?? asString(item.packager) ?? asString(item.id)
    if (!name) continue

    const info: PackagerInfo = { name }
    const desc = asString(item.desc) ?? asString(item.description)
    if (desc) info.desc = desc
    const lenLen = asNumber(item.lenLen) ?? asNumber(item.lenlen) ?? asNumber(item.headerSize)
    if (lenLen !== undefined) info.lenLen = lenLen
    const macMethod = asString(item.macMethod) ?? asString(item.macMode)
    if (macMethod) info.macMethod = macMethod
    const macSize = asNumber(item.macSize)
    if (macSize !== undefined) info.macSize = macSize
    const macFields = asArray(item.macFieldIds ?? item.macFields)
      .map((value) => asNumber(value))
      .filter((value): value is number => value !== undefined)
    if (macFields.length > 0) info.macFieldIds = macFields
    const fieldCount = asNumber(item.fieldCount) ?? asNumber(item.fields)
    if (fieldCount !== undefined) info.fieldCount = fieldCount

    out.push(info)
  }

  return out
}

/** `LenLen 4 · MAC FULL/8 · 64 fields` — metadata the XML already carried. */
export function packagerSummary(info: PackagerInfo): string {
  const parts: string[] = []
  if (info.lenLen !== undefined) parts.push(`LenLen ${info.lenLen}`)
  parts.push(
    info.macMethod
      ? `MAC ${info.macMethod}${info.macSize ? `/${info.macSize}` : ''}`
      : 'no MAC',
  )
  if (info.fieldCount !== undefined) parts.push(`${info.fieldCount} fields`)
  return parts.join(' · ')
}

export function groupPackagers(
  infos: readonly PackagerInfo[],
): Array<{ label: string; items: PackagerInfo[] }> {
  const byName = new Map(infos.map((info) => [info.name, info]))
  const used = new Set<string>()
  const groups: Array<{ label: string; items: PackagerInfo[] }> = []

  for (const group of PACKAGER_GROUPS) {
    const items: PackagerInfo[] = []
    for (const name of group.names) {
      const info = byName.get(name)
      if (!info) continue
      items.push(info)
      used.add(name)
    }
    if (items.length > 0) groups.push({ label: group.label, items })
  }

  const rest = infos.filter((info) => !used.has(info.name))
  if (rest.length > 0) groups.push({ label: 'Other', items: rest })
  return groups
}

/* ────────────────────────────────────────────────────────────────────────────
   Field definitions
   ──────────────────────────────────────────────────────────────────────────── */

export interface FieldDef {
  id: number
  name?: string
  /** Packager type code, e.g. `N`, `AN`, `ANS`, `B`, `Z`. */
  type?: string
  length?: number
  variable?: boolean
}

export function normalizeFieldDefs(data: unknown): FieldDef[] {
  const record = asRecord(data)
  const list = asArray(record?.fields ?? data)
  const out: FieldDef[] = []

  for (const entry of list) {
    const item = asRecord(entry)
    if (!item) continue
    const id = asNumber(item.id) ?? asNumber(item.bit) ?? asNumber(item.number)
    if (id === undefined) continue

    const def: FieldDef = { id }
    const name = asString(item.desc) ?? asString(item.name) ?? asString(item.description)
    if (name) def.name = name
    const type = asString(item.type)
    if (type) def.type = type
    const length = asNumber(item.length) ?? asNumber(item.len)
    if (length !== undefined) def.length = length
    const variable = asBoolean(item.variable)
    if (variable !== undefined) def.variable = variable

    out.push(def)
  }

  out.sort((a, b) => a.id - b.id)
  return out
}

/** Long form for the `Type` chip's tooltip and its screen-reader expansion. */
export function typeWord(type: string | undefined): string {
  switch ((type ?? '').toUpperCase()) {
    case 'N':
    case 'NUMERIC':
      return 'Numeric'
    case 'AN':
      return 'Alphanumeric'
    case 'ANS':
      return 'Alphanumeric and special'
    case 'B':
    case 'BINARY':
      return 'Binary'
    case 'Z':
    case 'TRACK':
      return 'Track data'
    default:
      return 'Unknown type'
  }
}

export function typeChip(type: string | undefined): string {
  const upper = (type ?? '').toUpperCase()
  if (upper === '') return '?'
  if (upper === 'NUMERIC') return 'N'
  if (upper === 'BINARY') return 'B'
  if (upper === 'TRACK') return 'Z'
  return upper.slice(0, 3)
}

export function isBinaryType(type: string | undefined): boolean {
  const upper = (type ?? '').toUpperCase()
  return upper === 'B' || upper === 'BINARY'
}

export function isNumericType(type: string | undefined): boolean {
  const upper = (type ?? '').toUpperCase()
  return upper === 'N' || upper === 'NUMERIC'
}

/* ────────────────────────────────────────────────────────────────────────────
   Byte regions — the map behind field-to-byte linking (UX_SPEC 2.3)
   ──────────────────────────────────────────────────────────────────────────── */

export type RegionKind = 'length' | 'mti' | 'bitmap' | 'field' | 'prefix' | 'unparsed'

export interface Region {
  kind: RegionKind
  /** First byte. */
  start: number
  /** One past the last byte. */
  end: number
  label: string
  /** Bit number, for `field` regions only. */
  fieldId?: number
  /** 0-based palette slot, wrapping onto `hl-1 … hl-8`. */
  colorIndex: number
}

/**
 * Reserved slots for the three structural regions. The palette has eight ink
 * hues; data fields cycle all eight in ascending bit order so a field keeps its
 * colour across decodes, and the structural regions take fixed slots. Where a
 * data field collides with one of them the label, the bracket glyph and the
 * `Bit` column still disambiguate — colour is never the only signal.
 */
const LENGTH_SLOT = 4
const MTI_SLOT = 5
const BITMAP_SLOT = 7

/** Stable per-field colour: index in ascending bit order, modulo 8. */
export function fieldColorIndex(fieldIds: readonly number[], fieldId: number): number {
  const ordered = [...fieldIds].sort((a, b) => a - b)
  const position = ordered.indexOf(fieldId)
  return position < 0 ? 0 : position % 8
}

/** Finds `needle` in `haystack` at or after `from`. Returns -1 when absent. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  if (needle.length === 0) return -1
  const limit = haystack.length - needle.length
  const first = needle[0]
  for (let start = Math.max(0, from); start <= limit; start += 1) {
    if (haystack[start] !== first) continue
    let match = true
    for (let offset = 1; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        match = false
        break
      }
    }
    if (match) return start
  }
  return -1
}

export interface RegionField {
  id: number
  value: string
  /** Wire hex reported by the decode, when available. Authoritative. */
  hex?: string
  desc?: string
  type?: string
  /** The row's `Fmt` state: the value string is hex rather than text. */
  hexMode?: boolean
}

/** The wire bytes of one field row, preferring the engine's own hex. */
export function fieldWireBytes(field: RegionField): Uint8Array {
  if (field.hex && normalizeHex(field.hex).length >= 2) return hexToBytes(field.hex)
  if (field.value === '') return new Uint8Array(0)
  if (field.hexMode || isBinaryType(field.type)) return hexToBytes(field.value)
  return textToBytes(field.value)
}

export interface RegionMap {
  regions: Region[]
  /** Bit number → its region, for table → bytes lookups. */
  byField: Map<number, Region>
  /** Fields whose bytes could not be located in the message. */
  unmapped: number[]
  /** Bytes after the last mapped field. */
  trailing: number
}

/**
 * Derives the byte layout of the encoded message.
 *
 * The engine contract in this build returns per-field wire hex but no offsets
 * (UX_SPEC 2.3 raises that as an `ENGINE REQUIREMENT`). Until it does, the map
 * is recovered by walking the fields in ascending bit order and locating each
 * field's wire bytes at or after a moving cursor. Gaps are classified: the run
 * between the MTI and the first data field is the bitmap, short runs between
 * data fields are length prefixes, everything else is unparsed — which is
 * exactly the decode problem an operator needs to *see*.
 *
 * A field whose bytes cannot be found is reported in `unmapped` rather than
 * guessed at, so the byte view never lies about where a value lives.
 */
export function computeRegions(
  bytes: Uint8Array,
  fields: readonly RegionField[],
  headerBytes: number,
): RegionMap {
  const regions: Region[] = []
  const byField = new Map<number, Region>()
  const unmapped: number[] = []

  if (bytes.length === 0) {
    return {
      regions,
      byField,
      unmapped: fields.filter((field) => field.value !== '').map((field) => field.id),
      trailing: 0,
    }
  }

  let cursor = 0
  if (headerBytes > 0 && headerBytes < bytes.length) {
    regions.push({
      kind: 'length',
      start: 0,
      end: headerBytes,
      label: 'LEN',
      colorIndex: LENGTH_SLOT,
    })
    cursor = headerBytes
  }

  const ordered = [...fields].sort((a, b) => a.id - b.id)
  const ids = ordered.map((field) => field.id)
  let sawMti = false
  let sawBitmap = false

  for (const field of ordered) {
    // An empty field occupies no bytes. That is not a mapping failure.
    const wire = fieldWireBytes(field)
    if (wire.length === 0) continue

    const at = indexOfBytes(bytes, wire, cursor)
    if (at < 0) {
      unmapped.push(field.id)
      continue
    }

    if (at > cursor) {
      const gapLength = at - cursor
      if (sawMti && !sawBitmap) {
        regions.push({
          kind: 'bitmap',
          start: cursor,
          end: at,
          label: 'BITMAP',
          colorIndex: BITMAP_SLOT,
        })
        sawBitmap = true
      } else if (gapLength <= 4) {
        regions.push({
          kind: 'prefix',
          start: cursor,
          end: at,
          label: `len F${field.id}`,
          colorIndex: LENGTH_SLOT,
        })
      } else {
        regions.push({
          kind: 'unparsed',
          start: cursor,
          end: at,
          label: `${gapLength} unparsed`,
          colorIndex: 0,
        })
      }
    }

    const isMti = field.id === 0 && !sawMti
    const region: Region = isMti
      ? { kind: 'mti', start: at, end: at + wire.length, label: 'MTI', colorIndex: MTI_SLOT }
      : {
          kind: 'field',
          start: at,
          end: at + wire.length,
          label: `F${String(field.id).padStart(3, '0')}${field.desc ? ` · ${field.desc}` : ''}`,
          fieldId: field.id,
          colorIndex: fieldColorIndex(ids, field.id),
        }
    if (isMti) sawMti = true

    regions.push(region)
    byField.set(field.id, region)
    cursor = region.end
  }

  const trailing = bytes.length - cursor
  if (trailing > 0 && cursor > 0) {
    regions.push({
      kind: 'unparsed',
      start: cursor,
      end: bytes.length,
      label: `+${trailing} unparsed`,
      colorIndex: 0,
    })
  }

  return { regions, byField, unmapped, trailing: Math.max(0, trailing) }
}

/* ────────────────────────────────────────────────────────────────────────────
   Client-side validation (UX_SPEC 2.4 / 2.5)
   Only rules that are knowable without the engine live here. The engine stays
   authoritative on Build.
   ──────────────────────────────────────────────────────────────────────────── */

export type DiagnosticSeverity = 'error' | 'warning' | 'info'
export type DiagnosticFix = 'trim' | 'pad' | 'strip' | 'toHex' | 'bufferToHex' | null

export interface FieldDiagnostic {
  code: 'space' | 'nonAscii' | 'length' | 'badHex' | 'nonNumeric'
  severity: DiagnosticSeverity
  /** Single glyph shown in the cell. Never the only signal — it has a tooltip. */
  glyph: string
  message: string
  fix: DiagnosticFix
  fixLabel?: string
}

export interface ValidationInput {
  value: string
  hexMode: boolean
  def?: FieldDef | undefined
  /** The raw pane is in Text mode, so non-ASCII cannot survive a build. */
  bufferIsText: boolean
}

export function validateFieldValue({
  value,
  hexMode,
  def,
  bufferIsText,
}: ValidationInput): FieldDiagnostic[] {
  const out: FieldDiagnostic[] = []
  if (value === '') return out

  const binary = isBinaryType(def?.type)
  const asHex = hexMode || binary

  if (asHex) {
    const clean = normalizeHex(value)
    if (clean.length !== value.replace(/\s/g, '').length) {
      out.push({
        code: 'badHex',
        severity: 'error',
        glyph: '!',
        message: 'Value contains characters that are not hex digits.',
        fix: null,
      })
    } else if (clean.length % 2 === 1) {
      out.push({
        code: 'badHex',
        severity: 'error',
        glyph: '!',
        message: `Hex value has an odd nibble count (${clean.length} nibbles).`,
        fix: 'pad',
        fixLabel: 'Pad with a zero nibble',
      })
    }
  } else {
    if (value !== value.trim()) {
      out.push({
        code: 'space',
        severity: 'info',
        glyph: '␣',
        message: 'Leading or trailing space.',
        fix: 'trim',
        fixLabel: 'Trim',
      })
    }
    if (bufferIsText && hasNonAscii(value)) {
      out.push({
        code: 'nonAscii',
        severity: 'warning',
        glyph: 'Ä',
        message: 'Non-ASCII content while the buffer is in Text mode.',
        fix: 'toHex',
        fixLabel: 'Convert field to hex',
      })
    }
    if (isNumericType(def?.type) && /\D/.test(value)) {
      out.push({
        code: 'nonNumeric',
        severity: 'error',
        glyph: '!',
        message: 'Numeric field contains characters that are not digits.',
        fix: 'strip',
        fixLabel: 'Strip non-digits',
      })
    }
  }

  const declared = def?.length
  if (declared !== undefined && declared > 0 && !def?.variable) {
    const actual = valueByteLength(value, asHex)
    if (actual !== declared) {
      out.push({
        code: 'length',
        severity: actual > declared ? 'error' : 'warning',
        glyph: actual > declared ? '!' : '≠',
        message:
          actual > declared
            ? `Declared ${declared} bytes, value is ${actual} — the declared maximum is exceeded.`
            : `Declared ${declared} bytes, value is ${actual}.`,
        fix: actual < declared ? 'pad' : null,
        fixLabel: actual < declared ? 'Pad with zeros' : undefined,
      })
    }
  }

  return out
}

export function valueByteLength(value: string, asHex: boolean): number {
  return asHex ? Math.floor(normalizeHex(value).length / 2) : textToBytes(value).length
}

export function worstSeverity(
  diagnostics: readonly FieldDiagnostic[],
): DiagnosticSeverity | null {
  let worst: DiagnosticSeverity | null = null
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') return 'error'
    if (diagnostic.severity === 'warning') worst = 'warning'
    else if (worst === null) worst = 'info'
  }
  return worst
}

/** Applies a diagnostic's suggested fix. Returns the value unchanged when none. */
export function applyFix(
  value: string,
  fix: DiagnosticFix,
  asHex: boolean,
  declaredBytes: number | undefined,
): string {
  switch (fix) {
    case 'trim':
      return value.trim()
    case 'strip':
      return value.replace(/\D/g, '')
    case 'pad': {
      if (asHex) {
        const clean = normalizeHex(value)
        const padded = clean.length % 2 === 1 ? `${clean}0` : clean
        if (declaredBytes === undefined) return padded
        return padded.padEnd(declaredBytes * 2, '0')
      }
      if (declaredBytes === undefined) return value
      return value.padEnd(declaredBytes, '0')
    }
    default:
      return value
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Field 35 wire ⇄ display transparency (UX_SPEC 2.4)
   ──────────────────────────────────────────────────────────────────────────── */

export const TRACK2_FIELD_ID = 35

/** Track 2 carries `D` on the wire where the display convention shows `=`. */
export function track2Display(value: string): string {
  return value.replace(/D/g, '=')
}

export function track2Wire(value: string): string {
  return value.replace(/=/g, 'D')
}

/* ────────────────────────────────────────────────────────────────────────────
   Buffer file format (UX_SPEC 5.5 rule 4)
   Packager, fields, raw, raw format and the length-header block — and nothing
   else. No tool secrets, ever.
   ──────────────────────────────────────────────────────────────────────────── */

export const BUFFER_FILE_FORMAT = 'bufferx.buffer'
export const BUFFER_FILE_VERSION = 1
export const BUFFER_FILE_EXTENSION = 'bxb'

/**
 * Format strings accepted on read.
 *
 * The workspace wrote `bufferx.buffer` while Settings → Buffers wrote
 * `bufferx-buffer`, and both parsers validated strictly — so each surface
 * rejected files the other had just saved. Writing is now canonical and reading
 * accepts either, so no file already on disk becomes unopenable.
 */
export const ACCEPTED_BUFFER_FORMATS: readonly string[] = ['bufferx.buffer', 'bufferx-buffer']

export interface BufferFileField {
  id: number
  value: string
  hex: boolean
}

export interface BufferFile {
  format: typeof BUFFER_FILE_FORMAT
  version: typeof BUFFER_FILE_VERSION
  name: string
  packager: string
  raw: string
  rawFormat: 'hex' | 'text'
  header: { enabled: boolean; mode: 'none' | 'ascii' | 'binary'; size: number }
  autoDetect: boolean
  fields: BufferFileField[]
}

export function encodeBufferFile(file: BufferFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

export type BufferFileParse =
  | { ok: true; file: BufferFile }
  | { ok: false; message: string }

export function parseBufferFile(text: string): BufferFileParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' }
  }

  const record = asRecord(parsed)
  if (!record) return { ok: false, message: 'A buffer file must be a JSON object.' }
  if (!ACCEPTED_BUFFER_FORMATS.includes(asString(record.format) ?? '')) {
    return { ok: false, message: `Not a BufferX buffer file (missing "${BUFFER_FILE_FORMAT}").` }
  }
  const version = asNumber(record.version)
  if (version !== BUFFER_FILE_VERSION) {
    return { ok: false, message: `Unsupported buffer file version ${String(version)}.` }
  }

  const rawFormat = asString(record.rawFormat) === 'hex' ? 'hex' : 'text'
  const headerRecord = asRecord(record.header)
  const modeRaw = asString(headerRecord?.mode)
  const mode: 'none' | 'ascii' | 'binary' =
    modeRaw === 'ascii' || modeRaw === 'binary' ? modeRaw : 'none'

  const fields: BufferFileField[] = []
  for (const entry of asArray(record.fields)) {
    const item = asRecord(entry)
    if (!item) continue
    const id = asNumber(item.id)
    if (id === undefined) continue
    fields.push({ id, value: asString(item.value) ?? '', hex: asBoolean(item.hex) ?? false })
  }
  fields.sort((a, b) => a.id - b.id)

  return {
    ok: true,
    file: {
      format: BUFFER_FILE_FORMAT,
      version: BUFFER_FILE_VERSION,
      name: asString(record.name) ?? 'buffer',
      packager: asString(record.packager) ?? '',
      raw: asString(record.raw) ?? '',
      rawFormat,
      header: {
        enabled: asBoolean(headerRecord?.enabled) ?? false,
        mode,
        size: clampHeaderSize(asNumber(headerRecord?.size) ?? 4),
      },
      autoDetect: asBoolean(record.autoDetect) ?? true,
      fields,
    },
  }
}

/** A saved buffer that carries PIN or track material warrants a one-line note. */
export function sensitiveFieldNote(fieldIds: readonly number[]): string | null {
  const present = [35, 52, 45, 2].filter((id) => fieldIds.includes(id))
  if (present.length === 0) return null
  return `This file contains ${present.map((id) => `F${id}`).join(', ')} — PIN, PAN and track data. Store it accordingly.`
}

export function clampHeaderSize(size: number): number {
  if (!Number.isFinite(size)) return 4
  return Math.max(1, Math.min(8, Math.round(size)))
}

/* ────────────────────────────────────────────────────────────────────────────
   Templates (UX_SPEC 2.1 paste-first flow)
   ──────────────────────────────────────────────────────────────────────────── */

export interface BufferTemplate {
  id: string
  label: string
  description: string
  fields: Array<{ id: number; value: string }>
}

export const TEMPLATES: readonly BufferTemplate[] = [
  {
    id: 'purchase',
    label: '0200 Purchase',
    description: 'Authorisation request with amount, terminal and acceptor data.',
    fields: [
      { id: 0, value: '0200' },
      { id: 2, value: '6274120000000000' },
      { id: 3, value: '000000' },
      { id: 4, value: '000000012500' },
      { id: 7, value: '0101120000' },
      { id: 11, value: '000001' },
      { id: 12, value: '120000' },
      { id: 13, value: '0101' },
      { id: 37, value: '000000000001' },
      { id: 41, value: 'TERM0001' },
      { id: 42, value: 'MERCHANT000001 ' },
      { id: 49, value: '364' },
    ],
  },
  {
    id: 'network',
    label: '0800 Network management',
    description: 'Sign-on / echo request.',
    fields: [
      { id: 0, value: '0800' },
      { id: 7, value: '0101120000' },
      { id: 11, value: '000001' },
      { id: 70, value: '001' },
    ],
  },
  {
    id: 'reversal',
    label: '0420 Reversal',
    description: 'Reversal advice with the original response code.',
    fields: [
      { id: 0, value: '0420' },
      { id: 2, value: '6274120000000000' },
      { id: 3, value: '000000' },
      { id: 4, value: '000000012500' },
      { id: 7, value: '0101120000' },
      { id: 11, value: '000001' },
      { id: 12, value: '120000' },
      { id: 13, value: '0101' },
      { id: 37, value: '000000000001' },
      { id: 39, value: '00' },
      { id: 41, value: 'TERM0001' },
      { id: 49, value: '364' },
    ],
  },
  {
    id: 'empty',
    label: 'Empty message',
    description: 'No fields. Start from the add row.',
    fields: [],
  },
]

/** `Reset` rebuilds this set, filtered by the packager (UX_SPEC 2.2). */
export const DEFAULT_FIELD_SET: readonly number[] = [
  0, 2, 3, 4, 7, 11, 12, 13, 37, 39, 41, 42, 49,
]

/* ────────────────────────────────────────────────────────────────────────────
   Clipboard formats (UX_SPEC 2.3 copy menu, 5.2)
   ──────────────────────────────────────────────────────────────────────────── */

export function toCArray(bytes: Uint8Array, name = 'buffer'): string {
  const lines: string[] = []
  for (let index = 0; index < bytes.length; index += 12) {
    const slice = Array.from(bytes.slice(index, index + 12))
      .map((byte) => `0x${byte.toString(16).toUpperCase().padStart(2, '0')}`)
      .join(', ')
    lines.push(`    ${slice},`)
  }
  return `static const unsigned char ${name}[${bytes.length}] = {\n${lines.join('\n')}\n};\n`
}

export function toHexDump(bytes: Uint8Array, bytesPerRow = 16): string {
  const lines: string[] = []
  for (let base = 0; base < bytes.length; base += bytesPerRow) {
    const slice = bytes.slice(base, base + bytesPerRow)
    const hex = Array.from(slice)
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, '0'))
      .join(' ')
      .padEnd(bytesPerRow * 3 - 1, ' ')
    const ascii = Array.from(slice)
      .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.'))
      .join('')
    lines.push(`${base.toString(16).toUpperCase().padStart(8, '0')}  ${hex}  ${ascii}`)
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

export interface ExportField {
  id: number
  value: string
  hex: boolean
  desc?: string
  type?: string
  length?: number
}

export function fieldsToJson(fields: readonly ExportField[]): string {
  return `${JSON.stringify(
    fields.map((field) => ({
      bit: field.id,
      name: field.desc ?? `Field ${field.id}`,
      type: field.type ?? null,
      declaredLength: field.length ?? null,
      format: field.hex ? 'hex' : 'text',
      value: field.value,
    })),
    null,
    2,
  )}\n`
}

export function fieldsToTsv(fields: readonly ExportField[]): string {
  const rows = [['Bit', 'Name', 'Type', 'Len', 'Format', 'Value'].join('\t')]
  for (const field of fields) {
    rows.push(
      [
        String(field.id),
        field.desc ?? `Field ${field.id}`,
        field.type ?? '',
        field.length === undefined ? '' : String(field.length),
        field.hex ? 'hex' : 'text',
        field.value,
      ].join('\t'),
    )
  }
  return `${rows.join('\n')}\n`
}

/* ────────────────────────────────────────────────────────────────────────────
   Framing (UX_SPEC 2.3 `+ Add length`)
   ──────────────────────────────────────────────────────────────────────────── */

export interface LengthPrefixPreview {
  /** Hex of the bytes that would be prefixed. */
  prefixHex: string
  /** Text form when the mode is ASCII, otherwise null. */
  prefixText: string | null
  bodyBytes: number
  totalBytes: number
  /** Set when the existing head already matches — the operation is refused. */
  refusal: string | null
}

export function previewLengthPrefix(
  bytes: Uint8Array,
  mode: 'ascii' | 'binary',
  size: number,
): LengthPrefixPreview {
  const width = clampHeaderSize(size)
  const body = bytes.length

  let prefix: Uint8Array
  let prefixText: string | null = null
  if (mode === 'ascii') {
    const decimal = String(body).padStart(width, '0')
    if (decimal.length > width) {
      return {
        prefixHex: '',
        prefixText: null,
        bodyBytes: body,
        totalBytes: body,
        refusal: `${body} bytes does not fit in an ${width}-digit ASCII header.`,
      }
    }
    prefixText = decimal
    prefix = textToBytes(decimal)
  } else {
    if (body >= 2 ** (8 * width)) {
      return {
        prefixHex: '',
        prefixText: null,
        bodyBytes: body,
        totalBytes: body,
        refusal: `${body} bytes does not fit in a ${width}-byte binary header.`,
      }
    }
    prefix = new Uint8Array(width)
    let remaining = body
    for (let index = width - 1; index >= 0; index -= 1) {
      prefix[index] = remaining & 0xff
      remaining >>= 8
    }
  }

  let refusal: string | null = null
  if (bytes.length >= width) {
    let same = true
    for (let index = 0; index < width; index += 1) {
      if (bytes[index] !== prefix[index]) {
        same = false
        break
      }
    }
    if (same) refusal = 'The buffer already begins with this length header.'
  }

  return {
    prefixHex: bytesToHex(prefix),
    prefixText,
    bodyBytes: body,
    totalBytes: body + width,
    refusal,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Misc
   ──────────────────────────────────────────────────────────────────────────── */

/** Order-independent signature of the field model, for staleness detection. */
export function fieldsSignature(
  fields: ReadonlyArray<{ id: number; value: string; hex?: boolean }>,
): string {
  return fields
    .map((field) => `${field.id}:${field.hex ? 'h' : 't'}:${field.value}`)
    .join('')
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/* ── Decode-time header arguments ─────────────────────────────────────────── */

/**
 * Header arguments for a *decode*, given the operator's framing settings.
 *
 * `header.enabled` is the "Include on build" choice, but the codec also uses it
 * to gate header handling on the way in. That coupling made Auto-detect dead on
 * arrival: it ships enabled, yet with `enabled:false` / `mode:'none'` the codec
 * never probed. A buffer carrying an ASCII length prefix — `0247` followed by
 * exactly 247 bytes — therefore failed deep in the field walk, with an error
 * naming some unrelated field and no hint that framing was the cause.
 *
 * When Auto-detect is on, a decode asks the codec to look, with a usable mode
 * and size, regardless of the build setting. Detection is self-verifying (the
 * prefix has to equal the remaining length), so a buffer with no header is left
 * intact rather than losing its first four bytes. Build is unaffected.
 */
export function decodeHeaderArgs(
  header: { enabled: boolean; mode: 'none' | 'ascii' | 'binary'; size: number },
  autoDetect: boolean,
): { enabled: boolean; mode: 'none' | 'ascii' | 'binary'; size: number } {
  if (!autoDetect) {
    return { enabled: header.enabled, mode: header.mode, size: header.size }
  }
  return {
    enabled: true,
    mode: header.mode === 'none' ? 'ascii' : header.mode,
    size: header.size > 0 ? header.size : 4,
  }
}

/* ── Opening a saved buffer ───────────────────────────────────────────────── */

/**
 * Turns saved file text into tab initialisation.
 *
 * Shared by the workspace's `Open…` and the saved-buffer library so the two
 * cannot drift: a file opened from the library must produce exactly the tab a
 * file opened from the dialog does.
 *
 * Text that is not a BufferX document is not an error — an operator routinely
 * has a raw capture in a `.txt`. It opens as a raw buffer with the encoding
 * sniffed, and `parsed` reports which path was taken so the caller can say so.
 */
export function bufferFileToTabInit(
  name: string,
  text: string,
): { init: NewTabInit; parsed: boolean } {
  const result = parseBufferFile(text)

  if (!result.ok) {
    return {
      init: { name, raw: text.trim(), inputHex: sniffEncoding(text) === 'hex', dirty: false },
      parsed: false,
    }
  }

  const init: NewTabInit = {
    name: result.file.name || name,
    raw: result.file.raw,
    inputHex: result.file.rawFormat === 'hex',
    header: result.file.header,
    autoDetect: result.file.autoDetect,
    fields: result.file.fields.map((field) => ({
      id: field.id,
      value: field.value,
      hex: field.hex,
    })),
    decoded: result.file.fields.length > 0,
    dirty: false,
  }
  // Never write `packager: undefined` -- createTab spreads the seed over its
  // defaults, so an undefined key would erase the default packager.
  if (result.file.packager) init.packager = result.file.packager

  return { init, parsed: true }
}
