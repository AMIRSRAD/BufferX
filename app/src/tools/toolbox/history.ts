/**
 * Per-operation run history for the Toolbox (UX_SPEC 3.7: "`Recent` history of
 * the last 20 runs per operation").
 *
 * Secrets discipline (UX_SPEC 5.5, and the reason this is not a zustand store
 * with persistence):
 *
 * - The history lives in module memory only. Nothing here touches
 *   `localStorage`, `sessionStorage`, the URL, or the console.
 * - For operations whose *input* is key material — `kcv`, `randomkey`,
 *   `adjustoddparity`, `checkoddparity` — the record holds the result and a
 *   masked hint (`key ••••… 16 bytes`) and no replayable state at all. The key
 *   itself is never copied into a record, so a re-run has to use whatever is in
 *   the form right now.
 * - `clearToolboxHistory()` exists so the idle wipe can drop it wholesale.
 *
 * It is module-scoped rather than component state so collapsing the tool in the
 * dock (which unmounts the panel) does not lose the last twenty runs.
 */

import type { OperationState } from './operations'

export interface ToolboxRun {
  id: string
  /** Operation id the run belongs to. */
  op: string
  /** Epoch milliseconds. */
  at: number
  /** The engine's output. */
  output: string
  /** True when `output` is key material and must render masked. */
  outputIsSecret: boolean
  /** Short human line: a truncated input, or a masked key hint. */
  hint: string
  /**
   * Form state to restore before re-running. `null` for key operations —
   * their inputs are never retained.
   */
  replay: OperationState | null
}

const MAX_PER_OPERATION = 20

const HISTORY = new Map<string, ToolboxRun[]>()

let counter = 0

function nextId(): string {
  counter += 1
  return `run-${counter}`
}

/** Masked stand-in for a key that is deliberately not stored. */
export function maskedKeyHint(keyHex: string): string {
  const bytes = Math.floor(keyHex.length / 2)
  if (bytes === 0) return 'no key'
  return `key ••••… ${bytes} bytes`
}

/** One-line preview of a non-secret input, elided in the middle. */
export function inputHint(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length === 0) return 'no input'
  if (compact.length <= 28) return compact
  return `${compact.slice(0, 16)}…${compact.slice(-8)}`
}

export function recentRuns(op: string): readonly ToolboxRun[] {
  return HISTORY.get(op) ?? []
}

export function recordRun(run: Omit<ToolboxRun, 'id'>): ToolboxRun {
  const stored: ToolboxRun = { ...run, id: nextId() }
  const existing = HISTORY.get(run.op) ?? []
  HISTORY.set(run.op, [stored, ...existing].slice(0, MAX_PER_OPERATION))
  return stored
}

export function clearRuns(op: string): void {
  HISTORY.delete(op)
}

/** Drops every recorded run. Used by the idle wipe and by tests. */
export function clearToolboxHistory(): void {
  HISTORY.clear()
}
