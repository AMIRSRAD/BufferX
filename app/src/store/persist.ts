/**
 * Allowlist-only persistence for BufferX state.
 *
 * UX_SPEC 5.5 and DESIGN_SYSTEM 0.5 make this a hard requirement, not a
 * convention: nothing reaches `localStorage` unless it was named, by hand, in
 * an `allow` list. There is deliberately no "persist the whole store" path and
 * no `partialize`-style *exclusion* list, because an exclusion list leaks every
 * field a future author forgets to add to it. Here the default is *drop*.
 *
 * Three layers of defence, in order of when they fire:
 *
 *  1. **Compile time** — `allow` is constrained to `keyof S`, so a key that is
 *     not part of the store cannot be listed.
 *  2. **Load time** — `createPersistence` throws the moment a store declares a
 *     secret-shaped key name. The app fails loudly at import, not in the field.
 *  3. **Write time** — every payload is walked and any nested object key whose
 *     name looks like a secret is dropped before it is serialised.
 *
 * Reads are validated too: a `decode` function is mandatory, so a hand-edited
 * or corrupted `localStorage` entry can never inject an arbitrary value into
 * application state.
 */

/**
 * Every `localStorage` key BufferX is permitted to write. Anything not listed
 * here is a bug.
 *
 * `theme` is a plain-string mirror, not JSON: `app/index.html` reads it in a
 * pre-paint bootstrap script to set `data-theme` before the first frame, and
 * that script must stay dependency-free. The settings store keeps it in sync
 * with the authoritative `settings` entry.
 */
export const STORAGE_KEYS = {
  settings: 'bufferx.settings',
  theme: 'bufferx.theme',
  tools: 'bufferx.tools',
  // The saved-buffer library holds a folder path and per-file annotations only.
  // The buffers themselves stay in the operator's own files -- see store/library.ts.
  library: 'bufferx.library',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

/**
 * Word tokens that may never appear in a persisted key name.
 *
 * Derived from the "NEVER persisted" list in UX_SPEC 5.5. Matching is done on
 * tokens rather than substrings so that innocent names survive: `panelWidth`
 * tokenises to `panel` + `width` and is allowed, while `pan`, `macKey` and
 * `pinBlock` are rejected.
 *
 * Note `mac` is absent on purpose -- 5.5 explicitly permits persisting the MAC
 * *field id*, *padding* and *include-header* selections. The MAC *key* is
 * caught by the `key` token instead.
 */
const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set([
  'pin',
  'pins',
  'pinblock',
  'pinblocks',
  'pan',
  'pans',
  'key',
  'keys',
  'keyfile',
  'keyfiles',
  'keymaterial',
  'pvk',
  'pvks',
  'pvv',
  'pem',
  'privatekey',
  'publickey',
  'secret',
  'secrets',
  'password',
  'passwd',
  'passphrase',
  'block',
  'blocks',
  'cipher',
  'ciphertext',
  'plaintext',
  'token',
  'tokens',
  'credential',
  'credentials',
  'cvv',
  'cvc',
  'track',
  'track1',
  'track2',
  'kcv',
  'iv',
])

/**
 * Splits an identifier into lower-case word tokens.
 *
 * Handles `camelCase`, `PascalCase`, `snake_case`, `kebab-case` and
 * `SCREAMING_CASE`, so one denylist covers every naming style a store might use.
 */
export function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 0)
    .map((token) => token.toLowerCase())
}

/** True when a key name is forbidden from persistence by UX_SPEC 5.5. */
export function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (FORBIDDEN_TOKENS.has(normalized)) return true
  return tokenizeKey(key).some((token) => FORBIDDEN_TOKENS.has(token))
}

/** A key that failed the secret check, with the path it was found at. */
export interface DroppedKey {
  path: string
  key: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-copies `value`, removing every object key whose name looks like a
 * secret. Array *elements* are traversed but never treated as key names -- the
 * tools store legitimately persists ids such as `"pin"` as list values.
 */
export function scrubForPersist(
  value: unknown,
  path = '',
  dropped: DroppedKey[] = [],
): { value: unknown; dropped: DroppedKey[] } {
  if (Array.isArray(value)) {
    const next = value.map((item, index) => scrubForPersist(item, `${path}[${index}]`, dropped).value)
    return { value: next, dropped }
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`
      if (isForbiddenKey(key)) {
        dropped.push({ path: childPath, key })
        continue
      }
      if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'undefined') continue
      next[key] = scrubForPersist(item, childPath, dropped).value
    }
    return { value: next, dropped }
  }

  return { value, dropped }
}

/**
 * Throws if `payload` contains any secret-shaped key at any depth.
 *
 * Exported so tests and future call sites can assert the rule directly. The
 * write path does not use this -- it drops instead of throwing, so a bug can
 * never take the app down, only cost a preference.
 */
export function assertPersistable(payload: unknown, label = 'payload'): void {
  const { dropped } = scrubForPersist(payload)
  if (dropped.length > 0) {
    const paths = dropped.map((entry) => entry.path).join(', ')
    throw new Error(
      `Refusing to persist ${label}: ${dropped.length} secret-shaped key(s) present (${paths}). ` +
        'Secrets are memory-only (UX_SPEC 5.5).',
    )
  }
}

/**
 * Resolves `localStorage` defensively. It throws outright in some privacy
 * modes, is absent under SSR and in non-DOM test environments, and may be
 * present but non-functional inside sandboxed frames.
 */
function safeStorage(): Storage | null {
  try {
    const storage = globalThis.localStorage as Storage | undefined
    if (!storage) return null
    return storage
  } catch {
    return null
  }
}

/** Reads a plain (non-JSON) string entry. Returns null when unavailable. */
export function readRawEntry(key: StorageKey): string | null {
  const storage = safeStorage()
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** Writes a plain (non-JSON) string entry. Never throws. */
export function writeRawEntry(key: StorageKey, value: string): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.setItem(key, value)
  } catch {
    /* Quota exceeded or storage disabled: a lost preference is not an error. */
  }
}

/** Removes an entry. Never throws. */
export function removeRawEntry(key: StorageKey): void {
  const storage = safeStorage()
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** The envelope actually written to storage, so entries can be migrated. */
interface PersistEnvelope {
  v: number
  data: Record<string, unknown>
}

/** A configured, allowlisted persistence binding for one store. */
export interface Persistence<S, K extends Extract<keyof S, string>> {
  readonly storageKey: StorageKey
  readonly version: number
  /** The exact set of keys this binding is permitted to read and write. */
  readonly allow: readonly K[]
  /** Reads and validates the stored slice. Returns `{}` when absent or invalid. */
  load(): Partial<Pick<S, K>>
  /** Writes only the allowlisted keys of `state`. Never throws. */
  save(state: Readonly<S>): void
  /** Returns exactly what `save` would write, without writing it. */
  preview(state: Readonly<S>): Record<string, unknown>
  /** Removes the entry entirely. */
  clear(): void
}

export interface PersistenceConfig<S, K extends readonly Extract<keyof S, string>[]> {
  /** Which `STORAGE_KEYS` entry this store owns. */
  key: StorageKey
  /** Bumped when the stored shape changes; older envelopes are discarded. */
  version?: number
  /** The complete list of persistable keys. Everything else is dropped. */
  allow: K
  /**
   * Validates the raw parsed object into typed state. Mandatory: storage is
   * untrusted input, and an unvalidated read is an injection path into state.
   */
  decode: (raw: Record<string, unknown>) => Partial<Pick<S, K[number]>>
  /**
   * Upgrades an older envelope. Return the keys worth keeping; everything
   * omitted falls back to the store's current default.
   *
   * Without this, a version bump discards the whole entry, so changing one
   * default resets every unrelated preference the operator had set. With it, a
   * bump can retire a single key and leave the rest alone.
   */
  migrate?: (data: Record<string, unknown>, fromVersion: number) => Record<string, unknown>
}

/**
 * Builds an allowlisted persistence binding for a store.
 *
 * Curried so `S` can be supplied explicitly while `K` is still inferred from
 * the literal `allow` array (TypeScript cannot infer one type parameter and
 * accept another in the same call).
 *
 * ```ts
 * const persisted = persistence<SettingsState>()({
 *   key: STORAGE_KEYS.settings,
 *   allow: ['theme', 'density'],
 *   decode: (raw) => ({ ... }),
 * })
 * ```
 *
 * @throws immediately, at module load, if any allowlisted key name looks like
 *         a secret.
 */
export function persistence<S>() {
  return function build<const K extends readonly Extract<keyof S, string>[]>(
    config: PersistenceConfig<S, K>,
  ): Persistence<S, K[number]> {
    const version = config.version ?? 1
    const allow = config.allow as readonly K[number][]

    for (const key of allow) {
      if (isForbiddenKey(key)) {
        throw new Error(
          `Store "${config.key}" declared "${key}" as persistable, but that name is reserved ` +
            'for secret material and can never be written to storage (UX_SPEC 5.5).',
        )
      }
    }

    function pick(state: Readonly<S>): Record<string, unknown> {
      const picked: Record<string, unknown> = {}
      for (const key of allow) {
        const value = (state as Record<string, unknown>)[key]
        if (typeof value === 'function' || typeof value === 'undefined') continue
        picked[key] = value
      }
      const { value, dropped } = scrubForPersist(picked)
      if (dropped.length > 0) {
        // Key *names* only -- never the values, which is the whole point.
        console.warn(
          `[bufferx] dropped ${dropped.length} secret-shaped key(s) from "${config.key}":`,
          dropped.map((entry) => entry.path).join(', '),
        )
      }
      return value as Record<string, unknown>
    }

    return {
      storageKey: config.key,
      version,
      allow,

      load(): Partial<Pick<S, K[number]>> {
        const raw = readRawEntry(config.key)
        if (raw === null) return {}
        try {
          const parsed: unknown = JSON.parse(raw)
          if (!isPlainObject(parsed)) return {}
          const envelope = parsed as Partial<PersistEnvelope>
          if (!isPlainObject(envelope.data)) return {}

          let data = envelope.data
          if (envelope.v !== version) {
            // An unmigratable entry is dropped rather than guessed at.
            if (!config.migrate) return {}
            const from = typeof envelope.v === 'number' ? envelope.v : 0
            const migrated = config.migrate(data, from)
            if (!isPlainObject(migrated)) return {}
            data = migrated
          }

          // Restrict to the allowlist *before* decoding, so a hand-edited entry
          // cannot smuggle an unexpected key past the validator.
          const allowed: Record<string, unknown> = {}
          for (const key of allow) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
              allowed[key] = data[key]
            }
          }
          return config.decode(allowed)
        } catch {
          return {}
        }
      },

      save(state: Readonly<S>): void {
        const envelope: PersistEnvelope = { v: version, data: pick(state) }
        try {
          writeRawEntry(config.key, JSON.stringify(envelope))
        } catch {
          /* Non-serialisable state is a programming error, not a user-facing one. */
        }
      },

      preview(state: Readonly<S>): Record<string, unknown> {
        return pick(state)
      },

      clear(): void {
        removeRawEntry(config.key)
      },
    }
  }
}
