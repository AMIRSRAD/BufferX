/**
 * Network tool state (UX_SPEC 3.8).
 *
 * Split deliberately in two:
 *
 * - **Persisted** (UX_SPEC 5.5 names it explicitly): host, port, timeout,
 *   framing, header size and lock, the input/output representation toggles,
 *   and named endpoint profiles. These are connection settings, not content.
 * - **Never persisted**: the request payload, the response, and the send
 *   history. An ISO request body carries F2 (PAN), F35 (track) and F52 (PIN
 *   block); 5.5 forbids any of it reaching storage, and a saved endpoint is
 *   explicitly "never any payload that looks like key material".
 *
 * The persistence path here is allowlist-only, exactly like `@/store/persist`:
 * a fixed key list, refused at module load if any name is secret-shaped, and
 * every payload walked by `scrubForPersist` before it is serialised. It writes
 * its own `localStorage` entry rather than going through `STORAGE_KEYS`,
 * because that map is owned by the shared store layer and a tool must not
 * mutate it.
 */

import { create } from 'zustand'
import { isForbiddenKey, scrubForPersist } from '@/store/persist'
import {
  defaultHeaderSize,
  framingLabel,
  headerLimit,
  parseCount,
  type Framing,
} from './wire'

/** A named connection profile. Connection settings only -- never a payload. */
export interface Endpoint {
  id: string
  name: string
  host: string
  port: string
  timeoutMs: string
  framing: Framing
  headerSize: string
  headerLocked: boolean
  inputHex: boolean
  outputHex: boolean
}

/** One completed exchange, as returned by the host (or pasted by hand). */
export interface ExchangeResult {
  /** Complete request bytes including the framing header. */
  requestHex: string
  /** Complete response bytes including the framing header. */
  responseHex: string
  elapsedMs: number
  bytesSent: number
  bytesReceived: number
  /** Framing in force when this exchange happened, so the body split stays right. */
  framing: Framing
  headerSize: number
  source: 'tcp' | 'pasted'
  at: number
}

export type HistoryStatus = 'ok' | 'error' | 'cancelled'

/** One row of the session's send log. Memory-only: it holds request bodies. */
export interface HistoryEntry {
  id: string
  at: number
  host: string
  port: string
  framing: Framing
  headerSize: string
  /** The body as composed, in whichever representation `inputHex` selects. */
  request: string
  inputHex: boolean
  outputHex: boolean
  timeoutMs: string
  bytesSent: number
  bytesReceived: number
  elapsedMs: number
  status: HistoryStatus
  message?: string
}

export interface NetworkState {
  host: string
  port: string
  timeoutMs: string
  framing: Framing
  headerSize: string
  /** Pins the header size against a framing change (UX_SPEC 3.8). */
  headerLocked: boolean
  /** Request body is written as hex rather than text. */
  inputHex: boolean
  /** Response body is shown as hex rather than text. */
  outputHex: boolean
  /** The request body as typed. Never persisted. */
  request: string
  endpoints: Endpoint[]
  history: HistoryEntry[]
  result: ExchangeResult | null

  setHost(host: string): void
  setPort(port: string): void
  setTimeoutMs(timeout: string): void
  /**
   * Switches framing. Returns the note to show for two seconds when the header
   * size moved, or `null` when nothing changed -- UX_SPEC 3.8 forbids mutating
   * it in silence.
   */
  setFraming(framing: Framing): string | null
  setHeaderSize(size: string): void
  setHeaderLocked(locked: boolean): void
  setInputHex(hex: boolean): void
  setOutputHex(hex: boolean): void
  setRequest(request: string): void

  /** Saves or overwrites a profile by name. Returns its id. */
  saveEndpoint(name: string): string
  removeEndpoint(id: string): void
  /** Applies a saved profile to the live connection settings. */
  applyEndpoint(id: string): void

  setResult(result: ExchangeResult | null): void
  addHistory(entry: Omit<HistoryEntry, 'id'>): void
  clearHistory(): void
  /** Wipes payload, response and history without touching connection settings. */
  clearSession(): void
}

/** How many sends stay in the session log. Bounded: rows hold request bodies. */
export const HISTORY_LIMIT = 20

export const DEFAULT_NETWORK: Pick<
  NetworkState,
  | 'host'
  | 'port'
  | 'timeoutMs'
  | 'framing'
  | 'headerSize'
  | 'headerLocked'
  | 'inputHex'
  | 'outputHex'
> = {
  host: '',
  port: '5000',
  timeoutMs: '5000',
  framing: 'ascii',
  headerSize: '4',
  headerLocked: false,
  inputHex: true,
  outputHex: true,
}

// ---------------------------------------------------------------------------
// Allowlisted persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'bufferx.network'
const STORAGE_VERSION = 1

/**
 * The complete set of keys permitted to reach storage. Adding a field to
 * `NetworkState` does not persist it; it has to be named here as well, and a
 * secret-shaped name is rejected at import time.
 */
export const NETWORK_PERSISTED_KEYS = [
  'host',
  'port',
  'timeoutMs',
  'framing',
  'headerSize',
  'headerLocked',
  'inputHex',
  'outputHex',
  'endpoints',
] as const

export type NetworkPersistedKey = (typeof NETWORK_PERSISTED_KEYS)[number]

for (const key of NETWORK_PERSISTED_KEYS) {
  if (isForbiddenKey(key)) {
    throw new Error(
      `Network tool declared "${key}" as persistable, but that name is reserved for secret ` +
        'material and can never be written to storage (UX_SPEC 5.5).',
    )
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function isFraming(value: unknown): value is Framing {
  return value === 'none' || value === 'ascii' || value === 'binary'
}

function isDigits(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,9}$/.test(value)
}

function decodeEndpoint(raw: unknown): Endpoint | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null
  if (typeof value.host !== 'string' || !isDigits(value.port)) return null
  if (!isDigits(value.timeoutMs) || !isFraming(value.framing)) return null
  return {
    id: value.id,
    name: value.name,
    host: value.host,
    port: value.port,
    timeoutMs: value.timeoutMs,
    framing: value.framing,
    headerSize: isDigits(value.headerSize) ? value.headerSize : String(defaultHeaderSize(value.framing)),
    headerLocked: value.headerLocked === true,
    inputHex: value.inputHex !== false,
    outputHex: value.outputHex !== false,
  }
}

function loadPersisted(): Partial<Pick<NetworkState, NetworkPersistedKey>> {
  const store = storage()
  if (!store) return {}
  let parsed: unknown
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null) return {}
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const envelope = parsed as { v?: unknown; data?: unknown }
  if (envelope.v !== STORAGE_VERSION) return {}
  if (typeof envelope.data !== 'object' || envelope.data === null) return {}
  const data = envelope.data as Record<string, unknown>

  const next: Partial<Pick<NetworkState, NetworkPersistedKey>> = {}
  if (typeof data.host === 'string') next.host = data.host
  if (isDigits(data.port)) next.port = data.port
  if (isDigits(data.timeoutMs)) next.timeoutMs = data.timeoutMs
  if (isFraming(data.framing)) next.framing = data.framing
  if (isDigits(data.headerSize)) next.headerSize = data.headerSize
  if (typeof data.headerLocked === 'boolean') next.headerLocked = data.headerLocked
  if (typeof data.inputHex === 'boolean') next.inputHex = data.inputHex
  if (typeof data.outputHex === 'boolean') next.outputHex = data.outputHex
  if (Array.isArray(data.endpoints)) {
    const endpoints: Endpoint[] = []
    for (const item of data.endpoints) {
      const endpoint = decodeEndpoint(item)
      if (endpoint) endpoints.push(endpoint)
    }
    next.endpoints = endpoints
  }
  return next
}

function savePersisted(state: NetworkState): void {
  const store = storage()
  if (!store) return
  const picked: Record<string, unknown> = {}
  for (const key of NETWORK_PERSISTED_KEYS) picked[key] = state[key]
  const { value, dropped } = scrubForPersist(picked)
  if (dropped.length > 0) {
    // Key names only -- never values, which is the entire point of the rule.
    console.warn(
      `[bufferx] dropped ${dropped.length} secret-shaped key(s) from "${STORAGE_KEY}":`,
      dropped.map((entry) => entry.path).join(', '),
    )
  }
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, data: value }))
  } catch {
    /* Quota exceeded or storage disabled: a lost preference is not an error. */
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let seq = 0
function nextId(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export const useNetwork = create<NetworkState>()((set, get) => ({
  ...DEFAULT_NETWORK,
  request: '',
  endpoints: [],
  history: [],
  result: null,
  ...loadPersisted(),

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),
  setTimeoutMs: (timeoutMs) => set({ timeoutMs }),

  setFraming(framing) {
    const state = get()
    if (state.framing === framing) return null
    if (framing === 'none') {
      set({ framing })
      return null
    }

    const limit = headerLimit(framing)
    const current = parseCount(state.headerSize)

    if (state.headerLocked) {
      if (current !== null && current >= 1 && current <= limit) {
        set({ framing })
        return null
      }
      set({ framing, headerSize: String(limit) })
      return `Size clamped to ${limit} (${framingLabel(framing)} maximum).`
    }

    const fallback = defaultHeaderSize(framing)
    if (current === fallback) {
      set({ framing })
      return null
    }
    set({ framing, headerSize: String(fallback) })
    return `Size reset to ${fallback} (${framingLabel(framing)} default).`
  },

  setHeaderSize: (headerSize) => set({ headerSize }),
  setHeaderLocked: (headerLocked) => set({ headerLocked }),
  setInputHex: (inputHex) => set({ inputHex }),
  setOutputHex: (outputHex) => set({ outputHex }),
  setRequest: (request) => set({ request }),

  saveEndpoint(name) {
    const state = get()
    const trimmed = name.trim()
    const existing = state.endpoints.find(
      (endpoint) => endpoint.name.toLowerCase() === trimmed.toLowerCase(),
    )
    const endpoint: Endpoint = {
      id: existing?.id ?? nextId('endpoint'),
      name: trimmed,
      host: state.host.trim(),
      port: state.port,
      timeoutMs: state.timeoutMs,
      framing: state.framing,
      headerSize: state.headerSize,
      headerLocked: state.headerLocked,
      inputHex: state.inputHex,
      outputHex: state.outputHex,
    }
    set({
      endpoints: existing
        ? state.endpoints.map((item) => (item.id === existing.id ? endpoint : item))
        : [...state.endpoints, endpoint],
    })
    return endpoint.id
  },

  removeEndpoint(id) {
    set((state) => ({ endpoints: state.endpoints.filter((endpoint) => endpoint.id !== id) }))
  },

  applyEndpoint(id) {
    const endpoint = get().endpoints.find((item) => item.id === id)
    if (!endpoint) return
    set({
      host: endpoint.host,
      port: endpoint.port,
      timeoutMs: endpoint.timeoutMs,
      framing: endpoint.framing,
      headerSize: endpoint.headerSize,
      headerLocked: endpoint.headerLocked,
      inputHex: endpoint.inputHex,
      outputHex: endpoint.outputHex,
    })
  },

  setResult: (result) => set({ result }),

  addHistory(entry) {
    set((state) => ({
      history: [{ ...entry, id: nextId('send') }, ...state.history].slice(0, HISTORY_LIMIT),
    }))
  },

  clearHistory: () => set({ history: [] }),

  clearSession: () => set({ request: '', result: null, history: [] }),
}))

useNetwork.subscribe(savePersisted)
