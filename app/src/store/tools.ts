import { create } from 'zustand'
import { STORAGE_KEYS, persistence } from './persist'

/**
 * The tool dock.
 *
 * Tools stack in a right-hand accordion and never occlude the workspace
 * (UX_SPEC tenet 1, 1.1). Opening one never closes another -- the mutual
 * exclusion of the old `closeToolPanels()` is the single behaviour this store
 * exists to prevent.
 *
 * Only the *identity* of the open tools is persisted (UX_SPEC 5.5: "dock
 * contents (tool identity and pinned state only)"). Tool bodies hold keys,
 * PINs and PAN-bearing values, and none of that is this store's business or
 * storage's.
 */

/** Rail destinations that open as dock tools (UX_SPEC 1.2). */
export const TOOL_IDS = [
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
  /** Open tool ids, in dock order (top to bottom). */
  open: string[]
  /** The tool that currently has dock focus, or `null` when the dock is empty. */
  focused: string | null
  /** The tool promoted to a full workspace tab via `Ctrl+Shift+\`, if any. */
  promoted: string | null

  /** Opens (if needed) and focuses. This is what a rail entry does. */
  openTool(id: string): void
  /** Closes, moving focus on and un-promoting if it was promoted. */
  closeTool(id: string): void
  /** Rail re-activation: closes the focused tool, otherwise opens and focuses. */
  toggleTool(id: string): void
  /** Focuses an already-open tool. No-op when the tool is closed. */
  focusTool(id: string): void
  /** Promotes to a workspace tab, opening and focusing it first if needed. */
  promote(id: string): void
  unpromote(): void
}

/** The only key this store may write. `focused` and `promoted` are session-only. */
export const TOOLS_PERSISTED_KEYS = ['open'] as const

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
    return { open }
  },
})

const stored = persisted.load()
const initialOpen = stored.open ?? []

export const useTools = create<ToolsState>()((set, get) => ({
  open: initialOpen,
  // Restoring focus to the first restored tool keeps the dock keyboard-navigable
  // immediately after a reload.
  focused: initialOpen[0] ?? null,
  promoted: null,

  openTool(id) {
    const { open, focused } = get()
    if (open.includes(id)) {
      if (focused !== id) set({ focused: id })
      return
    }
    set({ open: [...open, id], focused: id })
  },

  closeTool(id) {
    const { open, focused, promoted } = get()
    if (!open.includes(id)) return

    const next = open.filter((entry) => entry !== id)
    const index = open.indexOf(id)

    set({
      open: next,
      focused: focused === id ? (next[index] ?? next[index - 1] ?? null) : focused,
      promoted: promoted === id ? null : promoted,
    })
  },

  toggleTool(id) {
    const { open, focused } = get()
    // `Alt+4 Alt+4` is a fast peek: the second press dismisses what the first
    // opened (UX_SPEC 1.2). Re-activating a tool that is open but *not* focused
    // brings it forward instead, which is what the operator meant.
    if (open.includes(id) && focused === id) {
      get().closeTool(id)
      return
    }
    get().openTool(id)
  },

  focusTool(id) {
    const { open, focused } = get()
    if (!open.includes(id)) return
    if (focused === id) return
    set({ focused: id })
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
  if (state.open !== previous.open) persisted.save(state)
})

/** Exposed for tests and for a "reset layout" command. */
export const toolsPersistence = persisted
