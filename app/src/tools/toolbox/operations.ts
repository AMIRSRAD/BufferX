/**
 * The Toolbox operation catalogue (UX_SPEC 3.7).
 *
 * The old Qt panel was one flat 21-item combobox wired to three inputs that
 * meant different things depending on the selection: a `Text input / Hex input`
 * select that was inert for 17 of the 21 operations but stayed enabled, a
 * `Second hex value (XOR)` field that was silently repurposed as the hash
 * input-mode carrier, and a single unlabelled spinbox that meant `Digits`,
 * `Key bytes`, or `KCV bytes` with only a hover tooltip as a clue.
 *
 * This module is the fix. Each operation declares exactly the inputs it uses,
 * each with its own label, and the mapping back onto the engine's generic
 * `{ input, secondary, parameter }` triple happens in one place (`buildArgs`)
 * rather than being spread across the view.
 *
 * The `id` values are the operation names the engine accepts, verbatim.
 */

export type ToolboxGroupId =
  | 'bcd'
  | 'bitwise'
  | 'base64'
  | 'hashes'
  | 'card'
  | 'keys'
  | 'charset'

export interface ToolboxGroup {
  id: ToolboxGroupId
  /** Rendered uppercase in the operation list. */
  label: string
}

/** Group order is the list order in UX_SPEC 3.7. */
export const TOOLBOX_GROUPS: readonly ToolboxGroup[] = [
  { id: 'bcd', label: 'BCD' },
  { id: 'bitwise', label: 'Bitwise' },
  { id: 'base64', label: 'Base64' },
  { id: 'hashes', label: 'Hashes' },
  { id: 'card', label: 'Card numbers' },
  { id: 'keys', label: 'Key management' },
  { id: 'charset', label: 'Character sets' },
]

/**
 * How an input is captured and validated.
 *
 * - `hex`      — `HexInput`, normalised and byte-counted.
 * - `secretHex`— `SecretInput`. Key material: masked, never persisted, never copied.
 * - `digits`   — decimal digits only (BCD payloads, PANs).
 * - `ascii`    — text restricted to US-ASCII by the engine's EBCDIC table.
 * - `text`     — arbitrary UTF-8.
 * - `base64`   — Base64 text, alphabet- and length-checked before the call.
 * - `dynamic`  — the hashes: the `Input mode` control picks `text` or `hex`.
 */
export type InputKind = 'hex' | 'secretHex' | 'digits' | 'ascii' | 'text' | 'base64' | 'dynamic'

export interface InputSpec {
  kind: InputKind
  label: string
  hint?: string
  placeholder?: string
  /** Renders a `Textarea` rather than a single-line control. */
  multiline?: boolean
}

export interface ParameterSpec {
  /** The label the old app never showed: `Digits`, `Key bytes`, `KCV bytes`. */
  label: string
  hint?: string
  min: number
  max: number
  default: number
  unit?: string
  /** When set, stepping snaps to these values and anything else is rejected. */
  allowed?: readonly number[]
  /**
   * Present when the parameter belongs to the operation's family but not to
   * this member of it. UX_SPEC 3.6 sets the precedent: the control stays
   * visible and disabled with the reason, because vanishing controls hide
   * state.
   */
  inertNote?: string
}

export type ResultKind = 'hex' | 'text' | 'digits' | 'verdict' | 'secret'

export interface OperationDef {
  /** Engine operation name, verbatim. */
  id: string
  label: string
  group: ToolboxGroupId
  /** One line under the title, explaining what actually happens. */
  summary: string
  /** Extra search terms, so `hash` finds MD5 and `check digit` finds Luhn. */
  keywords: readonly string[]
  input?: InputSpec
  /** Only XOR Hex has one. */
  secondary?: InputSpec
  parameter?: ParameterSpec
  /** Renders the `Text input` / `Hex input` segmented control. Hashes only. */
  inputMode?: boolean
  result: { kind: ResultKind; label: string }
  /**
   * The operation's input is key material. History for these stores the result
   * and a masked key hint only — never the key (UX_SPEC 3.7 / 5.5).
   */
  secretInput?: boolean
}

export type HashInputMode = 'text' | 'hex'

/** Everything one operation's form holds. Memory only — never persisted. */
export interface OperationState {
  input: string
  secondary: string
  hashMode: HashInputMode
  parameter: number
}

export const TOOLBOX_OPERATIONS: readonly OperationDef[] = [
  // ── BCD ────────────────────────────────────────────────────────────────
  {
    id: 'bcdencodeleft',
    label: 'BCD Encode Left',
    group: 'bcd',
    summary:
      'Packs decimal digits two per byte. An odd digit count is padded with a leading zero nibble.',
    keywords: ['pack', 'nibble', 'left', 'pad'],
    input: { kind: 'digits', label: 'Input (digits)', placeholder: '123456' },
    parameter: {
      label: 'Digits',
      min: 0,
      max: 256,
      default: 0,
      unit: 'digits',
      inertNote: 'Decode only — encoding takes its digit count from the input.',
    },
    result: { kind: 'hex', label: 'Packed BCD' },
  },
  {
    id: 'bcdencoderight',
    label: 'BCD Encode Right',
    group: 'bcd',
    summary:
      'Packs decimal digits two per byte. An odd digit count is padded with a trailing F nibble.',
    keywords: ['pack', 'nibble', 'right', 'pad'],
    input: { kind: 'digits', label: 'Input (digits)', placeholder: '123456' },
    parameter: {
      label: 'Digits',
      min: 0,
      max: 256,
      default: 0,
      unit: 'digits',
      inertNote: 'Decode only — encoding takes its digit count from the input.',
    },
    result: { kind: 'hex', label: 'Packed BCD' },
  },
  {
    id: 'bcddecodeleft',
    label: 'BCD Decode Left',
    group: 'bcd',
    summary:
      'Unpacks BCD bytes to digits. With an odd digit count the leading pad nibble is dropped.',
    keywords: ['unpack', 'nibble', 'left'],
    input: { kind: 'hex', label: 'Input (hex)', placeholder: '0123 45' },
    parameter: {
      label: 'Digits',
      hint: '0 keeps every digit and trims one trailing F.',
      min: 0,
      max: 512,
      default: 0,
      unit: 'digits',
    },
    result: { kind: 'digits', label: 'Digits' },
  },
  {
    id: 'bcddecoderight',
    label: 'BCD Decode Right',
    group: 'bcd',
    summary:
      'Unpacks BCD bytes to digits, keeping the leading nibble and truncating from the right.',
    keywords: ['unpack', 'nibble', 'right'],
    input: { kind: 'hex', label: 'Input (hex)', placeholder: '1234 5F' },
    parameter: {
      label: 'Digits',
      hint: '0 keeps every digit and trims one trailing F.',
      min: 0,
      max: 512,
      default: 0,
      unit: 'digits',
    },
    result: { kind: 'digits', label: 'Digits' },
  },

  // ── Bitwise ────────────────────────────────────────────────────────────
  {
    id: 'xorhex',
    label: 'XOR Hex',
    group: 'bitwise',
    summary: 'Byte-wise exclusive OR of two equal-length hex values.',
    keywords: ['exclusive or', 'combine', 'key component', 'kek'],
    input: { kind: 'hex', label: 'Input (hex)', placeholder: '0011 2233' },
    secondary: { kind: 'hex', label: 'Second value (hex)', placeholder: 'AABB CCDD' },
    result: { kind: 'hex', label: 'XOR' },
  },

  // ── Base64 ─────────────────────────────────────────────────────────────
  {
    id: 'base64encodetext',
    label: 'Base64 Encode Text',
    group: 'base64',
    summary: 'Encodes the UTF-8 bytes of the text as Base64.',
    keywords: ['b64', 'encode'],
    input: { kind: 'text', label: 'Input', placeholder: 'Plain text', multiline: true },
    result: { kind: 'text', label: 'Base64' },
  },
  {
    id: 'base64encodehex',
    label: 'Base64 Encode Hex',
    group: 'base64',
    summary: 'Encodes the bytes described by the hex as Base64.',
    keywords: ['b64', 'encode', 'binary'],
    input: { kind: 'hex', label: 'Input (hex)', placeholder: '0011 2233' },
    result: { kind: 'text', label: 'Base64' },
  },
  {
    id: 'base64decodetext',
    label: 'Base64 Decode Text',
    group: 'base64',
    summary: 'Decodes Base64 and shows the bytes as text.',
    keywords: ['b64', 'decode'],
    input: { kind: 'base64', label: 'Input (Base64)', placeholder: 'SGVsbG8=', multiline: true },
    result: { kind: 'text', label: 'Decoded text' },
  },
  {
    id: 'base64decodehex',
    label: 'Base64 Decode Hex',
    group: 'base64',
    summary: 'Decodes Base64 and shows the bytes as hex.',
    keywords: ['b64', 'decode', 'binary'],
    input: { kind: 'base64', label: 'Input (Base64)', placeholder: 'ABEiMw==', multiline: true },
    result: { kind: 'hex', label: 'Decoded bytes' },
  },

  // ── Hashes ─────────────────────────────────────────────────────────────
  {
    id: 'md5',
    label: 'MD5',
    group: 'hashes',
    summary: 'MD5 digest — 16 bytes. Not collision resistant; use it for legacy interop only.',
    keywords: ['hash', 'digest', 'message digest'],
    input: { kind: 'dynamic', label: 'Input', multiline: true },
    inputMode: true,
    result: { kind: 'hex', label: 'Digest' },
  },
  {
    id: 'sha1',
    label: 'SHA-1',
    group: 'hashes',
    summary: 'SHA-1 digest — 20 bytes.',
    keywords: ['hash', 'digest', 'sha'],
    input: { kind: 'dynamic', label: 'Input', multiline: true },
    inputMode: true,
    result: { kind: 'hex', label: 'Digest' },
  },
  {
    id: 'sha256',
    label: 'SHA-256',
    group: 'hashes',
    summary: 'SHA-256 digest — 32 bytes.',
    keywords: ['hash', 'digest', 'sha2'],
    input: { kind: 'dynamic', label: 'Input', multiline: true },
    inputMode: true,
    result: { kind: 'hex', label: 'Digest' },
  },
  {
    id: 'sha512',
    label: 'SHA-512',
    group: 'hashes',
    summary: 'SHA-512 digest — 64 bytes.',
    keywords: ['hash', 'digest', 'sha2'],
    input: { kind: 'dynamic', label: 'Input', multiline: true },
    inputMode: true,
    result: { kind: 'hex', label: 'Digest' },
  },

  // ── Card numbers ───────────────────────────────────────────────────────
  {
    id: 'luhncheck',
    label: 'Luhn Check',
    group: 'card',
    summary: 'Verifies the trailing check digit of a card number (ISO/IEC 7812 mod 10).',
    keywords: ['pan', 'mod 10', 'check digit', 'card'],
    input: { kind: 'digits', label: 'Input (PAN)', placeholder: '4111111111111111' },
    result: { kind: 'verdict', label: 'Verdict' },
  },
  {
    id: 'luhngenerate',
    label: 'Luhn Generate',
    group: 'card',
    summary: 'Appends the Luhn check digit to a card number body.',
    keywords: ['pan', 'mod 10', 'check digit', 'card'],
    input: { kind: 'digits', label: 'Input (PAN)', placeholder: '411111111111111' },
    result: { kind: 'digits', label: 'PAN with check digit' },
  },

  // ── Key management ─────────────────────────────────────────────────────
  {
    id: 'adjustoddparity',
    label: 'Adjust Odd Parity',
    group: 'keys',
    summary: 'Forces odd parity on every key byte by rewriting the low bit.',
    keywords: ['des', 'parity', 'fix', 'key'],
    input: { kind: 'secretHex', label: 'Key (hex)' },
    secretInput: true,
    result: { kind: 'secret', label: 'Adjusted key' },
  },
  {
    id: 'checkoddparity',
    label: 'Check Odd Parity',
    group: 'keys',
    summary: 'Reports whether every key byte already carries odd parity.',
    keywords: ['des', 'parity', 'verify', 'key'],
    input: { kind: 'secretHex', label: 'Key (hex)' },
    secretInput: true,
    result: { kind: 'verdict', label: 'Verdict' },
  },
  {
    id: 'randomkey',
    label: 'Random Key',
    group: 'keys',
    summary: 'Generates a cryptographically random key with odd parity applied.',
    keywords: ['generate', 'des', 'aes', 'key'],
    parameter: {
      label: 'Key bytes',
      hint: '8, 16, 24, or 32 bytes.',
      min: 8,
      max: 32,
      default: 16,
      unit: 'bytes',
      allowed: [8, 16, 24, 32],
    },
    secretInput: true,
    result: { kind: 'secret', label: 'Key' },
  },
  {
    id: 'kcv',
    label: 'KCV',
    group: 'keys',
    summary:
      'Key check value: encrypt a zero block under the key and take the leading bytes.',
    keywords: ['check value', 'kcv', 'verify', 'key'],
    input: { kind: 'secretHex', label: 'Key (hex)' },
    parameter: {
      label: 'KCV bytes',
      hint: 'Leading bytes of the encrypted zero block.',
      min: 1,
      max: 16,
      default: 3,
      unit: 'bytes',
    },
    secretInput: true,
    result: { kind: 'hex', label: 'KCV' },
  },

  // ── Character sets ─────────────────────────────────────────────────────
  {
    id: 'asciitoebcdic',
    label: 'ASCII to EBCDIC',
    group: 'charset',
    summary: 'Converts US-ASCII text to EBCDIC code page 037 bytes.',
    keywords: ['cp037', 'mainframe', 'codepage', 'convert'],
    input: { kind: 'ascii', label: 'Input', placeholder: 'HELLO', multiline: true },
    result: { kind: 'hex', label: 'EBCDIC bytes' },
  },
  {
    id: 'ebcdictoascii',
    label: 'EBCDIC to ASCII',
    group: 'charset',
    summary: 'Converts EBCDIC code page 037 bytes back to text.',
    keywords: ['cp037', 'mainframe', 'codepage', 'convert'],
    input: { kind: 'hex', label: 'Input (hex)', placeholder: 'C8C5D3D3D6' },
    result: { kind: 'text', label: 'Text' },
  },
]

const OPERATIONS_BY_ID: ReadonlyMap<string, OperationDef> = new Map(
  TOOLBOX_OPERATIONS.map((operation) => [operation.id, operation]),
)

export function getOperation(id: string): OperationDef | undefined {
  return OPERATIONS_BY_ID.get(id)
}

/** The first operation in list order — the default selection. */
export const DEFAULT_OPERATION_ID: string = TOOLBOX_OPERATIONS[0]?.id ?? 'bcdencodeleft'

export function initialOperationState(operation: OperationDef): OperationState {
  return {
    input: '',
    secondary: '',
    hashMode: 'text',
    parameter: operation.parameter?.default ?? 0,
  }
}

/** The input kind actually in force, resolving `dynamic` against the mode. */
export function effectiveInputKind(
  operation: OperationDef,
  state: OperationState,
): InputKind | undefined {
  const spec = operation.input
  if (!spec) return undefined
  if (spec.kind !== 'dynamic') return spec.kind
  return state.hashMode === 'hex' ? 'hex' : 'text'
}

/** The label the input carries right now — hashes change with the mode. */
export function effectiveInputLabel(operation: OperationDef, state: OperationState): string {
  const spec = operation.input
  if (!spec) return 'Input'
  if (spec.kind !== 'dynamic') return spec.label
  return state.hashMode === 'hex' ? 'Input (hex)' : 'Input'
}

/** True when the parameter exists but does nothing for this operation. */
export function parameterIsInert(operation: OperationDef): boolean {
  return operation.parameter?.inertNote !== undefined
}

// ── Validation ───────────────────────────────────────────────────────────

export type IssueTarget = 'input' | 'secondary' | 'parameter'

export interface Issue {
  target: IssueTarget
  message: string
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function hexBytes(value: string): number {
  return Math.floor(value.length / 2)
}

function oddNibble(value: string): boolean {
  return value.length % 2 === 1
}

function isDigits(value: string): boolean {
  return /^[0-9]+$/.test(value)
}

/**
 * Everything that can be known without the engine.
 *
 * `strict` adds the "this is empty" issues. Live rendering runs non-strict so a
 * pristine form is not already red; pressing Run switches it on.
 */
export function validateOperation(
  operation: OperationDef,
  state: OperationState,
  strict: boolean,
): Issue[] {
  const issues: Issue[] = []
  const kind = effectiveInputKind(operation, state)
  const input = state.input

  if (kind !== undefined) {
    if (input.length === 0) {
      if (strict) issues.push({ target: 'input', message: 'Enter a value to run this operation.' })
    } else {
      switch (kind) {
        case 'hex':
        case 'secretHex':
          if (oddNibble(input)) {
            issues.push({
              target: 'input',
              message: 'Hex needs whole bytes — the value has an odd number of nibbles.',
            })
          }
          break
        case 'digits':
          if (!isDigits(input)) {
            issues.push({ target: 'input', message: 'Digits 0–9 only.' })
          }
          break
        case 'base64': {
          const compact = input.replace(/\s+/g, '')
          if (!BASE64_RE.test(compact)) {
            issues.push({
              target: 'input',
              message: 'Not Base64 — allowed characters are A–Z, a–z, 0–9, +, / and trailing =.',
            })
          } else if (compact.length % 4 !== 0) {
            issues.push({
              target: 'input',
              message: `Base64 length must be a multiple of 4 (this is ${compact.length}).`,
            })
          }
          break
        }
        case 'ascii': {
          const bad = [...input].find((character) => (character.codePointAt(0) ?? 0) > 0x7f)
          if (bad !== undefined) {
            issues.push({
              target: 'input',
              message: `Code page 037 covers US-ASCII only — “${bad}” is outside it.`,
            })
          }
          break
        }
        case 'text':
        case 'dynamic':
          break
      }
    }
  }

  if (operation.secondary) {
    if (state.secondary.length === 0) {
      if (strict) {
        issues.push({ target: 'secondary', message: 'Enter a second value to XOR against.' })
      }
    } else if (oddNibble(state.secondary)) {
      issues.push({
        target: 'secondary',
        message: 'Hex needs whole bytes — the value has an odd number of nibbles.',
      })
    } else if (input.length > 0 && !oddNibble(input) && hexBytes(state.secondary) !== hexBytes(input)) {
      issues.push({
        target: 'secondary',
        message: `Both values must be the same length — ${hexBytes(input)} bytes vs ${hexBytes(
          state.secondary,
        )} bytes.`,
      })
    }
  }

  const parameter = operation.parameter
  if (parameter && !parameterIsInert(operation)) {
    const value = state.parameter
    if (!Number.isInteger(value)) {
      issues.push({ target: 'parameter', message: `${parameter.label} must be a whole number.` })
    } else if (parameter.allowed && !parameter.allowed.includes(value)) {
      issues.push({
        target: 'parameter',
        message: `${parameter.label} must be ${parameter.allowed.slice(0, -1).join(', ')} or ${
          parameter.allowed[parameter.allowed.length - 1]
        }.`,
      })
    } else if (value < parameter.min || value > parameter.max) {
      issues.push({
        target: 'parameter',
        message: `${parameter.label} must be between ${parameter.min} and ${parameter.max}.`,
      })
    }
  }

  // Operation-specific rules that the generic checks above cannot express.
  switch (operation.id) {
    case 'bcddecodeleft':
    case 'bcddecoderight': {
      const available = input.length - (input.length % 2)
      if (available > 0 && state.parameter > available) {
        issues.push({
          target: 'parameter',
          message: `Only ${available} digits are present in ${available / 2} bytes.`,
        })
      }
      break
    }
    case 'luhncheck':
      if (input.length > 0 && isDigits(input) && input.length < 2) {
        issues.push({ target: 'input', message: 'A card number needs at least two digits.' })
      }
      break
    case 'kcv': {
      const bytes = hexBytes(input)
      if (input.length > 0 && !oddNibble(input) && ![8, 16, 24, 32].includes(bytes)) {
        issues.push({
          target: 'input',
          message: `A KCV key is 8, 16, 24, or 32 bytes — this key is ${bytes} bytes.`,
        })
      } else if (input.length > 0 && !oddNibble(input)) {
        const block = bytes === 32 ? 16 : 8
        if (state.parameter > block) {
          issues.push({
            target: 'parameter',
            message: `A ${bytes}-byte key encrypts a ${block}-byte block, so the KCV is at most ${block} bytes.`,
          })
        }
      }
      break
    }
    case 'adjustoddparity':
    case 'checkoddparity':
      if (input.length > 0 && hexBytes(input) === 0) {
        issues.push({ target: 'input', message: 'The key is empty.' })
      }
      break
    default:
      break
  }

  return issues
}

export function issueFor(issues: readonly Issue[], target: IssueTarget): string | undefined {
  return issues.find((issue) => issue.target === target)?.message
}

// ── Engine argument construction ─────────────────────────────────────────

export interface ToolsRunArgs {
  operation: string
  input: string
  secondary: string
  parameter: number
}

/**
 * Collapses the per-operation form onto the engine's generic triple.
 *
 * This is the only place that knows the hashes carry their input mode in
 * `secondary` and that only three operations read `parameter`.
 */
export function buildArgs(operation: OperationDef, state: OperationState): ToolsRunArgs {
  const args: ToolsRunArgs = {
    operation: operation.id,
    input: operation.input ? state.input : '',
    secondary: '',
    parameter: 0,
  }

  if (operation.secondary) args.secondary = state.secondary
  if (operation.inputMode) args.secondary = state.hashMode === 'hex' ? 'hex' : 'text'
  if (operation.parameter && !parameterIsInert(operation)) args.parameter = state.parameter

  return args
}

// ── Provenance ───────────────────────────────────────────────────────────

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`
}

/**
 * The line under the result naming what ran and on what — the Toolbox's
 * equivalent of the IranSystem provenance line (UX_SPEC 3.6).
 */
export function describeRun(
  operation: OperationDef,
  state: OperationState,
  output: string,
): string {
  const parts: string[] = [operation.label]

  switch (operation.id) {
    case 'bcdencodeleft':
    case 'bcdencoderight':
      parts.push(`${plural(state.input.length, 'digit')} in`)
      parts.push(`${plural(hexBytes(output), 'byte')} out`)
      break
    case 'bcddecodeleft':
    case 'bcddecoderight':
      parts.push(`${plural(hexBytes(state.input), 'byte')} in`)
      parts.push(`${plural(output.length, 'digit')} out`)
      parts.push(state.parameter > 0 ? `truncated to ${state.parameter}` : 'full width')
      break
    case 'xorhex':
      parts.push(plural(hexBytes(output), 'byte'))
      break
    case 'base64encodetext':
    case 'base64encodehex':
      parts.push(`${plural(output.length, 'char')} out`)
      break
    case 'base64decodetext':
      parts.push(`${plural(output.length, 'char')} out`)
      break
    case 'base64decodehex':
      parts.push(`${plural(hexBytes(output), 'byte')} out`)
      break
    case 'md5':
    case 'sha1':
    case 'sha256':
    case 'sha512':
      parts.push(`${plural(hexBytes(output), 'byte')} digest`)
      parts.push(state.hashMode === 'hex' ? 'hex input' : 'text input')
      break
    case 'luhncheck':
      parts.push(plural(state.input.length, 'digit'))
      break
    case 'luhngenerate':
      parts.push(`check digit ${output.slice(-1)}`)
      break
    case 'adjustoddparity':
    case 'checkoddparity':
      parts.push(`key ${plural(hexBytes(state.input), 'byte')}`)
      break
    case 'randomkey':
      parts.push(plural(hexBytes(output), 'byte'))
      parts.push('odd parity applied')
      break
    case 'kcv':
      parts.push(plural(hexBytes(output), 'byte'))
      parts.push(`key ${plural(hexBytes(state.input), 'byte')}`)
      break
    case 'asciitoebcdic':
      parts.push(`${plural(state.input.length, 'char')} in`)
      parts.push(`${plural(hexBytes(output), 'byte')} out`)
      break
    case 'ebcdictoascii':
      parts.push(`${plural(hexBytes(state.input), 'byte')} in`)
      parts.push(`${plural(output.length, 'char')} out`)
      break
    default:
      break
  }

  return parts.join(' · ')
}

/** `VALID` / `INVALID` operations get a verdict chip rather than a hex line. */
export function isPositiveVerdict(output: string): boolean {
  return output.trim().toUpperCase() === 'VALID'
}
