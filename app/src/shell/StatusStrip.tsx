/**
 * The status strip (UX_SPEC 1.1, and the footer row of the audit in Appendix A).
 *
 * ```
 * Fields · Ln 1 : Col 12 : Pos 12 : Sel 0   │  148 bytes · 13 fields · SLM · hdr ASCII/4
 * ```
 *
 * The old app tracked `Ln/Col/Pos/Sel` and a scope but displayed neither the
 * scope nor a byte count, and used the same 1-line label as its only error
 * channel. Here the strip is purely a readout — errors live in the Problems
 * drawer — and it states its scope explicitly so `Ctrl+Enter` is never
 * ambiguous.
 *
 * `role="status"` with `aria-live="off"`: the numbers change on every keystroke
 * and announcing them would flood a screen reader. Results announce through the
 * dedicated live regions in `AppShell` instead (UX_SPEC 6.3).
 */

import { useSyncExternalStore } from 'react'
import { useBuffers } from '@/store/buffers'
import { cn } from '@/lib/cn'

export interface CaretReadout {
  line: number
  col: number
  /** Absolute character offset of the caret. */
  pos: number
  /** Length of the current selection, in the scope's own unit. */
  sel: number
}

export interface ShellStatus {
  /** Which region the readout describes: `Fields`, `Raw`, `Bytes`, a tool name. */
  scope: string
  caret: CaretReadout
  /** Extra clause appended to the right-hand summary, e.g. `spans F35, F37`. */
  detail?: string
}

const IDLE: ShellStatus = { scope: 'Ready', caret: { line: 1, col: 1, pos: 0, sel: 0 } }

const listeners = new Set<() => void>()
let status: ShellStatus = IDLE

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ShellStatus {
  return status
}

/**
 * Publishes a caret/scope readout. The raw pane, the field table and the byte
 * view call this as focus and selection move; nothing else writes here.
 */
export function setShellStatus(next: Partial<ShellStatus>): void {
  const merged: ShellStatus = {
    ...status,
    ...next,
    caret: next.caret ? { ...status.caret, ...next.caret } : status.caret,
  }
  const same =
    merged.scope === status.scope &&
    merged.detail === status.detail &&
    merged.caret.line === status.caret.line &&
    merged.caret.col === status.caret.col &&
    merged.caret.pos === status.caret.pos &&
    merged.caret.sel === status.caret.sel
  if (same) return
  status = merged
  for (const listener of listeners) listener()
}

/** Resets to the idle readout. Called when the workspace loses its document. */
export function resetShellStatus(): void {
  if (status === IDLE) return
  status = IDLE
  for (const listener of listeners) listener()
}

export function useShellStatus(): ShellStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Byte length of the raw pane contents.
 *
 * Hex mode counts nibble pairs (a trailing half-byte is not a byte yet); text
 * mode measures UTF-8, because the wire carries bytes and `String.length`
 * counts UTF-16 code units.
 */
export function rawByteLength(raw: string, inputHex: boolean): number {
  if (inputHex) {
    const nibbles = raw.replace(/[^0-9a-fA-F]/g, '').length
    return Math.floor(nibbles / 2)
  }
  if (typeof TextEncoder === 'undefined') return raw.length
  return new TextEncoder().encode(raw).length
}

/** `hdr ASCII/4`, `hdr auto`, or `no hdr` (UX_SPEC 2.3). */
export function framingSummary(
  header: { enabled: boolean; mode: 'none' | 'ascii' | 'binary'; size: number },
  autoDetect: boolean,
): string {
  if (header.mode === 'none' || (!header.enabled && !autoDetect)) return 'no hdr'
  const label = header.mode === 'ascii' ? 'ASCII' : 'Binary'
  return `${autoDetect ? 'auto · ' : ''}hdr ${label}/${header.size}`
}

const SEPARATOR = <span className="text-text-disabled">·</span>

export function StatusStrip({ className }: { className?: string }) {
  const { scope, caret, detail } = useShellStatus()
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const active = tabs.find((tab) => tab.id === activeId)

  const bytes = active ? rawByteLength(active.raw, active.inputHex) : 0
  const fieldCount = active?.fields.length ?? 0

  return (
    <footer
      role="status"
      aria-live="off"
      aria-label="Buffer status"
      className={cn(
        'flex h-6 shrink-0 items-center gap-2 border-t border-border bg-surface-1',
        'px-2 text-2xs text-text-secondary',
        className,
      )}
    >
      <span className="shrink-0 font-medium text-text">{scope}</span>
      {SEPARATOR}
      <span className="shrink-0 font-mono text-mono-xs tabular-nums" data-tnum>
        Ln {caret.line} : Col {caret.col} : Pos {caret.pos} : Sel {caret.sel}
      </span>
      {detail ? (
        <>
          {SEPARATOR}
          <span className="truncate">{detail}</span>
        </>
      ) : null}

      <span className="ml-auto flex min-w-0 shrink items-center gap-2">
        <span className="shrink-0 font-mono text-mono-xs tabular-nums" data-tnum>
          {bytes} bytes
        </span>
        {SEPARATOR}
        <span className="shrink-0 font-mono text-mono-xs tabular-nums" data-tnum>
          {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
        </span>
        {SEPARATOR}
        <span className="shrink-0 truncate font-mono text-mono-xs">{active?.packager ?? '—'}</span>
        {SEPARATOR}
        <span className="shrink-0 truncate">
          {active ? framingSummary(active.header, active.autoDetect) : 'no hdr'}
        </span>
      </span>
    </footer>
  )
}
