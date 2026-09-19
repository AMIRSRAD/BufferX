/**
 * The packager registry as Settings sees it (UX_SPEC 3.9 → Packagers).
 *
 * The engine owns one registry per session: `packager.loadXml` *replaces* it
 * outright, so a partially-updated registry can never decode a message the
 * operator believes came from the file they just loaded. This store mirrors that
 * registry plus the provenance the old app tracked but never showed -- where the
 * XML came from, how big it was, its hash, and when it was loaded.
 *
 * The XML text is kept in memory so `Reload` works on the web build, where the
 * browser never gives us a path to re-read. It is message *format* data, never
 * message content: no PAN, PIN or key is ever in a packager file.
 */

import { create } from 'zustand'
import { tryCall } from '@/engine/client'
import { hashText } from './hostFiles'

/** `packagerSummary` from `core/abi/bufferx_abi.cpp`, verbatim. */
export interface PackagerSummary {
  name: string
  macMethod: string
  macSize: number
  macConfigured: boolean
  bitmapIndex: number
  secondPartBitmap: boolean
  fieldCount: number
  lenFormat: string
  lenLen: number
  fieldDefinitionCount: number
  macFieldIds: number[]
}

/** `fieldDefValue` from the same file. */
export interface PackagerFieldDef {
  id: number
  type: string
  length: number
  desc: string
  flags: number
  lengthDigits: number
  variable: boolean
  sourceType: string
}

/** Where the active registry came from. */
export interface PackagerSource {
  /** `builtin` = whatever the engine booted with; `file` = an XML we loaded. */
  kind: 'builtin' | 'file'
  /** Basename or a short label such as `Engine defaults`. */
  label: string
  /** Absolute path on desktop; `null` on web and for the built-in registry. */
  path: string | null
  /** UTF-8 byte length of the XML, or `null` when it was never loaded here. */
  bytes: number | null
  /** `sha256:…` or `fnv1a:…`; `null` until the digest resolves. */
  hash: string | null
  loadedAt: number
}

export type PackagerStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PackagerSourceState {
  packagers: PackagerSummary[]
  source: PackagerSource | null
  status: PackagerStatus
  /** Engine message from the last failed call, shown inline. */
  error: string | null
  /** The XML we last loaded, so `Reload` works without a path. */
  xml: string | null

  /** Reads the registry the engine already holds. Safe to call repeatedly. */
  refresh(): Promise<boolean>
  /** Validates, loads and adopts an XML document. */
  loadXml(xml: string, origin: { label: string; path: string | null }): Promise<boolean>
  /** Re-applies the last XML (or re-reads the registry when there is none). */
  reload(): Promise<boolean>
  clearError(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function num(raw: unknown, fallback = 0): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

function str(raw: unknown, fallback = ''): string {
  return typeof raw === 'string' ? raw : fallback
}

/** Normalises one `packagerSummary` object, tolerating an older ABI. */
export function toSummary(raw: unknown): PackagerSummary | null {
  if (!isRecord(raw)) return null
  const name = str(raw.name)
  if (name === '') return null
  const macFieldIds: number[] = []
  if (Array.isArray(raw.macFieldIds)) {
    for (const id of raw.macFieldIds) if (typeof id === 'number') macFieldIds.push(id)
  }
  return {
    name,
    macMethod: str(raw.macMethod, '—'),
    macSize: num(raw.macSize),
    macConfigured: raw.macConfigured === true || num(raw.macSize) > 0,
    bitmapIndex: num(raw.bitmapIndex),
    secondPartBitmap: raw.secondPartBitmap === true,
    fieldCount: num(raw.fieldCount),
    lenFormat: str(raw.lenFormat, '—'),
    lenLen: num(raw.lenLen),
    fieldDefinitionCount: num(raw.fieldDefinitionCount),
    macFieldIds,
  }
}

function toSummaries(data: unknown): PackagerSummary[] {
  if (!isRecord(data) || !Array.isArray(data.packagers)) return []
  const out: PackagerSummary[] = []
  for (const entry of data.packagers) {
    const summary = toSummary(entry)
    if (summary) out.push(summary)
  }
  return out
}

/** Normalises `packager.fields`. */
export function toFieldDefs(data: unknown): PackagerFieldDef[] {
  if (!isRecord(data) || !Array.isArray(data.fields)) return []
  const out: PackagerFieldDef[] = []
  for (const entry of data.fields) {
    if (!isRecord(entry)) continue
    out.push({
      id: num(entry.id, -1),
      type: str(entry.type, '—'),
      length: num(entry.length),
      desc: str(entry.desc),
      flags: num(entry.flags),
      lengthDigits: num(entry.lengthDigits),
      variable: entry.variable === true,
      sourceType: str(entry.sourceType),
    })
  }
  return out.filter((def) => def.id >= 0)
}

/**
 * The client-side rules for a packager file, checked before the engine is asked.
 * Returns a sentence, or `null` when the document is worth sending.
 */
export function validatePackagerXml(xml: string): string | null {
  const trimmed = xml.trim()
  if (trimmed === '') return 'The file is empty. A packager file is an XML document.'
  if (!trimmed.startsWith('<')) {
    return 'This does not look like XML — the first non-space character is not "<".'
  }
  if (!/<\s*packager/i.test(trimmed)) {
    return 'No <Packager> element found. Choose the packager definition file, not a buffer or a capture.'
  }
  return null
}

const BUILTIN_SOURCE: PackagerSource = {
  kind: 'builtin',
  label: 'Engine defaults',
  path: null,
  bytes: null,
  hash: null,
  loadedAt: 0,
}

export const usePackagerSource = create<PackagerSourceState>()((set, get) => ({
  packagers: [],
  source: null,
  status: 'idle',
  error: null,
  xml: null,

  async refresh() {
    set({ status: 'loading', error: null })
    const result = await tryCall('packager.list', {})
    if (!result.ok) {
      set({ status: 'error', error: result.error.message })
      return false
    }
    const packagers = toSummaries(result.data)
    set({
      packagers,
      status: 'ready',
      error: null,
      source: get().source ?? { ...BUILTIN_SOURCE, loadedAt: Date.now() },
    })
    return true
  },

  async loadXml(xml, origin) {
    const problem = validatePackagerXml(xml)
    if (problem !== null) {
      set({ status: 'error', error: problem })
      return false
    }

    set({ status: 'loading', error: null })
    const result = await tryCall('packager.loadXml', { xml })
    if (!result.ok) {
      set({ status: 'error', error: result.error.message })
      return false
    }

    const packagers = toSummaries(result.data)
    const bytes = new TextEncoder().encode(xml).length
    set({
      packagers,
      xml,
      status: 'ready',
      error: null,
      source: {
        kind: 'file',
        label: origin.label,
        path: origin.path,
        bytes,
        hash: null,
        loadedAt: Date.now(),
      },
    })

    // The digest is provenance, not a gate: it lands when it lands.
    void hashText(xml).then((hash) => {
      const current = get().source
      if (current && current.loadedAt !== 0 && current.label === origin.label) {
        set({ source: { ...current, hash } })
      }
    })

    return true
  },

  async reload() {
    const xml = get().xml
    const source = get().source
    if (xml !== null && source !== null) {
      return get().loadXml(xml, { label: source.label, path: source.path })
    }
    return get().refresh()
  },

  clearError() {
    set({ error: null })
  },
}))

/**
 * The 32 shipped packagers, grouped exactly as UX_SPEC 2.2 lists them.
 *
 * Used to render the picker when the engine's registry is unavailable, so an
 * engine failure never silently shortens the option list, and to group the
 * options for scanning. Grouping is presentational only.
 */
export const PACKAGER_GROUPS: readonly { label: string; names: readonly string[] }[] = [
  { label: 'Hosts', names: ['SLM', 'NEGIN', 'NEGINLink', 'INFOTECH', 'HYPERCOM', 'SHETAB7'] },
  { label: 'Datasets', names: ['DATASET', 'BIT121'] },
  { label: 'Tables', names: ['TABLE71', 'TABLE73', 'TABLE62', 'TABLE69', 'TABLE74', 'TABLE89', 'TABLE27'] },
  { label: 'Amount / Statement', names: ['AMNT87', 'AMNT2003', 'STMNT2003'] },
  {
    label: 'STX',
    names: [
      'STX10',
      'STX11',
      'STX12',
      'STX13',
      'STX14',
      'STX15',
      'STX20',
      'STX21',
      'STX01',
      'STX60',
      'STX61',
      'STX62',
      'STX65',
      'STX67',
    ],
  },
]

/** All 32 names, flat, in the spec's order. */
export const CANONICAL_PACKAGERS: readonly string[] = PACKAGER_GROUPS.flatMap((group) => group.names)

/** The group a name belongs to, or `Other` for a name only the file knows. */
export function groupOf(name: string): string {
  const upper = name.toUpperCase()
  for (const group of PACKAGER_GROUPS) {
    if (group.names.some((candidate) => candidate.toUpperCase() === upper)) return group.label
  }
  return 'Other'
}
