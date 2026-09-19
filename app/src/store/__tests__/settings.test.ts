import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/store/persist'
import { SETTINGS_PERSISTED_KEYS, useSettings } from '@/store/settings'

/**
 * Reproduces the pre-paint bootstrap in `app/index.html` exactly, so a change
 * to the settings store that breaks the no-flash guarantee fails here rather
 * than in a reviewer's eye.
 */
function runIndexHtmlBootstrap(): string {
  const stored = localStorage.getItem(STORAGE_KEYS.theme)
  const theme = stored === 'light' || stored === 'dark' ? stored : 'dark'
  document.documentElement.dataset.theme = theme
  return theme
}

const INITIAL = useSettings.getState()

describe('settings: DOM application', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState(INITIAL, true)
    document.documentElement.dataset.theme = INITIAL.theme
    document.documentElement.dataset.density = INITIAL.density
  })

  it('writes data-theme onto documentElement when the theme changes', () => {
    useSettings.getState().setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    useSettings.getState().setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('writes data-density onto documentElement when the density changes', () => {
    useSettings.getState().setDensity('comfortable')
    expect(document.documentElement.dataset.density).toBe('comfortable')

    useSettings.getState().setDensity('dense')
    expect(document.documentElement.dataset.density).toBe('dense')
  })

  it('applies on any state change, including a direct setState', () => {
    useSettings.setState({ theme: 'light', density: 'comfortable' })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('toggles the rail and stores the legacy engine switch', () => {
    const before = useSettings.getState().railLabeled
    useSettings.getState().toggleRail()
    expect(useSettings.getState().railLabeled).toBe(!before)

    useSettings.getState().setLegacyEngine(true)
    expect(useSettings.getState().legacyEngine).toBe(true)
  })
})

describe('settings: persistence allowlist', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState(INITIAL, true)
  })

  it('persists exactly the four allowlisted keys and nothing else', () => {
    useSettings.getState().setTheme('light')
    useSettings.getState().setDensity('comfortable')
    useSettings.getState().toggleRail()
    useSettings.getState().setLegacyEngine(true)

    const raw = localStorage.getItem(STORAGE_KEYS.settings)
    expect(raw).not.toBeNull()

    const parsed = JSON.parse(raw ?? '{}') as { v: number; data: Record<string, unknown> }
    expect(parsed.v).toBe(2)
    expect(Object.keys(parsed.data).sort()).toEqual([...SETTINGS_PERSISTED_KEYS].sort())
    expect(parsed.data).toEqual({
      theme: 'light',
      density: 'comfortable',
      // Expressed as "the toggle flipped it" rather than a literal, so this
      // asserts the allowlist rather than the shipped default.
      railLabeled: !INITIAL.railLabeled,
      legacyEngine: true,
    })
  })

  it('never serialises the store actions', () => {
    useSettings.getState().setTheme('light')
    const raw = localStorage.getItem(STORAGE_KEYS.settings) ?? ''
    for (const action of ['setTheme', 'setDensity', 'toggleRail', 'setLegacyEngine']) {
      expect(raw).not.toContain(action)
    }
  })

  it('writes only its own two keys', () => {
    useSettings.getState().setTheme('light')
    useSettings.getState().setDensity('comfortable')

    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key !== null) keys.push(key)
    }
    expect(keys.sort()).toEqual([STORAGE_KEYS.settings, STORAGE_KEYS.theme].sort())
  })
})

describe('settings: pre-paint bootstrap compatibility', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettings.setState(INITIAL, true)
  })

  it('mirrors the theme into the plain-string key index.html reads', () => {
    useSettings.getState().setTheme('light')
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('light')

    useSettings.getState().setTheme('dark')
    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('dark')
  })

  it('leaves storage in a state the bootstrap resolves to the same theme', () => {
    useSettings.getState().setTheme('light')

    document.documentElement.removeAttribute('data-theme')
    expect(runIndexHtmlBootstrap()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe(useSettings.getState().theme)
  })
})

describe('settings: hydration', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-density')
    vi.resetModules()
  })

  it('restores persisted settings and applies them at import time', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        v: 1,
        data: { theme: 'light', density: 'comfortable', railLabeled: true, legacyEngine: true },
      }),
    )

    const { useSettings: hydrated } = await import('@/store/settings')

    // Applied as a module side effect, before any component renders.
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.density).toBe('comfortable')

    const state = hydrated.getState()
    expect(state.theme).toBe('light')
    expect(state.density).toBe('comfortable')
    expect(state.railLabeled).toBe(true)
    expect(state.legacyEngine).toBe(true)
  })

  it('falls back to the bootstrap mirror when the settings entry is gone', async () => {
    localStorage.setItem(STORAGE_KEYS.theme, 'light')

    const { useSettings: hydrated } = await import('@/store/settings')

    expect(hydrated.getState().theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    // Density has no mirror, so it falls back to the designed default.
    expect(hydrated.getState().density).toBe('dense')
  })

  it('ignores a corrupted or hand-edited entry instead of adopting it', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: 1, data: { theme: 'neon', density: 7, railLabeled: 'yes' } }),
    )

    const { useSettings: hydrated } = await import('@/store/settings')
    const state = hydrated.getState()

    expect(state.theme).toBe('dark')
    expect(state.density).toBe('dense')
    // `'yes'` is not a boolean, so the shipped default stands. Sidebar names
    // are on by default: twelve destinations as twelve unlabelled glyphs asks
    // the operator to learn an icon vocabulary before they can navigate.
    expect(state.railLabeled).toBe(true)
  })

  /**
   * The rail shipped icon-only, so `railLabeled: false` landed in storage the
   * first time an operator changed any setting at all — recording a default as
   * though it were a decision. When the default flipped, that stale entry kept
   * winning and the rail stayed icon-only. The v1 → v2 migration retires the
   * key without disturbing anything else.
   */
  it('retires the stale rail preference but keeps the rest of a v1 entry', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({
        v: 1,
        data: { theme: 'light', density: 'comfortable', railLabeled: false, legacyEngine: true },
      }),
    )

    vi.resetModules()
    const { useSettings: hydrated } = await import('@/store/settings')
    const state = hydrated.getState()

    expect(state.railLabeled).toBe(true) // the current default now applies
    expect(state.theme).toBe('light') // and the real choices survive
    expect(state.density).toBe('comfortable')
    expect(state.legacyEngine).toBe(true)
  })

  it('still discards an entry from a version it cannot migrate', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: 99, data: { theme: 'light', density: 'comfortable' } }),
    )

    vi.resetModules()
    const { useSettings: hydrated } = await import('@/store/settings')
    const state = hydrated.getState()

    expect(state.theme).toBe('dark')
    expect(state.density).toBe('dense')
  })

  it('rewrites the bootstrap mirror on hydration so the two never drift', async () => {
    localStorage.setItem(
      STORAGE_KEYS.settings,
      JSON.stringify({ v: 1, data: { theme: 'light', density: 'dense' } }),
    )
    localStorage.setItem(STORAGE_KEYS.theme, 'dark')

    await import('@/store/settings')

    expect(localStorage.getItem(STORAGE_KEYS.theme)).toBe('light')
  })
})
