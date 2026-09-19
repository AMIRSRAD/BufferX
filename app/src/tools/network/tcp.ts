/**
 * The host bridge for the TCP tester.
 *
 * Raw sockets are not part of the engine contract -- they cannot exist in
 * WebAssembly -- so this is a Tauri command rather than an `engine.*` op. The
 * import is dynamic so the web bundle never pulls in `@tauri-apps/api`, and the
 * capability check is the caller's job (`hostCapabilities().tcp`).
 *
 * The payload is a live ISO message and may contain a PIN block. It is passed
 * straight through and never logged here.
 */

import type { Framing } from './wire'

/** The complete bytes on the wire, framing header included, both directions. */
export interface TcpExchange {
  requestHex: string
  responseHex: string
  elapsedMs: number
  bytesSent: number
  bytesReceived: number
}

export interface TcpSendArgs {
  host: string
  port: number
  /** The **body** only. The host prepends the framing header itself. */
  payloadHex: string
  framing: Framing
  /** Ignored by the host for `none` framing; pass `null` there. */
  headerSize: number | null
  timeoutMs: number
}

function isExchange(value: unknown): value is TcpExchange {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.requestHex === 'string' &&
    typeof candidate.responseHex === 'string' &&
    typeof candidate.elapsedMs === 'number' &&
    typeof candidate.bytesSent === 'number' &&
    typeof candidate.bytesReceived === 'number'
  )
}

/**
 * Normalises whatever a rejected `invoke` throws into a message.
 *
 * A Tauri command that returns `Err(String)` rejects with that bare string, not
 * an `Error`, so a naive `error.message` would render `undefined` on the one
 * path the operator most needs to read.
 */
export function transportMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return 'The request failed and the host gave no reason.'
}

/** Sends one framed request and reads one framed response back. */
export async function tcpSend(args: TcpSendArgs): Promise<TcpExchange> {
  const { invoke } = await import('@tauri-apps/api/core')
  const result: unknown = await invoke('tcp_send', {
    host: args.host,
    port: args.port,
    payloadHex: args.payloadHex,
    framing: args.framing,
    headerSize: args.headerSize,
    timeoutMs: args.timeoutMs,
  })
  if (!isExchange(result)) {
    throw new Error('The host returned a malformed TCP result.')
  }
  return result
}
