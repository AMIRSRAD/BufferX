/**
 * The saved-buffer library.
 *
 * A curated set of reusable test messages — "0200 purchase", "0800 echo",
 * "reversal with F90" — that an operator replays often.
 *
 * The content of those messages lives in the operator's own `.bxb` files, in a
 * portable default folder or an override. This store keeps only the override and per-file
 * annotations (a label and a note). That split is deliberate and is the whole
 * security design of the feature: a saved buffer carries a PAN, track 2 data
 * and a PIN block, and application storage is the wrong place for those. The
 * operator already controls retention, backup and disk encryption for their own
 * files; BufferX should not quietly become a second copy of card data.
 *
 * `store/persist.ts` would in fact refuse to write buffer content here — its
 * denylist rejects `pan`, `track`, `block` and friends — so this is enforced,
 * not merely intended.
 */

import { create } from 'zustand'

import { STORAGE_KEYS, persistence } from './persist'

/** An operator's annotation of one file in the library folder. */
export interface LibraryNote {
  /** Absolute path of the `.bxb` file this annotates. */
  path: string
  /** Display label. Defaults to the file name when absent. */
  label?: string
  /** Free text: what the message is for, which host it targets. */
  note?: string
  /** Sort ahead of unpinned entries. */
  pinned?: boolean
}

export interface LibraryState {
  /** Folder override. `null` uses saved-buffers beside the executable. */
  folder: string | null
  /** Annotations keyed by path. Entries with no annotation are absent. */
  notes: Record<string, LibraryNote>

  setFolder(folder: string | null): void
  annotate(path: string, patch: Omit<LibraryNote, 'path'>): void
  togglePin(path: string): void
  forget(path: string): void
  clearNotes(): void
}

const persisted = persistence<LibraryState>()({
  key: STORAGE_KEYS.library,
  allow: ['folder', 'notes'],
  decode(raw) {
    const next: Partial<Pick<LibraryState, 'folder' | 'notes'>> = {}

    if (typeof raw.folder === 'string' || raw.folder === null) {
      next.folder = raw.folder as string | null
    }

    // Storage is untrusted input: rebuild the map entry by entry rather than
    // trusting its shape, and drop anything malformed.
    if (raw.notes !== null && typeof raw.notes === 'object' && !Array.isArray(raw.notes)) {
      const notes: Record<string, LibraryNote> = {}
      for (const [path, value] of Object.entries(raw.notes as Record<string, unknown>)) {
        if (typeof path !== 'string' || path === '') continue
        if (value === null || typeof value !== 'object') continue
        const entry = value as Record<string, unknown>
        const note: LibraryNote = { path }
        if (typeof entry.label === 'string') note.label = entry.label
        if (typeof entry.note === 'string') note.note = entry.note
        if (typeof entry.pinned === 'boolean') note.pinned = entry.pinned
        notes[path] = note
      }
      next.notes = notes
    }

    return next
  },
})

const initial = persisted.load()

export const useLibrary = create<LibraryState>()((set, get) => ({
  folder: initial.folder ?? null,
  notes: initial.notes ?? {},

  setFolder(folder) {
    if (get().folder === folder) return
    set({ folder })
    persisted.save(get())
  },

  annotate(path, patch) {
    if (path === '') return
    const existing = get().notes[path] ?? { path }
    const next: LibraryNote = { ...existing, ...patch, path }

    // An annotation that says nothing is not worth keeping; drop it so the map
    // does not accumulate empty records for every file ever opened.
    const empty = !next.label && !next.note && !next.pinned
    const notes = { ...get().notes }
    if (empty) {
      delete notes[path]
    } else {
      notes[path] = next
    }
    set({ notes })
    persisted.save(get())
  },

  togglePin(path) {
    const existing = get().notes[path]
    get().annotate(path, { ...existing, pinned: !existing?.pinned })
  },

  forget(path) {
    if (!(path in get().notes)) return
    const notes = { ...get().notes }
    delete notes[path]
    set({ notes })
    persisted.save(get())
  },

  clearNotes() {
    if (Object.keys(get().notes).length === 0) return
    set({ notes: {} })
    persisted.save(get())
  },
}))
