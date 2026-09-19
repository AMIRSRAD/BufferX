/**
 * The BufferX engine wire protocol.
 *
 * Every capability of the C++ core is reached through one envelope, so the same
 * calls work whether the engine is a WASM module running in this tab or a
 * native library behind Tauri IPC. Adding an operation never changes the
 * transport layer.
 */

export const PROTOCOL_VERSION = 1 as const

export interface EngineRequest<A = Record<string, unknown>> {
  v: typeof PROTOCOL_VERSION
  op: string
  args: A
}

export type EngineResponse<D = unknown> =
  | { ok: true; data: D }
  | { ok: false; error: EngineError }

export interface EngineError {
  code: EngineErrorCode
  message: string
  /** Optional machine-readable context, e.g. which field failed. */
  detail?: Record<string, unknown>
}

/**
 * Stable, machine-readable failure reasons. The UI branches on `code`;
 * `message` is for humans and may be reworded freely.
 */
export const ENGINE_ERROR_CODES = [
  'BAD_HEX',
  'BAD_LENGTH',
  'BAD_ARGUMENT',
  'UNKNOWN_PACKAGER',
  'UNKNOWN_OP',
  'DECODE_FAILED',
  'ENCODE_FAILED',
  'CRYPTO_FAILED',
  'PARSE_FAILED',
  'UNSUPPORTED',
  'HOST_ONLY',
  'TIMEOUT',
  'INTERNAL',
] as const

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number]

/** Thrown by the typed client when a call fails, so callers can use try/catch. */
export class EngineCallError extends Error {
  readonly code: EngineErrorCode
  readonly detail: Record<string, unknown> | undefined
  readonly op: string

  constructor(op: string, error: EngineError) {
    super(error.message)
    this.name = 'EngineCallError'
    this.op = op
    this.code = error.code
    this.detail = error.detail
  }
}

/**
 * A transport moves one JSON envelope to the engine and back. Implementations
 * must not interpret the payload -- routing lives in the C++ ABI so both
 * transports stay in lockstep.
 */
export interface EngineTransport {
  readonly kind: 'wasm' | 'native'
  invoke(request: EngineRequest): Promise<EngineResponse>
  /** Operations this transport can serve beyond the core set. */
  capabilities(): HostCapabilities
}

/**
 * What the current host can do. The browser cannot open raw TCP sockets or read
 * arbitrary files, so panels that need those degrade instead of failing at the
 * moment the user presses a button.
 */
export interface HostCapabilities {
  /** Raw TCP for the ISO host tester. */
  tcp: boolean
  /** Native open/save dialogs and filesystem access. */
  files: boolean
  /** Reading PEM key files from disk. */
  keyFiles: boolean
  /** Running as a packaged desktop app rather than a web page. */
  desktop: boolean
}

export const WEB_CAPABILITIES: HostCapabilities = {
  tcp: false,
  files: false,
  keyFiles: false,
  desktop: false,
}

export const DESKTOP_CAPABILITIES: HostCapabilities = {
  tcp: true,
  files: true,
  keyFiles: true,
  desktop: true,
}

/** Human-readable reason a capability is missing, shown in degraded panels. */
export function capabilityHint(capability: keyof HostCapabilities): string {
  switch (capability) {
    case 'tcp':
      return 'Browsers cannot open raw TCP sockets. Open BufferX on the desktop to reach a host directly.'
    case 'files':
    case 'keyFiles':
      return 'Reading files from disk needs the desktop app. You can still paste content here.'
    case 'desktop':
      return 'This feature is only available in the desktop app.'
  }
}
