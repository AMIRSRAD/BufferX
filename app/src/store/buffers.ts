import { create } from 'zustand'

/**
 * Buffer documents.
 *
 * "The buffer is the document" (UX_SPEC tenet 1). Each tab owns its raw text,
 * encoding mode, packager, framing config and field model (UX_SPEC 1.3).
 *
 * **This store is never persisted.** A buffer holds real message content --
 * PANs in F2, track data in F35, PIN blocks in F52 -- and UX_SPEC 5.5 forbids
 * any of it reaching storage. There is intentionally no `persistence()` binding
 * in this file, and a test asserts that nothing here ever lands in
 * `localStorage`.
 */

/** How a message-length header is framed (UX_SPEC 2.3). */
export interface HeaderConfig {
  /** "Include on build" -- gates the header when encoding. */
  enabled: boolean
  /** ASCII zero-padded decimal, big-endian binary, or no header at all. */
  mode: 'none' | 'ascii' | 'binary'
  /** Header width in bytes, 1..8. Set by packager `LenLen` or by hand. */
  size: number
}

/** One row of the field table (UX_SPEC 2.4). */
export interface FieldRow {
  /** Bit number. Also the sort key -- rows are kept in ascending bit order. */
  id: number
  /** The value as edited, in the representation `hex` selects. */
  value: string
  /** Description from the packager's `fieldDefs`, when the field is known. */
  desc?: string
  /** Packager type code, e.g. `N`, `AN`, `ANS`, `B`, `Z`. */
  type?: string
  /** Declared length from the packager. */
  length?: number
  /** Declared as variable-length by the packager. */
  variable?: boolean
  /** The `Fmt` column: value is shown and edited as hex. */
  hex?: boolean
  /** Validation message for this row. Cleared whenever the value changes. */
  invalid?: string
}

export interface BufferTab {
  id: string
  /** File basename, or `untitled-N` while unsaved. */
  name: string
  /** Has unsaved edits. Drives the tab dot and the close prompt. */
  dirty: boolean
  /** The raw pane contents, in whichever representation `inputHex` selects. */
  raw: string
  /** Raw pane is in Hex mode rather than Text mode. */
  inputHex: boolean
  /** Active packager name, e.g. `SLM`. */
  packager: string
  header: HeaderConfig
  /** Framing auto-detect is on (UX_SPEC 2.3). */
  autoDetect: boolean
  fields: FieldRow[]
  /** A decode has produced the current field model. */
  decoded: boolean
  /**
   * Raw and fields are out of sync -- the raw pane no longer matches what a
   * Build of the current fields would produce (UX_SPEC 2.6). Set by field and
   * framing edits, cleared by a decode or a build.
   */
  stale: boolean
  /** Last engine error for this tab, shown inline. */
  lastError?: string
}

/** A closed tab, retained so `reopenLast()` can restore it exactly. */
export interface ClosedTab {
  tab: BufferTab
  /** Where it sat in the strip, so it reopens in place. */
  index: number
  closedAt: number
}

/**
 * The result of a close attempt.
 *
 * `closeTab` refuses to discard unsaved work: a dirty tab comes back as
 * `{ closed: false, reason: 'dirty' }` carrying the tab, which is everything
 * the shell needs to raise the Save / Discard / Cancel prompt (UX_SPEC 1.3,
 * and one of the only two permitted modals in 5.1). Discard re-calls with
 * `{ force: true }`; Cancel does nothing.
 */
export type CloseTabResult =
  | { closed: true; tab: BufferTab }
  | { closed: false; reason: 'not-found' }
  | { closed: false; reason: 'dirty'; tab: BufferTab }

export interface CloseTabOptions {
  /** Close even when dirty. The caller has prompted and the user chose. */
  force?: boolean
}

/**
 * A partial update to a tab.
 *
 * `header` merges field-by-field so a caller can flip one framing control
 * without restating the other two. `fields` replaces wholesale.
 */
export type BufferPatch = Partial<Omit<BufferTab, 'id' | 'header'>> & {
  header?: Partial<HeaderConfig>
}

/** Seed values for a new tab, e.g. when opening a file. */
export type NewTabInit = Partial<Omit<BufferTab, 'id' | 'header'>> & {
  header?: Partial<HeaderConfig>
}

export interface BuffersState {
  tabs: BufferTab[]
  activeId: string | null
  /** Closed tabs, most recent first. Bounded; see `CLOSED_HISTORY_LIMIT`. */
  closed: ClosedTab[]
  /** Monotonic counter behind `untitled-N` names and tab ids. */
  seq: number

  /** The active tab, or `undefined` when every tab is closed. */
  active(): BufferTab | undefined
  /** Creates a tab, makes it active, and returns its id. */
  newTab(init?: NewTabInit): string
  /** Closes a tab unless it is dirty. See `CloseTabResult`. */
  closeTab(id: string, options?: CloseTabOptions): CloseTabResult
  setActive(id: string): void
  /** Merges `patch`, deriving `dirty` and `stale`. See `applyPatch`. */
  update(id: string, patch: BufferPatch): void
  /** Edits one field's value. Marks the tab dirty and stale. */
  updateField(id: string, fieldId: number, value: string): boolean
  /** Inserts an empty field in bit order. No-op if the bit is already present. */
  addField(id: string, fieldId: number): boolean
  removeField(id: string, fieldId: number): boolean
  /** Marks raw and fields out of sync without otherwise touching the tab. */
  markStale(id: string): void
  /** Restores the most recently closed tab in place. Returns its id. */
  reopenLast(): string | undefined
}

/** How many closed tabs stay restorable. Bounded because tabs hold PANs. */
export const CLOSED_HISTORY_LIMIT = 10

export const DEFAULT_PACKAGER = 'SLM'

export const DEFAULT_HEADER: HeaderConfig = { enabled: false, mode: 'none', size: 4 }

/**
 * Keys whose change means the operator altered the document itself. These set
 * both `dirty` (there is unsaved work) and `stale` (raw and fields diverged).
 *
 * `fields` is deliberately absent: a decode replaces `fields` from `raw` and
 * must not mark a freshly opened file as edited.
 */
const DOCUMENT_KEYS = ['raw', 'packager', 'inputHex', 'autoDetect'] as const

function createTab(seq: number, init?: NewTabInit): BufferTab {
  const seed: NewTabInit = init ?? {}
  const { header: headerInit, ...rest } = seed
  return {
    id: `buf-${seq}`,
    name: `untitled-${seq}`,
    dirty: false,
    raw: '',
    inputHex: false,
    packager: DEFAULT_PACKAGER,
    header: { ...DEFAULT_HEADER, ...headerInit },
    autoDetect: true,
    fields: [],
    decoded: false,
    stale: false,
    ...rest,
  }
}

/**
 * Merges a patch and derives the staleness model of UX_SPEC 2.6.
 *
 * - Any framing, packager, encoding or raw change, and any field change, breaks
 *   the raw/fields correspondence and sets `stale`.
 * - An explicit `stale` in the patch always wins. That is how Decode and Build
 *   clear it: `update(id, { fields, decoded: true, stale: false })` after a
 *   decode, `update(id, { raw, stale: false })` after a build.
 * - Likewise for `dirty`, so a file open can pass `dirty: false`.
 * - Values that do not actually change set nothing, so re-selecting the current
 *   packager or re-typing the same byte does not invalidate a good decode.
 */
function applyPatch(tab: BufferTab, patch: BufferPatch): BufferTab {
  const { header: headerPatch, ...rest } = patch

  const header: HeaderConfig = headerPatch ? { ...tab.header, ...headerPatch } : tab.header
  const headerChanged =
    header.enabled !== tab.header.enabled ||
    header.mode !== tab.header.mode ||
    header.size !== tab.header.size

  let documentChanged = headerChanged
  for (const key of DOCUMENT_KEYS) {
    if (rest[key] !== undefined && rest[key] !== tab[key]) documentChanged = true
  }
  const fieldsChanged = rest.fields !== undefined && rest.fields !== tab.fields

  const next: BufferTab = { ...tab, ...rest, header }

  if (patch.dirty === undefined && documentChanged) next.dirty = true
  if (patch.stale === undefined && (documentChanged || fieldsChanged)) next.stale = true

  return next
}

/** Replaces one tab in place. Returns `null` when the id is unknown. */
function replaceTab(
  tabs: BufferTab[],
  id: string,
  transform: (tab: BufferTab) => BufferTab,
): BufferTab[] | null {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index === -1) return null
  const current = tabs[index]
  if (!current) return null
  const next = transform(current)
  if (next === current) return tabs
  const copy = tabs.slice()
  copy[index] = next
  return copy
}

/** Marks a tab edited by hand: dirty, stale, and no longer cleanly decoded. */
function markEdited(tab: BufferTab, fields: FieldRow[]): BufferTab {
  return { ...tab, fields, dirty: true, stale: true }
}

const firstTab = createTab(1)

export const useBuffers = create<BuffersState>()((set, get) => ({
  tabs: [firstTab],
  activeId: firstTab.id,
  closed: [],
  seq: 1,

  active() {
    const { tabs, activeId } = get()
    if (activeId === null) return undefined
    return tabs.find((tab) => tab.id === activeId)
  },

  newTab(init) {
    const seq = get().seq + 1
    const tab = createTab(seq, init)
    set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id, seq }))
    return tab.id
  },

  closeTab(id, options) {
    const { tabs, activeId, closed } = get()
    const index = tabs.findIndex((tab) => tab.id === id)
    if (index === -1) return { closed: false, reason: 'not-found' }

    const tab = tabs[index]
    if (!tab) return { closed: false, reason: 'not-found' }

    if (tab.dirty && options?.force !== true) {
      return { closed: false, reason: 'dirty', tab }
    }

    const remaining = tabs.filter((candidate) => candidate.id !== id)

    // Focus the neighbour to the right, falling back to the left, the way
    // every tabbed editor behaves.
    let nextActiveId = activeId
    if (activeId === id) {
      const neighbour = remaining[index] ?? remaining[index - 1]
      nextActiveId = neighbour ? neighbour.id : null
    }

    const entry: ClosedTab = { tab, index, closedAt: Date.now() }

    set({
      tabs: remaining,
      activeId: nextActiveId,
      closed: [entry, ...closed].slice(0, CLOSED_HISTORY_LIMIT),
    })

    return { closed: true, tab }
  },

  setActive(id) {
    const { tabs, activeId } = get()
    if (activeId === id) return
    if (!tabs.some((tab) => tab.id === id)) return
    set({ activeId: id })
  },

  update(id, patch) {
    const tabs = replaceTab(get().tabs, id, (tab) => applyPatch(tab, patch))
    if (tabs === null) return
    set({ tabs })
  },

  updateField(id, fieldId, value) {
    let applied = false
    const tabs = replaceTab(get().tabs, id, (tab) => {
      const index = tab.fields.findIndex((field) => field.id === fieldId)
      if (index === -1) return tab
      const field = tab.fields[index]
      if (!field || field.value === value) return tab

      const fields = tab.fields.slice()
      // The previous validation message described the previous value; a fresh
      // decode or build will re-raise anything still wrong (UX_SPEC 2.5).
      fields[index] = { ...field, value, invalid: undefined }
      applied = true
      return markEdited(tab, fields)
    })
    if (tabs === null) return false
    if (applied) set({ tabs })
    return applied
  },

  addField(id, fieldId) {
    let applied = false
    const tabs = replaceTab(get().tabs, id, (tab) => {
      if (tab.fields.some((field) => field.id === fieldId)) return tab

      const fields = tab.fields.slice()
      const at = fields.findIndex((field) => field.id > fieldId)
      const row: FieldRow = { id: fieldId, value: '' }
      if (at === -1) fields.push(row)
      else fields.splice(at, 0, row)

      applied = true
      return markEdited(tab, fields)
    })
    if (tabs === null) return false
    if (applied) set({ tabs })
    return applied
  },

  removeField(id, fieldId) {
    let applied = false
    const tabs = replaceTab(get().tabs, id, (tab) => {
      if (!tab.fields.some((field) => field.id === fieldId)) return tab
      applied = true
      // Removal never triggers an encode -- it marks the raw stale instead
      // (UX_SPEC 2.4).
      return markEdited(
        tab,
        tab.fields.filter((field) => field.id !== fieldId),
      )
    })
    if (tabs === null) return false
    if (applied) set({ tabs })
    return applied
  },

  markStale(id) {
    const tabs = replaceTab(get().tabs, id, (tab) => (tab.stale ? tab : { ...tab, stale: true }))
    if (tabs === null) return
    set({ tabs })
  },

  reopenLast() {
    const { closed, tabs } = get()
    const entry = closed[0]
    if (!entry) return undefined

    // Guard against a double reopen if the shell also restored it somehow.
    if (tabs.some((tab) => tab.id === entry.tab.id)) {
      set({ closed: closed.slice(1), activeId: entry.tab.id })
      return entry.tab.id
    }

    const restored = tabs.slice()
    restored.splice(Math.min(entry.index, restored.length), 0, entry.tab)

    set({ tabs: restored, activeId: entry.tab.id, closed: closed.slice(1) })
    return entry.tab.id
  },
}))
