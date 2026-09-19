/**
 * The `.bxb` buffer document format (UX_SPEC 3.9 → Buffers, 5.5 rule 4).
 *
 * "`saveBufferFile` writes packager, fields, raw, rawFormat, and the
 * length-header block — as before. Field values *are* message content and are
 * saved". Tool secrets -- keys, PINs entered in the PIN tool, PEMs -- are never
 * part of a buffer and therefore never part of this file.
 *
 * A saved buffer may still contain F35 track data and an F52 PIN block, because
 * those are message content. The save flow warns about it; see
 * `sensitiveFieldsIn`.
 */

import type { BufferTab, FieldRow, HeaderConfig, NewTabInit } from '@/store/buffers'

/**
 * Canonical on-disk identity, shared with `tools/buffer/model.ts`.
 *
 * This module used to declare `bufferx-buffer` while the workspace wrote
 * `bufferx.buffer`, and both parsers checked strictly — so Settings rejected
 * files the workspace had just saved, and the reverse. Both now write the same
 * string and accept either on read.
 */
export const BUFFER_FILE_FORMAT = 'bufferx.buffer'
export const BUFFER_FILE_VERSION = 1
export const BUFFER_FILE_EXTENSION = 'bxb'

/** Format strings tolerated on read, including the historical spelling. */
export const ACCEPTED_BUFFER_FORMATS: readonly string[] = ['bufferx.buffer', 'bufferx-buffer']

interface StoredField {
  id: number
  value: string
  /** The `Fmt` column: the value is written as hex. */
  hex?: boolean
}

interface BufferFileV1 {
  format: typeof BUFFER_FILE_FORMAT
  version: typeof BUFFER_FILE_VERSION
  name: string
  packager: string
  raw: string
  /** Mirrors the old `rawFormat` key. */
  rawFormat: 'hex' | 'text'
  header: HeaderConfig
  autoDetect: boolean
  fields: StoredField[]
  savedAt: string
}

/** Bits whose presence makes a saved file worth a handling note (5.5 rule 4). */
export const SENSITIVE_FIELD_IDS: readonly number[] = [35, 52]

/** Which of `SENSITIVE_FIELD_IDS` this buffer actually carries. */
export function sensitiveFieldsIn(fields: readonly FieldRow[]): number[] {
  return SENSITIVE_FIELD_IDS.filter((id) =>
    fields.some((field) => field.id === id && field.value.trim() !== ''),
  )
}

/** Serialises a tab. Pretty-printed: these files get read and diffed by hand. */
export function serializeBuffer(tab: BufferTab): string {
  const payload: BufferFileV1 = {
    format: BUFFER_FILE_FORMAT,
    version: BUFFER_FILE_VERSION,
    name: tab.name,
    packager: tab.packager,
    raw: tab.raw,
    rawFormat: tab.inputHex ? 'hex' : 'text',
    header: { ...tab.header },
    autoDetect: tab.autoDetect,
    fields: tab.fields.map((field) => ({
      id: field.id,
      value: field.value,
      ...(field.hex ? { hex: true } : {}),
    })),
    savedAt: new Date().toISOString(),
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

/** The default download / save-as name for a tab. */
export function suggestedFileName(tab: BufferTab): string {
  const base = tab.name.replace(/\.[A-Za-z0-9]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-')
  return `${base === '' ? 'buffer' : base}.${BUFFER_FILE_EXTENSION}`
}

export type ParseResult =
  | { ok: true; init: NewTabInit }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHeader(raw: unknown): HeaderConfig | null {
  if (!isRecord(raw)) return null
  const mode = raw.mode
  if (mode !== 'none' && mode !== 'ascii' && mode !== 'binary') return null
  const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? Math.round(raw.size) : 4
  return {
    enabled: raw.enabled === true,
    mode,
    size: Math.min(8, Math.max(1, size)),
  }
}

/**
 * Validates a file into a `newTab` seed.
 *
 * Storage and files are untrusted input: every field is checked, and a bad file
 * produces a sentence the panel can render, never a throw.
 */
export function parseBufferFile(text: string, fallbackName: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This file is not valid JSON, so it is not a BufferX buffer.' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'This file does not contain a buffer object.' }
  }
  if (!ACCEPTED_BUFFER_FORMATS.includes(String(parsed.format ?? ''))) {
    return {
      ok: false,
      error: `Expected a "${BUFFER_FILE_FORMAT}" file. This one declares "${String(parsed.format ?? 'nothing')}".`,
    }
  }
  if (parsed.version !== BUFFER_FILE_VERSION) {
    return {
      ok: false,
      error: `This file is version ${String(parsed.version)}; this build reads version ${String(BUFFER_FILE_VERSION)}.`,
    }
  }

  const header = parseHeader(parsed.header)
  if (header === null) {
    return { ok: false, error: 'The length-header block is missing or malformed.' }
  }

  const fields: FieldRow[] = []
  if (Array.isArray(parsed.fields)) {
    for (const entry of parsed.fields) {
      if (!isRecord(entry)) continue
      if (typeof entry.id !== 'number' || !Number.isFinite(entry.id) || entry.id < 0) continue
      if (typeof entry.value !== 'string') continue
      fields.push({
        id: Math.round(entry.id),
        value: entry.value,
        ...(entry.hex === true ? { hex: true } : {}),
      })
    }
    fields.sort((a, b) => a.id - b.id)
  }

  const name =
    typeof parsed.name === 'string' && parsed.name.trim() !== '' ? parsed.name : fallbackName

  return {
    ok: true,
    init: {
      name,
      packager: typeof parsed.packager === 'string' && parsed.packager !== '' ? parsed.packager : 'SLM',
      raw: typeof parsed.raw === 'string' ? parsed.raw : '',
      inputHex: parsed.rawFormat === 'hex',
      header,
      autoDetect: parsed.autoDetect !== false,
      fields,
      decoded: fields.length > 0,
      dirty: false,
      stale: false,
    },
  }
}
