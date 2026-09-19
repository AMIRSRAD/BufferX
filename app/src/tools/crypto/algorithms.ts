/**
 * Symmetric algorithm metadata and pre-flight validation for the Crypto tool.
 *
 * UX_SPEC 3.3 fix 1: "the algorithm select shows the required key size per
 * option and the key field validates length **before** Run". Everything the
 * engine would reject on a length rule is knowable here, so the operator never
 * has to press Encrypt to discover that an algorithm switch left a stale key.
 *
 * The numbers mirror `core/src/Crypto.cpp::resolveCipher` exactly:
 *   DES     8-byte key,  8-byte IV in CBC
 *   3DES   24-byte key, but a 16-byte 2-key value is expanded K1|K2|K1
 *   AES-128 16-byte key, 16-byte IV in CBC
 *   AES-256 32-byte key, 16-byte IV in CBC
 *
 * Nothing in this module ever holds or logs key material; it is handed a string
 * and returns a sentence.
 */

/** Engine `crypto.transform` algorithm values, verbatim. */
export const CRYPTO_ALGORITHMS = [
  'DES-ECB',
  'DES-CBC',
  '3DES-ECB',
  '3DES-CBC',
  'AES-128-ECB',
  'AES-128-CBC',
  'AES-256-ECB',
  'AES-256-CBC',
] as const

export type CryptoAlgorithm = (typeof CRYPTO_ALGORITHMS)[number]

export type CryptoOperation = 'encrypt' | 'decrypt'

export interface AlgorithmSpec {
  id: CryptoAlgorithm
  /** `DES`, `3DES`, `AES-128`, `AES-256` — how an error sentence names it. */
  family: string
  /** Every legal key length in bytes, ascending. */
  keyBytes: readonly number[]
  /** IV length in bytes. `0` means the mode has no IV (ECB). */
  ivBytes: number
  /** Cipher block size in bytes. Drives the padding-off length rule. */
  blockBytes: number
  /** Chaining mode, for the provenance line. */
  mode: 'ECB' | 'CBC'
}

const SPECS: Record<CryptoAlgorithm, AlgorithmSpec> = {
  'DES-ECB': { id: 'DES-ECB', family: 'DES', keyBytes: [8], ivBytes: 0, blockBytes: 8, mode: 'ECB' },
  'DES-CBC': { id: 'DES-CBC', family: 'DES', keyBytes: [8], ivBytes: 8, blockBytes: 8, mode: 'CBC' },
  '3DES-ECB': { id: '3DES-ECB', family: '3DES', keyBytes: [16, 24], ivBytes: 0, blockBytes: 8, mode: 'ECB' },
  '3DES-CBC': { id: '3DES-CBC', family: '3DES', keyBytes: [16, 24], ivBytes: 8, blockBytes: 8, mode: 'CBC' },
  'AES-128-ECB': { id: 'AES-128-ECB', family: 'AES-128', keyBytes: [16], ivBytes: 0, blockBytes: 16, mode: 'ECB' },
  'AES-128-CBC': { id: 'AES-128-CBC', family: 'AES-128', keyBytes: [16], ivBytes: 16, blockBytes: 16, mode: 'CBC' },
  'AES-256-ECB': { id: 'AES-256-ECB', family: 'AES-256', keyBytes: [32], ivBytes: 0, blockBytes: 16, mode: 'ECB' },
  'AES-256-CBC': { id: 'AES-256-CBC', family: 'AES-256', keyBytes: [32], ivBytes: 16, blockBytes: 16, mode: 'CBC' },
}

export const DEFAULT_ALGORITHM: CryptoAlgorithm = 'DES-ECB'

export function specFor(algorithm: CryptoAlgorithm): AlgorithmSpec {
  return SPECS[algorithm]
}

export function isCryptoAlgorithm(value: string): value is CryptoAlgorithm {
  return Object.prototype.hasOwnProperty.call(SPECS, value)
}

/** `16 or 24` — the byte list as a human reads it. */
export function keyBytesPhrase(spec: AlgorithmSpec): string {
  const list = spec.keyBytes
  if (list.length === 1) return String(list[0])
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`
}

/** Dropdown hint: `32-byte key · 16-byte IV`. §7 rule 14 — the constraint. */
export function requirementHint(spec: AlgorithmSpec): string {
  const key = `${keyBytesPhrase(spec)}-byte key`
  return spec.ivBytes === 0 ? `${key} · no IV` : `${key} · ${spec.ivBytes}-byte IV required`
}

/* ── Hex helpers ─────────────────────────────────────────────────────────── */

const HEX_CHAR = /^[0-9a-fA-F]$/

export interface HexScan {
  /** Whitespace-stripped, uppercased. */
  clean: string
  /** 0-based index of the first non-hex character in the original string. */
  badIndex: number
  badChar: string
  byteLength: number
  oddNibble: boolean
}

export function scanHex(raw: string): HexScan {
  let clean = ''
  let badIndex = -1
  let badChar = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i)
    if (/\s/.test(ch)) continue
    if (HEX_CHAR.test(ch)) {
      clean += ch.toUpperCase()
      continue
    }
    if (badIndex === -1) {
      badIndex = i
      badChar = ch
    }
  }
  return {
    clean,
    badIndex,
    badChar,
    byteLength: Math.floor(clean.length / 2),
    oddNibble: clean.length % 2 === 1,
  }
}

/** Byte length of `text` once the engine encodes it as UTF-8. */
export function textByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/* ── Validation ──────────────────────────────────────────────────────────── */

/**
 * A blocking reason, or `null` when the control is fine.
 *
 * `soft` marks a reason that is a warning rather than a hard stop — it is shown
 * inline but does not disable the action.
 */
export interface Problem {
  message: string
  soft?: boolean
}

/** UX_SPEC 3.3: `Key is 8 bytes, AES-256 needs 32.` */
export function validateKey(keyHex: string, spec: AlgorithmSpec): Problem | null {
  if (keyHex.trim() === '') {
    return { message: `Key is empty. ${spec.family} needs ${keyBytesPhrase(spec)} bytes of hex.` }
  }
  const scan = scanHex(keyHex)
  if (scan.badIndex !== -1) {
    return {
      message: `Key is not valid hex: unexpected '${scan.badChar}' at position ${scan.badIndex + 1}.`,
    }
  }
  if (scan.oddNibble) {
    return {
      message: `Key has an odd nibble count. ${spec.family} needs ${keyBytesPhrase(spec)} whole bytes.`,
    }
  }
  if (!spec.keyBytes.includes(scan.byteLength)) {
    return {
      message: `Key is ${scan.byteLength} bytes, ${spec.family} needs ${keyBytesPhrase(spec)}.`,
    }
  }
  return null
}

export function validateIv(ivHex: string, spec: AlgorithmSpec): Problem | null {
  // ECB never sends the IV, so a leftover value is not an error — the field is
  // disabled and carries the note instead (UX_SPEC 3.3 fix 2).
  if (spec.ivBytes === 0) return null

  const scan = scanHex(ivHex)
  if (scan.clean === '') {
    return { message: `IV is required. ${spec.id} needs ${spec.ivBytes} bytes.` }
  }
  if (scan.oddNibble) {
    return { message: `IV has an odd nibble count. ${spec.id} needs ${spec.ivBytes} whole bytes.` }
  }
  if (scan.byteLength !== spec.ivBytes) {
    return { message: `IV is ${scan.byteLength} bytes, ${spec.id} needs ${spec.ivBytes}.` }
  }
  return null
}

export interface PayloadState {
  /** What goes on the wire: cleaned hex, or the text verbatim. */
  payload: string
  byteLength: number
  problem: Problem | null
}

/**
 * Validates the input body for the chosen representation and operation.
 *
 * The block-alignment rule is only enforced for **Hex In**. In Text In the
 * engine decides how the characters become bytes, so a client-side count could
 * block a run the engine would have accepted.
 */
export function validatePayload(
  raw: string,
  inputHex: boolean,
  spec: AlgorithmSpec,
  operation: CryptoOperation,
  usePadding: boolean,
): PayloadState {
  if (!inputHex) {
    const byteLength = textByteLength(raw)
    if (raw === '') {
      return { payload: '', byteLength: 0, problem: { message: 'Input is empty. Paste or type a payload.' } }
    }
    return { payload: raw, byteLength, problem: null }
  }

  const scan = scanHex(raw)
  if (scan.clean === '') {
    return { payload: '', byteLength: 0, problem: { message: 'Input is empty. Paste hex bytes.' } }
  }
  if (scan.badIndex !== -1) {
    return {
      payload: scan.clean,
      byteLength: scan.byteLength,
      problem: {
        message: `Input is not valid hex: unexpected '${scan.badChar}' at position ${scan.badIndex + 1}.`,
      },
    }
  }
  if (scan.oddNibble) {
    return {
      payload: scan.clean,
      byteLength: scan.byteLength,
      problem: { message: `Input has an odd nibble count — hex needs whole bytes.` },
    }
  }

  const aligned = scan.byteLength % spec.blockBytes === 0
  if (!aligned && operation === 'decrypt') {
    return {
      payload: scan.clean,
      byteLength: scan.byteLength,
      problem: {
        message: `Ciphertext is ${scan.byteLength} bytes; ${spec.id} needs a multiple of ${spec.blockBytes}.`,
      },
    }
  }
  if (!aligned && operation === 'encrypt' && !usePadding) {
    return {
      payload: scan.clean,
      byteLength: scan.byteLength,
      problem: {
        message: `Input is ${scan.byteLength} bytes; ${spec.id} needs a multiple of ${spec.blockBytes} with padding off.`,
      },
    }
  }

  return { payload: scan.clean, byteLength: scan.byteLength, problem: null }
}
