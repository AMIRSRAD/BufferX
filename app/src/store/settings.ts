import { create } from 'zustand'
import {
  STORAGE_KEYS,
  persistence,
  readRawEntry,
  writeRawEntry,
} from './persist'

/**
 * Appearance and shell preferences.
 *
 * This is the only store that touches the DOM. `data-theme` and `data-density`
 * on `<html>` are the single source of truth for every token in
 * `@/styles/app.css` (DESIGN_SYSTEM 1.1 and 3.5), so the store writes them on
 * hydration and on every change -- components never resolve a colour or a
 * density themselves.
 */

export type Theme = 'dark' | 'light'
export type Density = 'dense' | 'comfortable'

export interface SettingsState {
  /** Drives `data-theme`. Dark is the default and the fallback. */
  theme: Theme
  /** Drives `data-density`. Affects height and padding only (DESIGN_SYSTEM 3.5). */
  density: Density
  /** Left rail shows labels (208px) rather than icons only (52px). */
  railLabeled: boolean
  /** Legacy ATM framing engine. A Switch, not a Checkbox (DESIGN_SYSTEM 4.7). */
  legacyEngine: boolean

  setTheme(theme: Theme): void
  setDensity(density: Density): void
  toggleRail(): void
  setLegacyEngine(enabled: boolean): void
}

/**
 * The complete set of settings written to storage. Adding a field to
 * `SettingsState` does *not* persist it; it has to be named here as well.
 */
export const SETTINGS_PERSISTED_KEYS = ['theme', 'density', 'railLabeled', 'legacyEngine'] as const

export type SettingsPersistedKey = (typeof SETTINGS_PERSISTED_KEYS)[number]

const persisted = persistence<SettingsState>()({
  key: STORAGE_KEYS.settings,
  version: 2,
  allow: SETTINGS_PERSISTED_KEYS,
  /**
   * v1 → v2: retire the stored `railLabeled`.
   *
   * The rail shipped icon-only, so `railLabeled: false` was written to storage
   * the first time an operator changed *any* setting — theme, density,
   * anything. That recorded a default as though it were a decision, and once
   * stored it outranked the new default forever. Dropping just this key lets
   * the current default apply once; everything else is carried across, because
   * changing one default should not reset a person's theme.
   */
  migrate: (data, from) => {
    if (from !== 1) return {}
    const { railLabeled: _retired, ...rest } = data
    return rest
  },
  decode: (raw) => {
    const next: Partial<Pick<SettingsState, SettingsPersistedKey>> = {}
    if (raw.theme === 'dark' || raw.theme === 'light') next.theme = raw.theme
    if (raw.density === 'dense' || raw.density === 'comfortable') next.density = raw.density
    if (typeof raw.railLabeled === 'boolean') next.railLabeled = raw.railLabeled
    if (typeof raw.legacyEngine === 'boolean') next.legacyEngine = raw.legacyEngine
    return next
  },
})

/** True when the OS asks for a light UI. Safe where `matchMedia` is absent. */
function prefersLightTheme(): boolean {
  try {
    if (typeof globalThis.matchMedia !== 'function') return false
    return globalThis.matchMedia('(prefers-color-scheme: light)').matches
  } catch {
    return false
  }
}

/**
 * Writes theme and density onto `<html>`.
 *
 * Exported so a shell or a test can force a re-apply after replacing the
 * document element.
 */
export function applyDocumentSettings(theme: Theme, density: Density): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  root.dataset.theme = theme
  root.dataset.density = density
}

/**
 * Mirrors the theme into the plain-string key that `app/index.html` reads
 * before first paint. Without this the shell flashes dark on a light-theme
 * reload; the bootstrap cannot parse our JSON envelope because it must stay a
 * few lines of dependency-free script in `<head>`.
 */
function writeThemeBootstrapMirror(theme: Theme): void {
  writeRawEntry(STORAGE_KEYS.theme, theme)
}

/** Reads the pre-paint bootstrap mirror, used only as a hydration fallback. */
function readThemeBootstrapMirror(): Theme | null {
  const raw = readRawEntry(STORAGE_KEYS.theme)
  return raw === 'dark' || raw === 'light' ? raw : null
}

const DEFAULTS: Pick<SettingsState, SettingsPersistedKey> = {
  theme: 'dark',
  density: 'dense',
  // Names on by default. Twelve destinations reduced to twelve glyphs asks the
  // operator to learn an icon vocabulary before they can navigate, and several
  // of these (MAC, PIN, Crypto, RSA) have no conventional icon to learn. The
  // rail can still be collapsed from its own footer or Settings.
  railLabeled: true,
  legacyEngine: false,
}

/**
 * Resolves the boot state.
 *
 * Theme precedence is deliberate: the JSON entry wins, then the pre-paint
 * mirror (covers a cleared or version-bumped settings entry, so the theme the
 * user is *looking at* does not change out from under them), then the OS
 * preference, then dark.
 */
function hydrate(): Pick<SettingsState, SettingsPersistedKey> {
  const stored = persisted.load()
  const theme = stored.theme ?? readThemeBootstrapMirror() ?? (prefersLightTheme() ? 'light' : 'dark')
  return {
    theme,
    density: stored.density ?? DEFAULTS.density,
    railLabeled: stored.railLabeled ?? DEFAULTS.railLabeled,
    legacyEngine: stored.legacyEngine ?? DEFAULTS.legacyEngine,
  }
}

const initial = hydrate()

// Applied at module load, before React renders, so the first painted frame is
// already correct. The bootstrap in index.html has set `data-theme` by now but
// knows nothing about density.
applyDocumentSettings(initial.theme, initial.density)
writeThemeBootstrapMirror(initial.theme)

export const useSettings = create<SettingsState>()((set, get) => ({
  ...initial,

  setTheme(theme) {
    if (get().theme === theme) return
    set({ theme })
  },

  setDensity(density) {
    if (get().density === density) return
    set({ density })
  },

  toggleRail() {
    set({ railLabeled: !get().railLabeled })
  },

  setLegacyEngine(enabled) {
    if (get().legacyEngine === enabled) return
    set({ legacyEngine: enabled })
  },
}))

/**
 * One subscription owns every side effect, so no action can forget to apply or
 * to persist -- including `setState` calls made directly by tests or devtools.
 */
useSettings.subscribe((state, previous) => {
  if (state.theme !== previous.theme || state.density !== previous.density) {
    applyDocumentSettings(state.theme, state.density)
  }
  if (state.theme !== previous.theme) {
    writeThemeBootstrapMirror(state.theme)
  }
  const changed = SETTINGS_PERSISTED_KEYS.some((key) => state[key] !== previous[key])
  if (changed) persisted.save(state)
})

/** Exposed for tests and for a future "reset preferences" command. */
export const settingsPersistence = persisted
