import { create } from 'zustand'
import { STORAGE_KEYS, persistence } from './persist'

/** Workspace identities and layout preferences are persisted. Panel data stays in memory.
 * `promoted` is the active tool workspace; null selects the buffer.
 */

/** Rail destinations that open as dock tools (UX_SPEC 1.2). */
export const TOOL_IDS = [
  'packager',
  'json',
  'tlv',
  'iransystem',
  'mac',
  'pin',
  'crypto',
  'rsa',
  'toolbox',
  'network',
  'history',
] as const

export type ToolId = (typeof TOOL_IDS)[number]

export interface ToolsState {
  /** Open tool ids, in workspace tab order. */
  open: string[]
  /** The tool that currently has dock focus, or `null` when the dock is empty. */
  focused: string | null
  /** The tool promoted to a full workspace tab via `Ctrl+Shift+\`, if any. */
  promoted: string | null
  splitTools: string[]
  dockWidth: number | null
  setSplit(id: string, split: boolean): void
  setDockWidth(width: number): void

  /** Opens (if needed) and focuses. This is what a rail entry does. */
  openTool(id: string): void
  /** Closes, moving focus on and un-promoting if it was promoted. */
  closeTool(id: string): void
  /** Rail activation selects a workspace without discarding its inputs. */
  toggleTool(id: string): void
  /** Focuses an already-open tool. No-op when the tool is closed. */
  focusTool(id: string): void
  /** Promotes to a workspace tab, opening and focusing it first if needed. */
  promote(id: string): void
  unpromote(): void
}

/** The only key this store may write. `focused` and `promoted` are session-only. */
export const TOOLS_PERSISTED_KEYS = ['open', 'promoted', 'splitTools', 'dockWidth'] as const

export type ToolsPersistedKey = (typeof TOOLS_PERSISTED_KEYS)[number]

const persisted = persistence<ToolsState>()({
  key: STORAGE_KEYS.tools,
  version: 1,
  allow: TOOLS_PERSISTED_KEYS,
  decode: (raw) => {
    if (!Array.isArray(raw.open)) return {}
    const seen = new Set<string>()
    const open: string[] = []
    for (const entry of raw.open) {
      if (typeof entry !== 'string' || entry.length === 0) continue
      if (seen.has(entry)) continue
      seen.add(entry)
      open.push(entry)
    }
    return {
      open,
      promoted: typeof raw.promoted === 'string' && open.includes(raw.promoted) ? raw.promoted : null,
      splitTools: Array.isArray(raw.splitTools) ? [...new Set(raw.splitTools.filter((id): id is string => typeof id === 'string'))] : [],
      dockWidth: typeof raw.dockWidth === 'number' && Number.isFinite(raw.dockWidth) ? Math.max(380, Math.min(1200, raw.dockWidth)) : null,
    }
  },
})

const stored = persisted.load()
const initialOpen = stored.open ?? []

export const useTools = create<ToolsState>()((set, get) => ({
  open: initialOpen,
  // Restoring focus to the first restored tool keeps the dock keyboard-navigable
  // immediately after a reload.
  focused: stored.promoted ?? initialOpen[0] ?? null,
  promoted: stored.promoted ?? null,
  splitTools: stored.splitTools ?? [],
  dockWidth: stored.dockWidth ?? null,
  setSplit(id, split) {
    set(({ splitTools }) => ({ splitTools: split ? [...new Set([...splitTools, id])] : splitTools.filter((entry) => entry !== id) }))
  },
  setDockWidth(width) { set({ dockWidth: Math.max(380, Math.min(1200, width)) }) },

  openTool(id) {
    const { open } = get()
    set({ open: open.includes(id) ? open : [...open, id], focused: id, promoted: id })
  },

  closeTool(id) {
    const { open, focused, promoted } = get()
    if (!open.includes(id)) return

    const next = open.filter((entry) => entry !== id)
    const index = open.indexOf(id)

    set({
      open: next,
      focused: focused === id ? (next[index] ?? next[index - 1] ?? null) : focused,
      promoted: promoted === id ? (next[index] ?? next[index - 1] ?? null) : promoted,
    })
  },

  toggleTool(id) {
    get().openTool(id)
  },

  focusTool(id) {
    if (get().open.includes(id)) get().openTool(id)
  },

  promote(id) {
    get().openTool(id)
    if (get().promoted !== id) set({ promoted: id })
  },

  unpromote() {
    if (get().promoted === null) return
    set({ promoted: null })
  },
}))

useTools.subscribe((state, previous) => {
  if (TOOLS_PERSISTED_KEYS.some((key) => state[key] !== previous[key])) persisted.save(state)
})

/** Exposed for tests and for a "reset layout" command. */
export const toolsPersistence = persisted
