/**
 * The global keyboard map (UX_SPEC 4.2).
 *
 * Two rules shape everything here:
 *
 * 1. `Ctrl+Enter` runs the **primary** action of the focused region and
 *    `Ctrl+Shift+Enter` the **secondary**. The shell does not know what those
 *    are; it calls the handlers, and `AppShell` re-broadcasts them to whichever
 *    region currently owns focus.
 * 2. Bindings avoid everything the browser reserves. `Alt+1…0` rather than
 *    `Ctrl+1…9` (Chrome will not let a page preventDefault tab switching),
 *    `Alt+N/W` rather than `Ctrl+N/W`, `Alt+[`/`Alt+]` rather than `Ctrl+Tab`.
 *
 * Keys are matched on `KeyboardEvent.code` wherever a modifier can rewrite
 * `key` (every `Alt+` binding, and the bracket/backslash/backquote keys), so
 * the map behaves the same on a non-US layout.
 */

import { useEffect, useRef } from 'react'

/** macOS maps `Ctrl` to `Cmd` and the `Alt+` bindings to `Ctrl+Option+`. */
export const IS_APPLE: boolean =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)

/**
 * Commands the shell forwards rather than handles. The workspace, the field
 * table and the tools listen for these; see `SHELL_COMMAND_EVENT`.
 */
export const SHELL_COMMAND_EVENT = 'bufferx:command'

/**
 * `Ctrl+Enter` / `Ctrl+Shift+Enter`. Dispatched on `document` with the region
 * that had focus, so the workspace runs Decode/Build while a focused tool runs
 * its own primary/secondary pair (UX_SPEC 4.2).
 */
export const SHELL_ACTION_EVENT = 'bufferx:action'

export interface ShellActionDetail {
  kind: 'primary' | 'secondary'
  /** `workspace`, `dock`, `problems`, … — see `AppShell`'s region order. */
  region: string
  /** Focused dock tool id, when `region` is `dock`. */
  tool?: string
}

/** Detail carried by a forwarded command event. */
export interface ShellCommandDetail {
  command: string
  /** Optional argument, e.g. a bit number for `jump-to-field`. */
  arg?: string | number
}

export interface ShortcutHandlers {
  openPalette(): void
  toggleDock(): void
  toggleProblems(): void
  promoteFocusedTool(): void
  /** 1-based rail slot: `Alt+1` → 1 … `Alt+9` → 9, `Alt+0` → 10. */
  railDestination(slot: number): void
  newBuffer(): void
  closeBuffer(): void
  reopenBuffer(): void
  stepBuffer(delta: -1 | 1): void
  openSettings(): void
  openShortcutSheet(): void
  clearSecrets(): void
  stepRegion(delta: -1 | 1): void
  primaryAction(): void
  secondaryAction(): void
  /** Everything region-scoped: undo, save, filter, identify packager, … */
  dispatch(command: string): void
}

/** One row of the shortcut sheet and of the palette's right-aligned hint. */
export interface ShortcutDescriptor {
  keys: string
  action: string
  scope: string
}

/**
 * The published map. This is documentation *and* the data behind `Ctrl+/`, so
 * it stays in the same file as the handler it describes.
 */
export const SHORTCUTS: readonly ShortcutDescriptor[] = [
  { keys: 'Ctrl+K', action: 'Command palette', scope: 'Global' },
  { keys: 'Ctrl+Enter', action: 'Primary action of the focused region', scope: 'Global' },
  { keys: 'Ctrl+Shift+Enter', action: 'Secondary action of the focused region', scope: 'Global' },
  { keys: 'Ctrl+Shift+D', action: 'Identify packager', scope: 'Buffer' },
  { keys: 'Ctrl+Z', action: 'Undo', scope: 'Buffer' },
  { keys: 'Ctrl+Shift+Z', action: 'Redo', scope: 'Buffer' },
  { keys: 'Ctrl+S', action: 'Save buffer', scope: 'Buffer' },
  { keys: 'Ctrl+Shift+S', action: 'Save buffer as…', scope: 'Buffer' },
  { keys: 'Ctrl+O', action: 'Open buffer', scope: 'Buffer' },
  { keys: 'Ctrl+F', action: 'Filter fields', scope: 'Fields' },
  { keys: 'Ctrl+B', action: 'Switch between buffer and tool', scope: 'View' },
  { keys: 'Ctrl+`', action: 'Toggle Problems drawer', scope: 'View' },
  { keys: 'Ctrl+Shift+\\', action: 'Toggle buffer and tool split view', scope: 'View' },
  { keys: 'Ctrl+Shift+V', action: 'Cycle raw view Text → Hex → Bytes', scope: 'Buffer' },
  { keys: 'Alt+1 … Alt+9, Alt+0', action: 'Rail destinations', scope: 'Global' },
  { keys: 'Alt+[ / Alt+]', action: 'Previous / next buffer tab', scope: 'Buffers' },
  { keys: 'Alt+N', action: 'New buffer', scope: 'Buffers' },
  { keys: 'Alt+W', action: 'Close buffer', scope: 'Buffers' },
  { keys: 'Alt+Shift+W', action: 'Reopen closed buffer', scope: 'Buffers' },
  { keys: 'Alt+A', action: 'Add field', scope: 'Fields' },
  { keys: 'Alt+H', action: 'Toggle hex on the focused row', scope: 'Fields' },
  { keys: 'Alt+Enter', action: 'Expand the focused value', scope: 'Fields' },
  { keys: 'Alt+Shift+↑ / ↓', action: 'Resize the raw / fields splitter', scope: 'Buffer' },
  { keys: 'F6 / Shift+F6', action: 'Cycle region focus', scope: 'Global' },
  { keys: 'Ctrl+Shift+C', action: 'Copy the focused value', scope: 'Global' },
  { keys: 'Ctrl+,', action: 'Settings', scope: 'Global' },
  { keys: 'Ctrl+/', action: 'Keyboard shortcuts', scope: 'Global' },
  { keys: 'Ctrl+Shift+H', action: 'History timeline', scope: 'Global' },
  { keys: 'Ctrl+Alt+L', action: 'Clear all secrets', scope: 'Global' },
  { keys: 'Esc', action: 'Close the topmost transient layer', scope: 'Global' },
]

/**
 * Renders a binding for display, mapping to Apple modifiers where appropriate.
 * `Ctrl` → `⌘`, and the `Alt+` family → `⌃⌥` so Option never produces a
 * special character (UX_SPEC 4.2, final paragraph).
 */
export function formatShortcut(keys: string): string {
  if (!IS_APPLE) return keys
  return keys
    .replace(/\bCtrl\+Alt\+/g, '⌘⌥')
    .replace(/\bAlt\+/g, '⌃⌥')
    .replace(/\bCtrl\+/g, '⌘')
    .replace(/\bShift\+/g, '⇧')
    .replace(/\bEnter\b/g, '↵')
}

/** True when the event target is a text entry that should keep the keystroke. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit'
  }
  return false
}

/** The platform's "command" modifier, and nothing else pressed alongside it. */
function isMod(event: KeyboardEvent): boolean {
  return IS_APPLE ? event.metaKey : event.ctrlKey
}

/** The platform's "alt" family: `Alt` on Windows/Linux, `Ctrl+Option` on Apple. */
function isAlt(event: KeyboardEvent): boolean {
  return IS_APPLE ? event.altKey && event.ctrlKey : event.altKey && !event.ctrlKey
}

const DIGIT_CODES = [
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Digit0',
] as const

/**
 * Installs the global map. Mount exactly once, from `AppShell`.
 *
 * The listener runs in the capture phase so a binding is never swallowed by a
 * CodeMirror instance or a Radix layer, but it consults `isEditableTarget`
 * before consuming anything a text field would legitimately want.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  // Held in a ref so the listener is installed once. Re-binding a capture-phase
  // window listener on every render would reorder it against Radix's layers.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined') return

    function onKeyDown(event: KeyboardEvent) {
      const handlers = handlersRef.current
      if (event.defaultPrevented) return
      if (event.repeat && event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        // Auto-repeat on a command binding is always an accident.
        if (event.key !== 'Enter') return
      }

      const mod = isMod(event)
      const alt = isAlt(event)
      const shift = event.shiftKey
      const key = event.key.toLowerCase()
      const code = event.code
      const editable = isEditableTarget(event.target)

      const run = (fn: () => void) => {
        event.preventDefault()
        event.stopPropagation()
        fn()
      }

      // ── Palette ───────────────────────────────────────────────────────────
      if (mod && !alt && (key === 'k' || (shift && key === 'p'))) {
        return run(handlers.openPalette)
      }

      // ── Primary / secondary action of the focused region ───────────────────
      if (mod && !alt && key === 'enter') {
        return run(shift ? handlers.secondaryAction : handlers.primaryAction)
      }

      // ── View ──────────────────────────────────────────────────────────────
      if (mod && !alt && !shift && key === 'b') return run(handlers.toggleDock)
      if (mod && !alt && (code === 'Backquote' || key === '`')) return run(handlers.toggleProblems)
      if (mod && shift && (code === 'Backslash' || key === '\\')) {
        return run(handlers.promoteFocusedTool)
      }
      if (mod && shift && key === 'v') return run(() => handlers.dispatch('cycle-raw-view'))

      // ── App ───────────────────────────────────────────────────────────────
      if (mod && !alt && !shift && key === ',') return run(handlers.openSettings)
      if (mod && !alt && !shift && key === '/') return run(handlers.openShortcutSheet)
      if (mod && shift && key === 'h') return run(() => handlers.dispatch('history'))
      if (mod && event.altKey && key === 'l') return run(handlers.clearSecrets)

      // ── Buffer document ───────────────────────────────────────────────────
      if (mod && shift && key === 'd') return run(() => handlers.dispatch('identify-packager'))
      if (mod && !alt && !shift && key === 'z') return run(() => handlers.dispatch('undo'))
      if (mod && !alt && shift && key === 'z') return run(() => handlers.dispatch('redo'))
      if (mod && !alt && !shift && key === 'y') return run(() => handlers.dispatch('redo'))
      if (mod && !alt && key === 's') {
        return run(() => handlers.dispatch(shift ? 'save-buffer-as' : 'save-buffer'))
      }
      if (mod && !alt && !shift && key === 'o') return run(() => handlers.dispatch('open-buffer'))
      if (mod && !alt && !shift && key === 'f') return run(() => handlers.dispatch('filter-fields'))
      if (mod && shift && key === 'c') return run(() => handlers.dispatch('copy-focused-value'))

      // ── Rail destinations ─────────────────────────────────────────────────
      if (alt && !shift) {
        const slot = DIGIT_CODES.indexOf(code as (typeof DIGIT_CODES)[number])
        if (slot !== -1) return run(() => handlers.railDestination(slot + 1))
      }

      // ── Buffer tabs ───────────────────────────────────────────────────────
      if (alt && !shift && code === 'BracketLeft') return run(() => handlers.stepBuffer(-1))
      if (alt && !shift && code === 'BracketRight') return run(() => handlers.stepBuffer(1))
      if (alt && !shift && code === 'KeyN') return run(handlers.newBuffer)
      if (alt && !shift && code === 'KeyW') return run(handlers.closeBuffer)
      if (alt && shift && code === 'KeyW') return run(handlers.reopenBuffer)

      // ── Field table, forwarded ────────────────────────────────────────────
      if (alt && !shift && code === 'KeyA') return run(() => handlers.dispatch('add-field'))
      if (alt && !shift && code === 'KeyH') return run(() => handlers.dispatch('toggle-field-hex'))
      if (alt && !shift && key === 'enter') return run(() => handlers.dispatch('expand-value'))
      if (alt && shift && (code === 'ArrowUp' || code === 'ArrowDown')) {
        return run(() => handlers.dispatch(code === 'ArrowUp' ? 'splitter-up' : 'splitter-down'))
      }
      if (!mod && !alt && !shift && key === 'insert' && !editable) {
        return run(() => handlers.dispatch('add-field'))
      }

      // ── Region focus ──────────────────────────────────────────────────────
      if (!mod && !alt && key === 'f6') return run(() => handlers.stepRegion(shift ? -1 : 1))
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
