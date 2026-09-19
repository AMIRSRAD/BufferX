/**
 * Workspace layout preferences (UX_SPEC 5.5).
 *
 * Persistence here is **allowlist-only** and the allowlist is this file's
 * `DEFAULTS` object: booleans, three closed enums and one small integer. There
 * is no path by which buffer content, a field value, a PAN or a key can reach
 * storage from here — nothing in this module accepts a string that came from a
 * buffer, and `decode` rejects anything it does not recognise.
 */

const STORAGE_KEY = 'bufferx.workspace'
const VERSION = 1

export type RawView = 'text' | 'hex' | 'bytes'
export type HeaderMode = 'ascii' | 'binary'

export interface WorkspacePrefs {
  /** Auto-decode 350ms after typing stops, immediately on paste (UX_SPEC 2.1). */
  autoDecode: boolean
  rawView: RawView
  /** Scroll the byte view to the selected field. */
  follow: boolean
  /** Optional `Offset` column in the field table. */
  showOffsetColumn: boolean
  showTypeColumn: boolean
  showLenColumn: boolean
  showFmtColumn: boolean
  presentOnly: boolean
  errorsOnly: boolean
  /** Framing defaults applied to a fresh buffer. */
  autoDetect: boolean
  includeHeaderOnBuild: boolean
  headerMode: HeaderMode
  headerSize: number
  /** Pins the operator's header size against packager and legacy writes. */
  headerSizeLocked: boolean
  /** Raw / fields splitter, percent of the workspace given to the raw pane. */
  splitRatio: number
}

export const DEFAULT_PREFS: WorkspacePrefs = {
  autoDecode: true,
  rawView: 'text',
  follow: true,
  showOffsetColumn: false,
  showTypeColumn: true,
  showLenColumn: true,
  showFmtColumn: true,
  presentOnly: false,
  errorsOnly: false,
  autoDetect: true,
  includeHeaderOnBuild: false,
  headerMode: 'ascii',
  headerSize: 4,
  headerSizeLocked: false,
  splitRatio: 34,
}

function decode(raw: unknown): Partial<WorkspacePrefs> {
  if (raw === null || typeof raw !== 'object') return {}
  const record = raw as Record<string, unknown>
  const out: Partial<WorkspacePrefs> = {}

  const bools = [
    'autoDecode',
    'follow',
    'showOffsetColumn',
    'showTypeColumn',
    'showLenColumn',
    'showFmtColumn',
    'presentOnly',
    'errorsOnly',
    'autoDetect',
    'includeHeaderOnBuild',
    'headerSizeLocked',
  ] as const

  for (const key of bools) {
    if (typeof record[key] === 'boolean') out[key] = record[key] as boolean
  }

  if (record.rawView === 'text' || record.rawView === 'hex' || record.rawView === 'bytes') {
    out.rawView = record.rawView
  }
  if (record.headerMode === 'ascii' || record.headerMode === 'binary') {
    out.headerMode = record.headerMode
  }
  if (typeof record.headerSize === 'number' && Number.isFinite(record.headerSize)) {
    out.headerSize = Math.max(1, Math.min(8, Math.round(record.headerSize)))
  }
  if (typeof record.splitRatio === 'number' && Number.isFinite(record.splitRatio)) {
    out.splitRatio = Math.max(12, Math.min(80, record.splitRatio))
  }

  return out
}

export function loadPrefs(): WorkspacePrefs {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(stored) as unknown
    if (parsed === null || typeof parsed !== 'object') return { ...DEFAULT_PREFS }
    const envelope = parsed as Record<string, unknown>
    if (envelope.version !== VERSION) return { ...DEFAULT_PREFS }
    return { ...DEFAULT_PREFS, ...decode(envelope.state) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(prefs: WorkspacePrefs): void {
  try {
    // Rebuilt key by key from the allowlist, so a future field added to the
    // state object cannot leak by accident.
    const state: WorkspacePrefs = {
      autoDecode: prefs.autoDecode,
      rawView: prefs.rawView,
      follow: prefs.follow,
      showOffsetColumn: prefs.showOffsetColumn,
      showTypeColumn: prefs.showTypeColumn,
      showLenColumn: prefs.showLenColumn,
      showFmtColumn: prefs.showFmtColumn,
      presentOnly: prefs.presentOnly,
      errorsOnly: prefs.errorsOnly,
      autoDetect: prefs.autoDetect,
      includeHeaderOnBuild: prefs.includeHeaderOnBuild,
      headerMode: prefs.headerMode,
      headerSize: prefs.headerSize,
      headerSizeLocked: prefs.headerSizeLocked,
      splitRatio: prefs.splitRatio,
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, state }))
  } catch {
    // Private mode or quota. A lost layout preference is not worth an error.
  }
}
