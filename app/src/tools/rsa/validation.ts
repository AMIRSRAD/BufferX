/**
 * Pre-flight checks for the RSA tool.
 *
 * UX_SPEC 5.1 tier 1: anything knowable on this side is stated next to the
 * control that broke it, before an engine call is spent. Each function returns
 * either `null` (the input is usable) or the full sentence to render.
 */

import type { KeyState } from './model'
import { base64ByteLength, maxPlaintextBytes, PADDING_LABEL, type RsaPadding } from './pem'

/** The private key box, checked for a given purpose (`Sign`, `Decrypt`). */
export function privateKeyProblem(key: KeyState, purpose: string): string | null {
  if (key.pem.trim() === '') return `${purpose} needs a PEM private key. Load or paste one above.`
  if (!key.info) return 'The private key box holds no PEM block.'
  switch (key.info.kind) {
    case 'private':
      return null
    case 'encrypted-private':
      return 'The private key is encrypted. Decrypt it first — the engine cannot take a passphrase.'
    case 'public':
      return `${purpose} needs the private key; the box holds a public key.`
    case 'certificate':
      return `${purpose} needs the private key; the box holds an X.509 certificate.`
    case 'unknown':
      return `The private key box holds an unrecognised PEM block ("${key.info.label}").`
  }
}

/** The public key box, checked for a given purpose (`Verify`, `Encrypt`). */
export function publicKeyProblem(key: KeyState, purpose: string): string | null {
  if (key.pem.trim() === '') return `${purpose} needs a PEM public key. Load or paste one above.`
  if (!key.info) return 'The public key box holds no PEM block.'
  switch (key.info.kind) {
    case 'public':
    case 'certificate':
      return null
    case 'private':
    case 'encrypted-private':
      return `${purpose} needs the public key; the box holds a private key.`
    case 'unknown':
      return `The public key box holds an unrecognised PEM block ("${key.info.label}").`
  }
}

/** Base64 that is required to be present, well-formed, and the right size. */
export function base64Problem(
  value: string,
  label: string,
  expectedBytes: number | null,
  expectedBits: number | null,
): string | null {
  if (value.trim() === '') return `Enter the ${label.toLowerCase()}.`
  const length = base64ByteLength(value)
  if (length === null) return `The ${label.toLowerCase()} is not valid Base64.`
  if (length === 0) return `The ${label.toLowerCase()} decodes to zero bytes.`
  if (expectedBytes !== null && length !== expectedBytes) {
    return `The ${label.toLowerCase()} is ${length} bytes; a ${expectedBits}-bit key produces ${expectedBytes}.`
  }
  return null
}

/** Plaintext size against the capacity of the chosen padding and key. */
export function plaintextProblem(
  byteLength: number,
  padding: RsaPadding,
  modulusBytes: number | null,
  modulusBits: number | null,
): string | null {
  if (byteLength === 0) return 'Enter the plaintext to encrypt.'
  const capacity = maxPlaintextBytes(modulusBytes, padding)
  if (capacity === null) return null
  if (byteLength > capacity) {
    return `Plaintext is ${byteLength} bytes; ${PADDING_LABEL[padding]} with a ${modulusBits}-bit key carries at most ${capacity}.`
  }
  return null
}

/** True when every entry of a problem map is `null`. */
export function isClear(problems: Record<string, string | null>): boolean {
  return Object.values(problems).every((problem) => problem === null)
}
