/**
 * PEM and Base64 inspection for the RSA tool.
 *
 * Everything here is pure and synchronous so the panel can validate before it
 * spends an engine call (UX_SPEC 3.4, 5.1 tier 1: the rule that is knowable on
 * this side is enforced next to the control that broke it).
 *
 * Secrets discipline: a private key PEM passes through these functions but is
 * never stored here, never logged, and never echoed into a returned message.
 * The returned `KeyInfo` carries a *shape* — kind, label, modulus size — which
 * is exactly what the one-line key summary is allowed to show (UX_SPEC 5.5).
 */

/** What a PEM block turned out to be. Drives the "wrong kind of key" errors. */
export type PemKind =
  | 'private'
  | 'encrypted-private'
  | 'public'
  | 'certificate'
  | 'unknown'

export interface PemBlock {
  /** The label between the dashes, e.g. `RSA PRIVATE KEY`. */
  label: string
  /** Base64 body with all whitespace removed. */
  body: string
}

export interface KeyInfo {
  kind: PemKind
  label: string
  /** Modulus size in bits, when it could be recovered from the DER. */
  modulusBits: number | null
  /** `ceil(modulusBits / 8)` — the ciphertext and signature size. */
  modulusBytes: number | null
  /** How many PEM blocks the text contained. More than one is a mistake worth naming. */
  blockCount: number
}

const PEM_BLOCK = /-----BEGIN ([A-Za-z0-9 ]+)-----([A-Za-z0-9+/=\s]*?)-----END \1-----/g

/** Every PEM block in `text`, in document order. */
export function findPemBlocks(text: string): PemBlock[] {
  const blocks: PemBlock[] = []
  PEM_BLOCK.lastIndex = 0
  let match = PEM_BLOCK.exec(text)
  while (match !== null) {
    const label = match[1] ?? ''
    const body = (match[2] ?? '').replace(/\s+/g, '')
    blocks.push({ label: label.trim(), body })
    match = PEM_BLOCK.exec(text)
  }
  return blocks
}

function kindOfLabel(label: string): PemKind {
  const upper = label.toUpperCase()
  if (upper.includes('ENCRYPTED') && upper.includes('PRIVATE')) return 'encrypted-private'
  if (upper.includes('PRIVATE KEY')) return 'private'
  if (upper.includes('PUBLIC KEY')) return 'public'
  if (upper.includes('CERTIFICATE')) return 'certificate'
  return 'unknown'
}

/**
 * Inspects pasted or loaded PEM text.
 *
 * Returns `null` for text that contains no PEM block at all, which the caller
 * reports as "no PEM block found" rather than as a parse failure.
 */
export function inspectPem(text: string): KeyInfo | null {
  const blocks = findPemBlocks(text)
  const first = blocks[0]
  if (!first) return null

  const der = decodeBase64(first.body)
  const bits = der ? modulusBits(der) : null

  return {
    kind: kindOfLabel(first.label),
    label: first.label,
    modulusBits: bits,
    modulusBytes: bits === null ? null : Math.ceil(bits / 8),
    blockCount: blocks.length,
  }
}

/** `RSA private key · 2048 bit`, or a shorter form when the size is unknown. */
export function describeKey(info: KeyInfo): string {
  const noun =
    info.kind === 'private' || info.kind === 'encrypted-private'
      ? 'RSA private key'
      : info.kind === 'public'
        ? 'RSA public key'
        : info.kind === 'certificate'
          ? 'X.509 certificate'
          : info.label || 'PEM block'
  const encrypted = info.kind === 'encrypted-private' ? ' · encrypted' : ''
  const size = info.modulusBits === null ? '' : ` · ${info.modulusBits} bit`
  return `${noun}${size}${encrypted}`
}

/* ── Base64 ──────────────────────────────────────────────────────────────── */

/**
 * Decodes Base64, tolerating whitespace, URL-safe alphabets, and missing
 * padding — operators paste signatures out of logs. Returns `null` when the
 * text is not Base64 at all, which is a validation result, not an error.
 */
export function decodeBase64(value: string): Uint8Array | null {
  const compact = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (compact.length === 0) return null
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null

  const unpadded = compact.replace(/=+$/, '')
  const remainder = unpadded.length % 4
  if (remainder === 1) return null
  const padded = remainder === 0 ? unpadded : unpadded + '='.repeat(4 - remainder)

  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    return null
  }
}

/** Byte length of a Base64 value, or `null` when it is not valid Base64. */
export function base64ByteLength(value: string): number | null {
  return decodeBase64(value)?.length ?? null
}

/** UTF-8 byte length — what the engine actually signs or encrypts. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/* ── Minimal DER walk ────────────────────────────────────────────────────── */

/** Guards against a pathological or hand-crafted DER blob. */
const MAX_DEPTH = 8
/** Anything outside this range is not an RSA modulus we should report. */
const MIN_BITS = 256
const MAX_BITS = 16384

interface Header {
  /** Offset of the first content byte. */
  contentStart: number
  /** Offset one past the last content byte. */
  contentEnd: number
}

function readHeader(bytes: Uint8Array, position: number, limit: number): Header | null {
  // Tag byte, then a definite-form length. Indefinite lengths are not DER.
  if (position + 1 >= limit) return null
  const lengthByte = bytes[position + 1]
  if (lengthByte === undefined) return null

  let contentStart: number
  let length: number

  if (lengthByte < 0x80) {
    length = lengthByte
    contentStart = position + 2
  } else {
    const count = lengthByte & 0x7f
    if (count === 0 || count > 4) return null
    if (position + 2 + count > limit) return null
    length = 0
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[position + 2 + index]
      if (byte === undefined) return null
      length = length * 256 + byte
    }
    contentStart = position + 2 + count
  }

  const contentEnd = contentStart + length
  if (contentEnd > limit) return null
  return { contentStart, contentEnd }
}

/** Bit length of a DER INTEGER's content, ignoring the sign padding byte. */
function integerBits(bytes: Uint8Array, start: number, end: number): number {
  let index = start
  while (index < end && bytes[index] === 0) index += 1
  const leading = bytes[index]
  if (index >= end || leading === undefined) return 0
  return (end - index - 1) * 8 + (32 - Math.clz32(leading))
}

function walk(bytes: Uint8Array, start: number, end: number, depth: number, found: number[]): void {
  if (depth > MAX_DEPTH) return
  let position = start
  while (position < end) {
    const tag = bytes[position]
    if (tag === undefined) return
    const header = readHeader(bytes, position, end)
    if (!header) return

    if (tag === 0x02) {
      found.push(integerBits(bytes, header.contentStart, header.contentEnd))
    } else if ((tag & 0x20) !== 0) {
      walk(bytes, header.contentStart, header.contentEnd, depth + 1, found)
    } else if (tag === 0x03 && header.contentEnd > header.contentStart) {
      // BIT STRING: skip the unused-bits count, then parse the wrapped DER
      // (this is how SubjectPublicKeyInfo carries the RSAPublicKey).
      if (bytes[header.contentStart] === 0) {
        walk(bytes, header.contentStart + 1, header.contentEnd, depth + 1, found)
      }
    } else if (tag === 0x04) {
      // OCTET STRING: PKCS#8 wraps the RSAPrivateKey here. A non-DER payload
      // simply fails to parse and contributes nothing.
      walk(bytes, header.contentStart, header.contentEnd, depth + 1, found)
    }

    position = header.contentEnd
  }
}

/**
 * Recovers the RSA modulus size from a DER key blob.
 *
 * The largest INTEGER in an RSA key is the modulus `n` (in a private key the
 * private exponent `d` is the same size), so a depth-first scan for the widest
 * INTEGER identifies the key size for PKCS#1, PKCS#8 and SubjectPublicKeyInfo
 * alike without a full ASN.1 implementation.
 */
export function modulusBits(der: Uint8Array): number | null {
  const found: number[] = []
  walk(der, 0, der.length, 0, found)
  let best = 0
  for (const bits of found) {
    if (bits >= MIN_BITS && bits <= MAX_BITS && bits > best) best = bits
  }
  return best === 0 ? null : best
}

/* ── Padding capacity ────────────────────────────────────────────────────── */

export type RsaPadding = 'oaepsha256' | 'oaepsha1' | 'pkcs1v15'

export const PADDING_LABEL: Record<RsaPadding, string> = {
  oaepsha256: 'OAEP SHA-256',
  oaepsha1: 'OAEP SHA-1',
  pkcs1v15: 'PKCS1 v1.5',
}

/** Overhead in bytes each padding scheme consumes out of the modulus. */
const PADDING_OVERHEAD: Record<RsaPadding, number> = {
  oaepsha256: 2 * 32 + 2,
  oaepsha1: 2 * 20 + 2,
  pkcs1v15: 11,
}

/**
 * Largest plaintext this padding can carry under a key of `modulusBytes`.
 * `null` when the key size is unknown, in which case the engine is the judge.
 */
export function maxPlaintextBytes(modulusBytes: number | null, padding: RsaPadding): number | null {
  if (modulusBytes === null) return null
  return Math.max(0, modulusBytes - PADDING_OVERHEAD[padding])
}

/* ── Digests ─────────────────────────────────────────────────────────────── */

export type RsaDigest = 'sha256' | 'sha1' | 'sha512'

export const DIGEST_LABEL: Record<RsaDigest, string> = {
  sha256: 'SHA-256',
  sha1: 'SHA-1',
  sha512: 'SHA-512',
}
