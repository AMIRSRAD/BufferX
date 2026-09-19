/**
 * Typed access to the engine.
 *
 * `call` is the single choke point for every engine operation: it stamps the
 * protocol version, unwraps the envelope, and converts failures into thrown
 * `EngineCallError`s so panels can use ordinary try/catch.
 *
 * Secrets discipline: request arguments routinely contain PINs, PANs, and
 * cryptographic keys. Nothing in this module logs arguments, and failures never
 * echo the request back in the error. Do not add debug logging here.
 */

import {
  EngineCallError,
  PROTOCOL_VERSION,
  type EngineRequest,
  type EngineResponse,
  type HostCapabilities,
} from './protocol'
import { getTransport } from './transport'

export async function call<TResult = unknown, TArgs extends object = object>(
  op: string,
  args: TArgs = {} as TArgs,
): Promise<TResult> {
  const transport = getTransport()
  const request: EngineRequest = { v: PROTOCOL_VERSION, op, args: args as Record<string, unknown> }

  let response: EngineResponse
  try {
    response = await transport.invoke(request)
  } catch (cause) {
    // A transport-level throw means the engine could not be reached at all.
    throw new EngineCallError(op, {
      code: 'INTERNAL',
      message: cause instanceof Error ? cause.message : 'The engine could not be reached.',
    })
  }

  if (!response || typeof response !== 'object' || !('ok' in response)) {
    throw new EngineCallError(op, {
      code: 'INTERNAL',
      message: 'The engine returned a malformed response.',
    })
  }

  if (!response.ok) {
    throw new EngineCallError(op, response.error)
  }

  return response.data as TResult
}

/**
 * Variant that returns a result object instead of throwing. Useful for panels
 * that render an inline error next to the control rather than interrupting.
 */
export async function tryCall<TResult = unknown, TArgs extends object = object>(
  op: string,
  args: TArgs = {} as TArgs,
): Promise<{ ok: true; data: TResult } | { ok: false; error: EngineCallError }> {
  try {
    return { ok: true, data: await call<TResult, TArgs>(op, args) }
  } catch (error) {
    if (error instanceof EngineCallError) {
      return { ok: false, error }
    }
    throw error
  }
}

export function hostCapabilities(): HostCapabilities {
  return getTransport().capabilities()
}

export function engineKind(): 'wasm' | 'native' {
  return getTransport().kind
}
