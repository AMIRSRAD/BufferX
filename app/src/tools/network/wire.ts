/**
 * Pure wire helpers for the Network tool (UX_SPEC 3.8).
 *
 * Everything here is synchronous and side-effect free so the panel can render a
 * live "what will actually go on the wire" preview on every keystroke without
 * an engine round trip. The framing rules mirror the host command in
 * `src-tauri/src/host.rs` exactly -- ASCII headers are zero-padded decimal, 1-8
 * bytes; binary headers are big-endian, 1-4 bytes -- so a request that this
 * module accepts is a request the host will accept, and the operator never
 * learns about a length overflow only after a failed send.
 *
 * Nothing in this file logs. A request body routinely carries F2 and F52.
 */

export type Framing = 'none' | 'ascii' | 'binary'

export const FRAMING_VALUES: readonly Framing[] = ['none', 'ascii', 'binary']

export const MIN_PORT = 1
export const MAX_PORT = 65535

/** Matches `MIN_TIMEOUT_MS` / `MAX_TIMEOUT_MS` in the Rust host command. */
export const MIN_TIMEOUT_MS = 100
export const MAX_TIMEOUT_MS = 120_000

export const MAX_ASCII_HEADER = 8
export const MAX_BINARY_HEADER = 4

/** Human label used in notes and error copy. */
export function framingLabel(framing: Framing): string {
  switch (framing) {
    case 'none':
      return 'None'
    case 'ascii':
      return 'ASCII'
    case 'binary':
      return 'Binary'
  }
}

/** Narrows an untyped segmented-control value. Falls back to the current one. */
export function asFraming(value: string, fallback: Framing): Framing {
  return (FRAMING_VALUES as readonly string[]).includes(value) ? (value as Framing) : fallback
}

/** Largest legal header width for a framing mode. `none` has no header. */
export function headerLimit(framing: Framing): number {
  switch (framing) {
    case 'none':
      return 0
    case 'ascii':
      return MAX_ASCII_HEADER
    case 'binary':
      return MAX_BINARY_HEADER
  }
}

/** The width a framing mode gets when the operator has not pinned one. */
export function defaultHeaderSize(framing: Framing): number {
  switch (framing) {
    case 'none':
      return 0
    case 'ascii':
      return 4
    case 'binary':
      return 2
  }
}

// ---------------------------------------------------------------------------
// Hex and text
// ---------------------------------------------------------------------------

const HEX_CHAR = /[0-9a-fA-F]/

/** Strips every non-hex character and upper-cases what is left. */
export function normalizeHex(raw: string): string {
  let out = ''
  for (const ch of raw) if (HEX_CHAR.test(ch)) out += ch
  return out.toUpperCase()
}

/** True when `raw` contains a character that is neither hex nor whitespace. */
export function hasNonHex(raw: string): boolean {
  for (const ch of raw) {
    if (HEX_CHAR.test(ch)) continue
    if (/\s/.test(ch)) continue
    return true
  }
  return false
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0').toUpperCase()
  return out
}

/** Decodes normalized, even-length hex. Odd trailing nibbles are ignored. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = normalizeHex(hex)
  const length = clean.length >> 1
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: false })

/** UTF-8 encodes text to hex. ASCII -- the usual ISO payload -- is a subset. */
export function textToHex(text: string): string {
  return bytesToHex(encoder.encode(text))
}

/** UTF-8 decodes hex to text. Undecodable bytes become U+FFFD, never an error. */
export function hexToText(hex: string): string {
  return decoder.decode(hexToBytes(hex))
}

/** `30313438 30323130` -- four-byte groups, as UX_SPEC 3.8 renders wire hex. */
export function groupWireHex(hex: string, bytesPerGroup = 4): string {
  const size = bytesPerGroup * 2
  const groups: string[] = []
  for (let i = 0; i < hex.length; i += size) groups.push(hex.slice(i, i + size))
  return groups.join(' ')
}

export function byteLength(hex: string): number {
  return Math.floor(normalizeHex(hex).length / 2)
}

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

export type FrameResult =
  | { ok: true; wireHex: string; headerHex: string; bodyHex: string }
  | { ok: false; message: string }

/**
 * Prepends the length header to a body, exactly as the host does.
 *
 * The overflow cases are reported rather than silently truncated: a 4-digit
 * ASCII header cannot carry a 12,000-byte body, and a 1-byte binary header
 * cannot carry 300.
 */
export function frameRequest(framing: Framing, headerSize: number, bodyHex: string): FrameResult {
  const body = normalizeHex(bodyHex)
  if (body.length % 2 !== 0) {
    return { ok: false, message: 'Hex needs an even number of digits.' }
  }
  const bytes = body.length / 2

  if (framing === 'none') {
    return { ok: true, wireHex: body, headerHex: '', bodyHex: body }
  }

  const limit = headerLimit(framing)
  if (!Number.isInteger(headerSize) || headerSize < 1 || headerSize > limit) {
    return {
      ok: false,
      message: `Header size must be 1-${limit} bytes for ${framingLabel(framing)} framing.`,
    }
  }

  if (framing === 'ascii') {
    const digits = String(bytes)
    if (digits.length > headerSize) {
      return {
        ok: false,
        message: `${bytes} bytes needs ${digits.length} digits, but the ASCII header is ${headerSize}.`,
      }
    }
    const headerHex = textToHex(digits.padStart(headerSize, '0'))
    return { ok: true, wireHex: headerHex + body, headerHex, bodyHex: body }
  }

  const ceiling = 2 ** (8 * headerSize)
  if (bytes >= ceiling) {
    return {
      ok: false,
      message: `${bytes} bytes does not fit a ${headerSize}-byte binary header (max ${ceiling - 1}).`,
    }
  }
  let headerHex = ''
  for (let shift = headerSize - 1; shift >= 0; shift -= 1) {
    headerHex += (Math.floor(bytes / 2 ** (8 * shift)) & 0xff).toString(16).padStart(2, '0').toUpperCase()
  }
  return { ok: true, wireHex: headerHex + body, headerHex, bodyHex: body }
}

/**
 * Splits a wire response into its header and body.
 *
 * The host returns the complete bytes it saw, header included (see the
 * `TcpExchange` doc comment), so the body view has to slice it back off.
 */
export function splitWire(
  framing: Framing,
  headerSize: number,
  wireHex: string,
): { headerHex: string; bodyHex: string } {
  const wire = normalizeHex(wireHex)
  if (framing === 'none' || headerSize <= 0) return { headerHex: '', bodyHex: wire }
  const cut = Math.min(headerSize * 2, wire.length)
  return { headerHex: wire.slice(0, cut), bodyHex: wire.slice(cut) }
}

// ---------------------------------------------------------------------------
// Client-side validation
// ---------------------------------------------------------------------------

/**
 * Hostnames, IPv4 literals and bracketed IPv6 literals. Deliberately permissive
 * -- the point is to catch a pasted `http://10.0.0.1:5000/` or a stray space
 * before a socket is opened, not to re-implement the resolver.
 */
const HOST_RE = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)$/

export function validateHost(host: string): string | undefined {
  const value = host.trim()
  if (value === '') return 'Enter a host name or IP address.'
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return 'Enter a bare host, without a URL scheme.'
  if (/\s/.test(value)) return 'A host cannot contain spaces.'
  if (value.includes('/')) return 'Enter a bare host, without a path.'
  if (!HOST_RE.test(value)) return 'That is not a valid host name or IP address.'
  return undefined
}

/** Parses a digits-only field. Returns `null` when it is empty or malformed. */
export function parseCount(raw: string): number | null {
  const value = raw.trim()
  if (value === '' || !/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function validatePort(raw: string): string | undefined {
  const port = parseCount(raw)
  if (port === null) return 'Enter a port number.'
  if (port < MIN_PORT || port > MAX_PORT) return `Port must be ${MIN_PORT}-${MAX_PORT}.`
  return undefined
}

export function validateTimeout(raw: string): string | undefined {
  const timeout = parseCount(raw)
  if (timeout === null) return 'Enter a timeout in milliseconds.'
  if (timeout < MIN_TIMEOUT_MS || timeout > MAX_TIMEOUT_MS) {
    return `Timeout must be ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} ms.`
  }
  return undefined
}

export function validateHeaderSize(raw: string, framing: Framing): string | undefined {
  if (framing === 'none') return undefined
  const size = parseCount(raw)
  const limit = headerLimit(framing)
  if (size === null) return 'Enter a header size in bytes.'
  if (size < 1 || size > limit) return `${framingLabel(framing)} headers are 1-${limit} bytes.`
  return undefined
}

/** Keeps a numeric text field to digits, so a stepper never holds `1e3`. */
export function digitsOnly(raw: string, maxLength: number): string {
  let out = ''
  for (const ch of raw) if (ch >= '0' && ch <= '9') out += ch
  return out.slice(0, maxLength)
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export function formatBytes(count: number): string {
  return count === 1 ? '1 byte' : `${count} bytes`
}

export function formatElapsed(ms: number): string {
  return `${ms} ms`
}

export function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Classifies a host failure so the error strip can name it (UX_SPEC 3.8:
 * "Connection refused", "Timed out after 5000 ms", "Short read: ...").
 *
 * The host command returns prose; this maps that prose onto a stable title and
 * keeps the original message as the body, so nothing is lost in translation.
 */
export function classifyTransportError(message: string, timeoutMs: number): string {
  const text = message.toLowerCase()
  if (text.includes('refused')) return 'Connection refused'
  if (text.includes('unreachable') || text.includes('no route')) return 'Host unreachable'
  if (text.includes('did not resolve') || text.includes('not known') || text.includes('nodename')) {
    return 'Host did not resolve'
  }
  if (text.includes('budget expired') || text.includes('timed out') || text.includes('timeout')) {
    return `Timed out after ${timeoutMs} ms`
  }
  if (text.includes('ended before') || text.includes('no data')) return 'Short read'
  if (text.includes('invalid ascii length header')) return 'Malformed response header'
  if (text.includes('connect failed')) return 'Connection failed'
  if (text.includes('write failed')) return 'Write failed'
  return 'Request failed'
}
