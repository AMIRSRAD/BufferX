/**
 * Rail state dots (UX_SPEC 1.2).
 *
 * > Rail items carry a state dot when the tool holds live state: teal = has a
 * > result, amber = has a stale result, red = has an error, grey ring = holds a
 * > secret in memory. The secret ring is important — it is how an operator
 * > knows a key is still loaded.
 *
 * A tool reports its own condition here; the shell only reads. This is a
 * deliberately tiny external store rather than another Zustand slice because it
 * must be safe to call from a panel's render-adjacent effects without pulling
 * the shell into the tool's dependency graph.
 *
 * **This module stores booleans, never values.** `secret: true` records *that*
 * a key is resident, not what it is — the same discipline as the command bar's
 * lock indicator, which lists tools and never material (UX_SPEC 5.5 rule 5).
 */

import { useSyncExternalStore } from 'react'

export interface ToolStatus {
  /** Has a current result. Teal dot. */
  result: boolean
  /** Has a result whose inputs have since changed. Amber dot. */
  stale: boolean
  /** Last run failed. Red dot. */
  error: boolean
  /** Holds a key, PIN, PAN or PEM in memory. Grey ring. */
  secret: boolean
}

export const EMPTY_TOOL_STATUS: ToolStatus = {
  result: false,
  stale: false,
  error: false,
  secret: false,
}

type StatusMap = Readonly<Record<string, ToolStatus>>

const listeners = new Set<() => void>()
let snapshot: StatusMap = {}

function publish(next: StatusMap): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): StatusMap {
  return snapshot
}

/**
 * Merges a partial status for one tool. Call it whenever a result lands, goes
 * stale, fails, or a secret input becomes empty or non-empty.
 */
export function reportToolStatus(id: string, patch: Partial<ToolStatus>): void {
  const current = snapshot[id] ?? EMPTY_TOOL_STATUS
  const next: ToolStatus = { ...current, ...patch }
  if (
    next.result === current.result &&
    next.stale === current.stale &&
    next.error === current.error &&
    next.secret === current.secret
  ) {
    return
  }
  publish({ ...snapshot, [id]: next })
}

/** Drops a tool's status entirely. Called by the dock when a tool closes. */
export function clearToolStatus(id: string): void {
  if (!(id in snapshot)) return
  const next: Record<string, ToolStatus> = { ...snapshot }
  delete next[id]
  publish(next)
}

/** Drops every status. Bound to `Clear all secrets` (`Ctrl+Alt+L`). */
export function clearAllToolStatus(): void {
  if (Object.keys(snapshot).length === 0) return
  publish({})
}

/** Every reported status, keyed by tool id. */
export function useToolStatuses(): StatusMap {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Ids of tools that currently hold a secret, in registry order of arrival. */
export function secretHolders(statuses: StatusMap): string[] {
  return Object.keys(statuses).filter((id) => statuses[id]?.secret === true)
}
