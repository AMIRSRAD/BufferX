/**
 * Preferences owned by the Settings tool (UX_SPEC 3.9).
 *
 * `@/store/settings` owns the four shell-wide switches (theme, density, rail
 * labels, legacy engine) because the shell reads them on every frame. Everything
 * else Settings 3.9 asks for -- UI scale, monospace face, reduced-motion
 * override, field-colour palette, the framing defaults for *new* buffers,
 * autosave-drafts, the idle-wipe timeout, PAN masking and the recent-buffer list
 * -- lives here, next to the panel that edits it. Nothing else in the app has to
 * know these exist until it wants one.
 *
 * **Persistence.** UX_SPEC 5.5 is allowlist-only, so this module reproduces the
 * three guarantees of `@/store/persist` rather than persisting a store blob:
 *
 *  1. a hand-written `PERSISTED_KEYS` list -- the default is *drop*;
 *  2. a load-time assertion, using the shared `isForbiddenKey`, that no
 *     secret-shaped key name was listed;
 *  3. a write-time `scrubForPersist` pass over the payload.
 *
 * It writes its own `bufferx.preferences` entry because `STORAGE_KEYS` is owned
 * by the store layer and this tool may not edit it. When the store layer is next
 * touched, `preferences: 'bufferx.preferences'` should be added there and the
 * two helpers below replaced with `persistence<PreferencesState>()`.
 *
 * Nothing here is or may become secret material: there is no key, PIN, PAN or
 * PEM in this file, only booleans, enums, small numbers and file *paths*
 * (explicitly permitted by 5.5).
 */

import { create } from 'zustand'
import { isForbiddenKey, scrubForPersist } from '@/store/persist'
import { useSettings, type Theme } from '@/store/settings'

/* ── Value types ─────────────────────────────────────────────────────────── */

/** Appearance → Theme. `system` follows the OS and is resolved into `@/store/settings`. */
export type ThemeSource = 'system' | 'dark' | 'light'

/** Appearance → Reduce motion. `system` defers to `prefers-reduced-motion`. */
export type MotionPreference = 'system' | 'always'

/** Framing defaults → Header mode. The raw pane additionally offers `none`. */
export type HeaderMode = 'ascii' | 'binary'

export interface FramingDefaults {
  /** `Auto-detect decode`. Default on. */
  autoDetect: boolean
  /** `Include on build`. Default off. */
  includeOnBuild: boolean
  mode: HeaderMode
  /** 1..8, default 4. */
  size: number
}

/** One entry of the Buffers → Recent list. Paths only; never contents. */
export interface RecentBuffer {
  /** Stable id, so pin/remove work when two files share a basename. */
  id: string
  /** Display name -- the file basename. */
  name: string
  /**
   * Absolute path on desktop, `null` on web where the browser never reveals
   * one. A `null` path means the entry cannot be reopened (UX_SPEC 5.7).
   */
  path: string | null
  /** Epoch millis of the last open or save. */
  at: number
  /** Pinned entries sort first and survive the size cap. */
  pinned: boolean
}

/** Monospace faces offered in Appearance. `system` clears the override. */
export interface MonoFace {
  id: string
  label: string
  /** Full stack, or `null` to fall back to the design-system default. */
  stack: string | null
}

const FALLBACK_MONO = '"DejaVu Sans Mono", ui-monospace, monospace'

export const MONO_FACES: readonly MonoFace[] = [
  { id: 'system', label: 'Design default (IBM Plex Mono)', stack: null },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: `"JetBrains Mono", ${FALLBACK_MONO}` },
  { id: 'plex', label: 'IBM Plex Mono', stack: `"IBM Plex Mono", ${FALLBACK_MONO}` },
  { id: 'cascadia', label: 'Cascadia Mono', stack: `"Cascadia Mono", "Cascadia Code", ${FALLBACK_MONO}` },
  { id: 'consolas', label: 'Consolas', stack: `Consolas, ${FALLBACK_MONO}` },
  { id: 'menlo', label: 'Menlo / SF Mono', stack: `Menlo, "SF Mono", ${FALLBACK_MONO}` },
  { id: 'ui-monospace', label: 'Browser monospace', stack: 'ui-monospace, monospace' },
]

export const UI_SCALE_MIN = 90
export const UI_SCALE_MAX = 150
export const HEADER_SIZE_MIN = 1
export const HEADER_SIZE_MAX = 8
export const IDLE_WIPE_MIN = 1
export const IDLE_WIPE_MAX = 120
export const RECENT_LIMIT = 12

/* ── State ───────────────────────────────────────────────────────────────── */

export interface PreferencesState {
  themeSource: ThemeSource
  /** Percent, 90..150. Applied as the root font size, so every rem token scales. */
  uiScale: number
  /** A `MONO_FACES` id. */
  monoFace: string
  reduceMotion: MotionPreference
  /** Field/byte colour coding in the ribbon and hex view. Default on. */
  fieldColors: boolean
  /** Defaults handed to *new* buffers; each tab then owns its own framing. */
  framing: FramingDefaults
  /** Keep a draft of unsaved buffers (UX_SPEC 5.5). Default on. */
  autosaveDrafts: boolean
  /** Minutes of inactivity before secrets are wiped, or `null` for off. */
  idleWipeMinutes: number | null
  /** Mask all but the last four digits of PAN-shaped values in the field table. */
  maskAccountNumbers: boolean
  recents: RecentBuffer[]
  /** Path of the packager XML last loaded from disk. `null` on web. */
  packagerPath: string | null

  /**
   * File path per open buffer tab, keyed by tab id. Not persisted: tab ids are
   * per-session, so a stored map would only ever be stale.
   */
  bufferPaths: Record<string, string>

  setThemeSource(source: ThemeSource): void
  setUiScale(scale: number): void
  setMonoFace(id: string): void
  setReduceMotion(preference: MotionPreference): void
  setFieldColors(enabled: boolean): void
  setFraming(patch: Partial<FramingDefaults>): void
  setAutosaveDrafts(enabled: boolean): void
  setIdleWipeMinutes(minutes: number | null): void
  setMaskAccountNumbers(enabled: boolean): void
  rememberRecent(entry: { name: string; path: string | null }): void
  toggleRecentPin(id: string): void
  removeRecent(id: string): void
  clearRecents(): void
  setPackagerPath(path: string | null): void
  setBufferPath(bufferId: string, path: string | null): void
  resetAppearance(): void
}

export const PREFERENCES_PERSISTED_KEYS = [
  'themeSource',
  'uiScale',
  'monoFace',
  'reduceMotion',
  'fieldColors',
  'framing',
  'autosaveDrafts',
  'idleWipeMinutes',
  'maskAccountNumbers',
  'recents',
  'packagerPath',
] as const

export type PreferencesPersistedKey = (typeof PREFERENCES_PERSISTED_KEYS)[number]

for (const key of PREFERENCES_PERSISTED_KEYS) {
  if (isForbiddenKey(key)) {
    throw new Error(
      `Settings declared "${key}" as persistable, but that name is reserved for secret ` +
        'material and can never be written to storage (UX_SPEC 5.5).',
    )
  }
}

export const PREFERENCES_STORAGE_KEY = 'bufferx.preferences'
const PREFERENCES_VERSION = 1

export const DEFAULT_FRAMING: FramingDefaults = {
  autoDetect: true,
  includeOnBuild: false,
  mode: 'ascii',
  size: 4,
}

const DEFAULTS: Pick<PreferencesState, PreferencesPersistedKey> = {
  themeSource: 'dark',
  uiScale: 100,
  monoFace: 'system',
  reduceMotion: 'system',
  fieldColors: true,
  framing: DEFAULT_FRAMING,
  autosaveDrafts: true,
  idleWipeMinutes: 15,
  maskAccountNumbers: false,
  recents: [],
  packagerPath: null,
}

/* ── Storage ─────────────────────────────────────────────────────────────── */

function safeStorage(): Storage | null {
  try {
    return (globalThis.localStorage as Storage | undefined) ?? null
  } catch {
    return null
  }
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULTS.uiScale
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(value)))
}

export function clampHeaderSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FRAMING.size
  return Math.min(HEADER_SIZE_MAX, Math.max(HEADER_SIZE_MIN, Math.round(value)))
}

export function clampIdleMinutes(value: number): number {
  if (!Number.isFinite(value)) return 15
  return Math.min(IDLE_WIPE_MAX, Math.max(IDLE_WIPE_MIN, Math.round(value)))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeFraming(raw: unknown): FramingDefaults | undefined {
  if (!isPlainObject(raw)) return undefined
  const mode = raw.mode === 'binary' ? 'binary' : 'ascii'
  return {
    autoDetect: typeof raw.autoDetect === 'boolean' ? raw.autoDetect : DEFAULT_FRAMING.autoDetect,
    includeOnBuild:
      typeof raw.includeOnBuild === 'boolean' ? raw.includeOnBuild : DEFAULT_FRAMING.includeOnBuild,
    mode,
    size: typeof raw.size === 'number' ? clampHeaderSize(raw.size) : DEFAULT_FRAMING.size,
  }
}

function decodeRecents(raw: unknown): RecentBuffer[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: RecentBuffer[] = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    if (typeof item.name !== 'string' || item.name === '') continue
    const path = typeof item.path === 'string' && item.path !== '' ? item.path : null
    out.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : `${item.name}:${String(item.at ?? '')}`,
      name: item.name,
      path,
      at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : 0,
      pinned: item.pinned === true,
    })
    if (out.length >= RECENT_LIMIT) break
  }
  return out
}

function loadPersisted(): Partial<Pick<PreferencesState, PreferencesPersistedKey>> {
  const storage = safeStorage()
  if (!storage) return {}
  let parsed: unknown
  try {
    const rawEntry = storage.getItem(PREFERENCES_STORAGE_KEY)
    if (rawEntry === null) return {}
    parsed = JSON.parse(rawEntry)
  } catch {
    return {}
  }
  if (!isPlainObject(parsed) || parsed.v !== PREFERENCES_VERSION || !isPlainObject(parsed.data)) {
    return {}
  }
  const raw = parsed.data
  const next: Partial<Pick<PreferencesState, PreferencesPersistedKey>> = {}

  if (raw.themeSource === 'system' || raw.themeSource === 'dark' || raw.themeSource === 'light') {
    next.themeSource = raw.themeSource
  }
  if (typeof raw.uiScale === 'number') next.uiScale = clampScale(raw.uiScale)
  if (typeof raw.monoFace === 'string' && MONO_FACES.some((face) => face.id === raw.monoFace)) {
    next.monoFace = raw.monoFace
  }
  if (raw.reduceMotion === 'system' || raw.reduceMotion === 'always') next.reduceMotion = raw.reduceMotion
  if (typeof raw.fieldColors === 'boolean') next.fieldColors = raw.fieldColors
  const framing = decodeFraming(raw.framing)
  if (framing) next.framing = framing
  if (typeof raw.autosaveDrafts === 'boolean') next.autosaveDrafts = raw.autosaveDrafts
  if (raw.idleWipeMinutes === null) next.idleWipeMinutes = null
  else if (typeof raw.idleWipeMinutes === 'number') next.idleWipeMinutes = clampIdleMinutes(raw.idleWipeMinutes)
  if (typeof raw.maskAccountNumbers === 'boolean') next.maskAccountNumbers = raw.maskAccountNumbers
  const recents = decodeRecents(raw.recents)
  if (recents) next.recents = recents
  if (raw.packagerPath === null) next.packagerPath = null
  else if (typeof raw.packagerPath === 'string') next.packagerPath = raw.packagerPath

  return next
}

function savePersisted(state: Readonly<PreferencesState>): void {
  const storage = safeStorage()
  if (!storage) return
  const picked: Record<string, unknown> = {}
  for (const key of PREFERENCES_PERSISTED_KEYS) picked[key] = state[key]
  const { value } = scrubForPersist(picked)
  try {
    storage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ v: PREFERENCES_VERSION, data: value }))
  } catch {
    /* Quota exceeded or storage disabled: a lost preference is not an error. */
  }
}

/** Exposed so `Reset appearance` and tests can drop the entry outright. */
export function clearPersistedPreferences(): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.removeItem(PREFERENCES_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/* ── Document side effects ───────────────────────────────────────────────── */

const ROOT_FONT_PX = 16

/**
 * Writes the appearance preferences onto `<html>`.
 *
 * `data-motion` and `data-field-colors` are consumed by `./settings.css`;
 * `--font-mono` and the root font size are read by the token file directly.
 */
export function applyAppearance(state: Readonly<PreferencesState>): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return

  root.style.fontSize = `${(ROOT_FONT_PX * state.uiScale) / 100}px`

  const face = MONO_FACES.find((candidate) => candidate.id === state.monoFace)
  if (face?.stack) root.style.setProperty('--font-mono', face.stack)
  else root.style.removeProperty('--font-mono')

  root.dataset.motion = state.reduceMotion === 'always' ? 'reduced' : 'system'
  root.dataset.fieldColors = state.fieldColors ? 'on' : 'off'
}

function prefersLight(): boolean {
  try {
    if (typeof globalThis.matchMedia !== 'function') return false
    return globalThis.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

/** The concrete theme a `themeSource` resolves to right now. */
export function resolveTheme(source: ThemeSource): Theme {
  if (source === 'dark' || source === 'light') return source
  return prefersLight() ? 'light' : 'dark'
}

/* ── Store ───────────────────────────────────────────────────────────────── */

const initial: Pick<PreferencesState, PreferencesPersistedKey> = { ...DEFAULTS, ...loadPersisted() }

export const usePreferences = create<PreferencesState>()((set, get) => ({
  ...initial,
  bufferPaths: {},

  setThemeSource(source) {
    if (get().themeSource === source) return
    set({ themeSource: source })
    useSettings.getState().setTheme(resolveTheme(source))
  },

  setUiScale(scale) {
    const next = clampScale(scale)
    if (get().uiScale === next) return
    set({ uiScale: next })
  },

  setMonoFace(id) {
    if (!MONO_FACES.some((face) => face.id === id)) return
    if (get().monoFace === id) return
    set({ monoFace: id })
  },

  setReduceMotion(preference) {
    if (get().reduceMotion === preference) return
    set({ reduceMotion: preference })
  },

  setFieldColors(enabled) {
    if (get().fieldColors === enabled) return
    set({ fieldColors: enabled })
  },

  setFraming(patch) {
    const current = get().framing
    const next: FramingDefaults = {
      ...current,
      ...patch,
      ...(patch.size === undefined ? {} : { size: clampHeaderSize(patch.size) }),
    }
    if (
      next.autoDetect === current.autoDetect &&
      next.includeOnBuild === current.includeOnBuild &&
      next.mode === current.mode &&
      next.size === current.size
    ) {
      return
    }
    set({ framing: next })
  },

  setAutosaveDrafts(enabled) {
    if (get().autosaveDrafts === enabled) return
    set({ autosaveDrafts: enabled })
  },

  setIdleWipeMinutes(minutes) {
    const next = minutes === null ? null : clampIdleMinutes(minutes)
    if (get().idleWipeMinutes === next) return
    set({ idleWipeMinutes: next })
  },

  setMaskAccountNumbers(enabled) {
    if (get().maskAccountNumbers === enabled) return
    set({ maskAccountNumbers: enabled })
  },

  rememberRecent(entry) {
    const at = Date.now()
    const id = entry.path ?? `${entry.name}#${String(at)}`
    const without = get().recents.filter((item) => item.id !== id)
    const previous = get().recents.find((item) => item.id === id)
    const next: RecentBuffer = {
      id,
      name: entry.name,
      path: entry.path,
      at,
      pinned: previous?.pinned ?? false,
    }
    const merged = [next, ...without]
    const pinned = merged.filter((item) => item.pinned)
    const loose = merged.filter((item) => !item.pinned).slice(0, Math.max(0, RECENT_LIMIT - pinned.length))
    set({ recents: [...pinned, ...loose].sort((a, b) => b.at - a.at) })
  },

  toggleRecentPin(id) {
    set({
      recents: get().recents.map((item) => (item.id === id ? { ...item, pinned: !item.pinned } : item)),
    })
  },

  removeRecent(id) {
    set({ recents: get().recents.filter((item) => item.id !== id) })
  },

  /** Drops unpinned entries. Pinning is the operator's "keep this" signal. */
  clearRecents() {
    const kept = get().recents.filter((item) => item.pinned)
    if (kept.length === get().recents.length) return
    set({ recents: kept })
  },

  setPackagerPath(path) {
    if (get().packagerPath === path) return
    set({ packagerPath: path })
  },

  setBufferPath(bufferId, path) {
    const current = get().bufferPaths
    if (path === null) {
      if (!(bufferId in current)) return
      const next = { ...current }
      delete next[bufferId]
      set({ bufferPaths: next })
      return
    }
    if (current[bufferId] === path) return
    set({ bufferPaths: { ...current, [bufferId]: path } })
  },

  resetAppearance() {
    set({
      themeSource: DEFAULTS.themeSource,
      uiScale: DEFAULTS.uiScale,
      monoFace: DEFAULTS.monoFace,
      reduceMotion: DEFAULTS.reduceMotion,
      fieldColors: DEFAULTS.fieldColors,
    })
    useSettings.getState().setTheme(resolveTheme(DEFAULTS.themeSource))
  },
}))

// Applied once at module load so the first painted frame already carries the
// stored scale, face and motion mode.
applyAppearance(usePreferences.getState())

/** One subscription owns every side effect, so no action can forget one. */
usePreferences.subscribe((state, previous) => {
  if (
    state.uiScale !== previous.uiScale ||
    state.monoFace !== previous.monoFace ||
    state.reduceMotion !== previous.reduceMotion ||
    state.fieldColors !== previous.fieldColors
  ) {
    applyAppearance(state)
  }
  const changed = PREFERENCES_PERSISTED_KEYS.some((key) => state[key] !== previous[key])
  if (changed) savePersisted(state)
})

/**
 * Keeps `theme = system` honest when the OS flips at runtime.
 *
 * Installed at module load rather than from an effect: the panel is lazy and
 * usually closed, and the preference has to hold whether or not it is open.
 */
function watchSystemTheme(): void {
  if (typeof globalThis.matchMedia !== 'function') return
  let query: MediaQueryList
  try {
    query = globalThis.matchMedia('(prefers-color-scheme: light)')
  } catch {
    return
  }
  const onChange = () => {
    if (usePreferences.getState().themeSource !== 'system') return
    useSettings.getState().setTheme(resolveTheme('system'))
  }
  if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange)
  else if (typeof query.addListener === 'function') query.addListener(onChange)
}

watchSystemTheme()

// A stored `system` source must win over the theme the settings store hydrated
// from its own entry, otherwise the two disagree until the user touches a
// control.
if (initial.themeSource === 'system') {
  useSettings.getState().setTheme(resolveTheme('system'))
}
