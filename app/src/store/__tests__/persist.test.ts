import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_KEYS,
  assertPersistable,
  isForbiddenKey,
  persistence,
  scrubForPersist,
  tokenizeKey,
} from '@/store/persist'

/**
 * The persistence helper is the enforcement point for UX_SPEC 5.5. If these
 * tests pass, no store can leak a secret to storage by omission -- only by
 * deliberately naming a key that does not look like a secret and putting a
 * secret in it, which is a review problem, not a design one.
 */
describe('persist: secret-shaped key detection', () => {
  it('splits every common naming style into word tokens', () => {
    expect(tokenizeKey('macKey')).toEqual(['mac', 'key'])
    expect(tokenizeKey('pin_block')).toEqual(['pin', 'block'])
    expect(tokenizeKey('RSA-PEM')).toEqual(['rsa', 'pem'])
    expect(tokenizeKey('railLabeled')).toEqual(['rail', 'labeled'])
    expect(tokenizeKey('PVKValue')).toEqual(['pvk', 'value'])
  })

  it('rejects every secret named in UX_SPEC 5.5', () => {
    for (const key of [
      'pin',
      'clearPin',
      'pinBlock',
      'encryptedPinBlock',
      'pan',
      'macKey',
      'aesKey',
      'destinationKey',
      'pvk',
      'privateKeyPem',
      'secret',
      'password',
      'iv',
      'kcv',
      'track2',
      'ciphertext',
      'recovered_plaintext',
    ]) {
      expect(isForbiddenKey(key), `${key} must be rejected`).toBe(true)
    }
  })

  it('allows the non-secret state the spec explicitly permits', () => {
    for (const key of [
      'theme',
      'density',
      'railLabeled',
      'legacyEngine',
      'open',
      'panelWidth', // must not trip on the "pan" token
      'macFieldId', // 5.5 permits persisting the MAC field id
      'macPadding',
      'includeHeader',
      'dockWidth',
      'columnWidths',
      'blockedHosts', // "blocked" is not "block"
    ]) {
      expect(isForbiddenKey(key), `${key} must be allowed`).toBe(false)
    }
  })
})

describe('persist: payload scrubbing', () => {
  it('drops secret-shaped keys at any depth and reports where they were', () => {
    const { value, dropped } = scrubForPersist({
      theme: 'dark',
      tool: { macFieldId: 64, macKey: 'A1B2C3D4' },
      runs: [{ algorithm: 'AES-128-CBC', key: 'DEADBEEF' }],
    })

    expect(value).toEqual({
      theme: 'dark',
      tool: { macFieldId: 64 },
      runs: [{ algorithm: 'AES-128-CBC' }],
    })
    expect(dropped.map((entry) => entry.path)).toEqual(['tool.macKey', 'runs[0].key'])
  })

  it('treats array elements as values, not key names', () => {
    // The tools store legitimately persists ["pin", "mac"] as *ids*.
    const { value, dropped } = scrubForPersist({ open: ['pin', 'mac', 'crypto'] })
    expect(value).toEqual({ open: ['pin', 'mac', 'crypto'] })
    expect(dropped).toHaveLength(0)
  })

  it('assertPersistable throws with the offending paths', () => {
    expect(() => assertPersistable({ theme: 'dark' })).not.toThrow()
    expect(() => assertPersistable({ nested: { pvk: 'x' } }, 'settings')).toThrow(/nested\.pvk/)
  })
})

describe('persist: allowlisted binding', () => {
  interface Fixture {
    theme: string
    density: string
    ephemeral: string
  }

  beforeEach(() => {
    localStorage.clear()
  })

  const build = () =>
    persistence<Fixture>()({
      key: STORAGE_KEYS.tools,
      version: 1,
      allow: ['theme', 'density'],
      decode: (raw) => {
        const next: Partial<Pick<Fixture, 'theme' | 'density'>> = {}
        if (typeof raw.theme === 'string') next.theme = raw.theme
        if (typeof raw.density === 'string') next.density = raw.density
        return next
      },
    })

  it('writes only the allowlisted keys', () => {
    const binding = build()
    binding.save({ theme: 'dark', density: 'dense', ephemeral: 'must not be written' })

    const raw = localStorage.getItem(STORAGE_KEYS.tools)
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('must not be written')
    expect(JSON.parse(raw ?? '{}')).toEqual({ v: 1, data: { theme: 'dark', density: 'dense' } })
  })

  it('refuses at construction to build a binding that names a secret', () => {
    expect(() =>
      persistence<{ macKey: string }>()({
        key: STORAGE_KEYS.tools,
        allow: ['macKey'],
        decode: () => ({}),
      }),
    ).toThrow(/secret material/)
  })

  it('drops a secret nested inside an allowlisted key rather than writing it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const binding = persistence<{ profile: Record<string, unknown> }>()({
      key: STORAGE_KEYS.tools,
      allow: ['profile'],
      decode: () => ({}),
    })

    binding.save({ profile: { host: '10.20.30.40', key: 'A1B2C3D4E5F60718' } })

    const raw = localStorage.getItem(STORAGE_KEYS.tools) ?? ''
    expect(raw).toContain('10.20.30.40')
    expect(raw).not.toContain('A1B2C3D4E5F60718')
    // The warning names the path, never the value.
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('A1B2C3D4E5F60718')
    warn.mockRestore()
  })

  it('validates on read: unknown keys, wrong types and bad versions are discarded', () => {
    const binding = build()

    localStorage.setItem(
      STORAGE_KEYS.tools,
      JSON.stringify({ v: 1, data: { theme: 'dark', density: 42, injected: 'nope' } }),
    )
    expect(binding.load()).toEqual({ theme: 'dark' })

    localStorage.setItem(STORAGE_KEYS.tools, JSON.stringify({ v: 99, data: { theme: 'light' } }))
    expect(binding.load()).toEqual({})

    localStorage.setItem(STORAGE_KEYS.tools, 'not json at all')
    expect(binding.load()).toEqual({})

    localStorage.removeItem(STORAGE_KEYS.tools)
    expect(binding.load()).toEqual({})
  })

  it('round-trips through save and load', () => {
    const binding = build()
    binding.save({ theme: 'light', density: 'comfortable', ephemeral: 'x' })
    expect(binding.load()).toEqual({ theme: 'light', density: 'comfortable' })

    binding.clear()
    expect(localStorage.getItem(STORAGE_KEYS.tools)).toBeNull()
  })
})
