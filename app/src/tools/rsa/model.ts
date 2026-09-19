/**
 * Shared types and small pure helpers for the RSA tool.
 *
 * The key material lives in `RsaPanel`'s React state and is threaded through
 * these plain objects. Nothing here reaches storage: `KeySlot.pem` is a secret
 * by the rules in UX_SPEC 5.5 (the private key certainly, the public key by
 * uniformity of the key-handling model), so it is never given a persistence
 * binding and never written into the Problems log.
 */

import { EngineCallError } from '@/engine/protocol'
import type { KeyInfo } from './pem'
import { inspectPem } from './pem'

/** One PEM box: its text, when it arrived, and where it came from. */
export interface KeySlot {
  pem: string
  /** `Date.now()` of the last non-empty assignment. Drives `loaded 11:40`. */
  loadedAt: number | null
  /** `key.pem`, `pasted`, `dropped` — provenance only, never a full path. */
  source: string | null
}

export const EMPTY_KEY_SLOT: KeySlot = { pem: '', loadedAt: null, source: null }

/** A slot plus its parsed shape. Recomputed by the panel whenever the PEM changes. */
export interface KeyState extends KeySlot {
  info: KeyInfo | null
}

export function readKeyState(slot: KeySlot): KeyState {
  return { ...slot, info: slot.pem.trim() === '' ? null : inspectPem(slot.pem) }
}

/* ── Errors ──────────────────────────────────────────────────────────────── */

/** A failed engine call, shaped for the panel's error strip (UX_SPEC 3.0). */
export interface ToolError {
  /** Short, distinct headline — `Key failed to parse`, not `Error`. */
  title: string
  /** The engine's own message, in full. Never elided. */
  message: string
  op: string
  code: string
  detail?: Record<string, unknown>
}

const PEM_HINT = /pem|private key|public key|asn\.?1|der|key material/i

/**
 * Turns an engine failure into a titled error.
 *
 * UX_SPEC 3.4 requires that `Key failed to parse (not a valid PEM private key)`
 * and `Signature did not match` never collapse into one status line, so a
 * key-shaped failure is retitled here rather than inheriting the operation's
 * generic headline.
 */
export function toToolError(error: EngineCallError, fallbackTitle: string): ToolError {
  const keyProblem =
    error.code === 'PARSE_FAILED' || error.code === 'BAD_ARGUMENT'
      ? PEM_HINT.test(error.message)
      : false

  return {
    title: keyProblem ? 'Key failed to parse' : fallbackTitle,
    message: error.message,
    op: error.op,
    code: error.code,
    detail: error.detail,
  }
}

/** Wraps a non-engine throw so the panel never shows a bare stack trace. */
export function unexpectedError(cause: unknown, op: string, title: string): ToolError {
  if (cause instanceof EngineCallError) return toToolError(cause, title)
  return {
    title,
    message: cause instanceof Error ? cause.message : 'The operation failed for an unknown reason.',
    op,
    code: 'INTERNAL',
  }
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

/** `11:40:12`, 24-hour, locale separators. Used in every provenance line. */
export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false })
}

/** `344-byte payload`, with a thousands separator for large captures. */
export function byteCount(bytes: number, noun: string): string {
  return `${bytes.toLocaleString()}-byte ${noun}`
}

/** Joins provenance fragments, dropping the ones that are not known yet. */
export function provenance(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' · ')
}
