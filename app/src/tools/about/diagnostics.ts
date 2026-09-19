/**
 * Build metadata, engine version normalisation, and the scrubbed diagnostics
 * report (UX_SPEC 3.9 → Diagnostics / About, 5.5 rule 3).
 *
 * Everything here is pure except `readBuildInfo`, which reads the build-time
 * environment. The report builder takes a plain snapshot object so it can be
 * unit-tested without a DOM, an engine or a store.
 *
 * **Secrets rule.** The report is assembled from versions, capabilities,
 * layout state and the Problems log. Buffer contents, field values and every
 * tool's inputs are out of scope by construction — they are never passed in —
 * and the Problems log is run through `scrubDiagnosticText` before it lands,
 * because a length-mismatch message quotes the offending bytes.
 */

import type { HostCapabilities } from '@/engine/protocol'
import { PRODUCT } from './identity'

/* ── Build metadata ───────────────────────────────────────────────────────── */

export interface BuildInfo {
  /** `VITE_APP_VERSION` when the build injects one, else the shipped default. */
  appVersion: string
  /** `production`, `development`, or whatever `--mode` was used. */
  mode: string
  /** ISO date the bundle was built, or `null` when the build did not stamp it. */
  buildDate: string | null
  /** Short commit hash, or `null` when the build did not stamp it. */
  commit: string | null
}

/**
 * Reads Vite's environment without depending on `vite/client` types, which
 * this project's `tsconfig` deliberately does not include. Missing stamps are
 * reported as missing rather than guessed: an invented build date is worse
 * than a dash in a bug report.
 */
export function readBuildInfo(): BuildInfo {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}

  const text = (key: string): string | null => {
    const value = env[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }

  return {
    appVersion: text('VITE_APP_VERSION') ?? PRODUCT.fallbackVersion,
    mode: text('MODE') ?? 'unknown',
    buildDate: text('VITE_BUILD_DATE'),
    commit: text('VITE_GIT_COMMIT') ?? text('VITE_COMMIT'),
  }
}

/* ── Engine version ───────────────────────────────────────────────────────── */

export interface EngineVersionInfo {
  /** ABI version string reported by `engine.version`. */
  version: string
  /** Envelope protocol number the engine speaks. */
  protocol: string
  /** OpenSSL / libcrypto version, when the engine build reports one. */
  cryptoBackend: string | null
  /** Core build date, when the engine build reports one. */
  buildDate: string | null
  /** Core commit, when the engine build reports one. */
  commit: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scalar(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return null
}

/**
 * Normalises `engine.version`.
 *
 * The current ABI answers `{ version, protocol }`. The optional fields are read
 * defensively so a later core that reports its crypto backend or its own build
 * stamp lights those readouts up without a frontend change.
 */
export function normalizeEngineVersion(raw: unknown): EngineVersionInfo {
  if (!isRecord(raw)) {
    return { version: '—', protocol: '—', cryptoBackend: null, buildDate: null, commit: null }
  }
  return {
    version: scalar(raw.version) ?? '—',
    protocol: scalar(raw.protocol) ?? '—',
    cryptoBackend:
      scalar(raw.cryptoBackend) ?? scalar(raw.crypto) ?? scalar(raw.openssl) ?? null,
    buildDate: scalar(raw.buildDate) ?? null,
    commit: scalar(raw.commit) ?? null,
  }
}

/** `WASM` / `Native IPC`, exactly as UX_SPEC 3.9 names them. */
export function transportLabel(kind: 'wasm' | 'native'): string {
  return kind === 'native' ? 'Native IPC' : 'WASM'
}

/** The command bar's transport pill wording, reused in the report. */
export function hostLabel(kind: 'wasm' | 'native'): string {
  return kind === 'native' ? 'Desktop (Tauri webview)' : 'Web (browser tab)'
}

/* ── Redaction ────────────────────────────────────────────────────────────── */

const REDACTED = '[redacted]'

/** `key`, `pin`, `pan`, `pvk`, `pem`, `secret`, `password`, `block` + a value. */
const LABELLED_SECRET =
  /\b(pin block|pin|pan|key|pvk|pem|secret|password|block)\b(\s*(?:=|:|is|of|was)?\s*)(["']?)([A-Za-z0-9+/=_-]{4,})\3/gi

/** Any hex run long enough to be key, block or ciphertext material. */
const HEX_RUN = /\b[0-9a-fA-F]{8,}\b/g

/** Card-number-length digit runs. */
const DIGIT_RUN = /\b\d{12,}\b/g

/** Base64-ish blobs: PEM bodies, encoded payloads. */
const BASE64_RUN = /\b[A-Za-z0-9+/]{20,}={0,2}\b/g

/**
 * Removes anything that could be message content or key material from a line
 * of log text, while leaving the sentence readable.
 *
 * This is deliberately over-eager: a redacted byte count in a bug report costs
 * nothing, a leaked PIN block costs everything. The label rule runs first so
 * `MAC key 0011…` loses the value rather than only the hex run inside it.
 */
export function scrubDiagnosticText(text: string): string {
  return text
    .replace(LABELLED_SECRET, (_match, label: string, joiner: string) => {
      const glue = joiner.trim() === '' ? ' ' : joiner
      return `${label}${glue}${REDACTED}`
    })
    .replace(HEX_RUN, REDACTED)
    .replace(DIGIT_RUN, REDACTED)
    .replace(BASE64_RUN, REDACTED)
}

/** How many substitutions scrubbing made — shown next to the report preview. */
export function countRedactions(before: string, after: string): number {
  if (before === after) return 0
  let count = 0
  let index = after.indexOf(REDACTED)
  while (index !== -1) {
    count += 1
    index = after.indexOf(REDACTED, index + REDACTED.length)
  }
  return count
}

/* ── The report ───────────────────────────────────────────────────────────── */

export interface DiagnosticsProblem {
  severity: 'error' | 'warning' | 'info'
  source: string
  message: string
  at: number
}

export interface PackagerDiagnostics {
  /** `Engine defaults` or the file's basename. */
  label: string
  kind: 'builtin' | 'file'
  path: string | null
  hash: string | null
  bytes: number | null
  /** `Date.now()` of the load, or `0` when the registry was never loaded here. */
  loadedAt: number
  count: number
}

export interface LayoutDiagnostics {
  theme: string
  density: string
  railLabeled: boolean
  legacyEngine: boolean
  openTools: readonly string[]
}

export interface DiagnosticsSnapshot {
  generatedAt: number
  build: BuildInfo
  engine: EngineVersionInfo | null
  /** Engine failure text, when `engine.version` could not be read. */
  engineError: string | null
  transport: 'wasm' | 'native'
  capabilities: HostCapabilities
  packagers: PackagerDiagnostics | null
  layout: LayoutDiagnostics
  problems: readonly DiagnosticsProblem[]
}

function line(label: string, value: string | null): string {
  return `  ${label.padEnd(20)}${value === null || value === '' ? '—' : value}`
}

function stamp(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  return new Date(at).toISOString()
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no'
}

/**
 * Renders the scrubbed report that `Copy diagnostics` puts on the clipboard.
 *
 * Fixed-width labels, section headers, no colour, no markup: it is pasted into
 * an email or an issue tracker, so it has to survive as plain text.
 */
export function buildDiagnosticsReport(snapshot: DiagnosticsSnapshot): string {
  const { build, engine, packagers, layout, capabilities } = snapshot
  const out: string[] = []

  out.push(`${PRODUCT.name} diagnostics`)
  out.push(`Generated ${stamp(snapshot.generatedAt)}`)
  out.push('')

  out.push('APPLICATION')
  out.push(line('App version', build.appVersion))
  out.push(line('Build mode', build.mode))
  out.push(line('Build date', build.buildDate))
  out.push(line('Commit', build.commit))
  out.push(line('Creator', PRODUCT.creator))
  out.push(line('Website', PRODUCT.website))
  out.push('')

  out.push('ENGINE')
  if (engine) {
    out.push(line('Core version', engine.version))
    out.push(line('Protocol', engine.protocol))
    out.push(line('Crypto backend', engine.cryptoBackend ?? 'not reported by this build'))
    out.push(line('Core build date', engine.buildDate))
    out.push(line('Core commit', engine.commit))
  } else {
    out.push(line('Core version', 'unavailable'))
    out.push(line('Failure', snapshot.engineError ?? 'engine.version did not answer'))
  }
  out.push(line('Transport', transportLabel(snapshot.transport)))
  out.push(line('Host', hostLabel(snapshot.transport)))
  out.push('')

  out.push('HOST CAPABILITIES')
  out.push(line('TCP sockets', yesNo(capabilities.tcp)))
  out.push(line('File system', yesNo(capabilities.files)))
  out.push(line('Key files', yesNo(capabilities.keyFiles)))
  out.push(line('Desktop', yesNo(capabilities.desktop)))
  out.push('')

  out.push('PACKAGERS')
  if (packagers) {
    out.push(line('Source', packagers.kind === 'file' ? packagers.label : 'Engine defaults'))
    out.push(line('Path', packagers.path))
    out.push(line('Hash', packagers.hash))
    out.push(line('Size', packagers.bytes === null ? null : `${packagers.bytes} bytes`))
    out.push(line('Loaded', packagers.loadedAt === 0 ? null : stamp(packagers.loadedAt)))
    out.push(line('Registered', String(packagers.count)))
  } else {
    out.push(line('Source', 'no registry read in this session'))
  }
  out.push('')

  out.push('LAYOUT')
  out.push(line('Theme', layout.theme))
  out.push(line('Density', layout.density))
  out.push(line('Rail labels', yesNo(layout.railLabeled)))
  out.push(line('Legacy ATM engine', yesNo(layout.legacyEngine)))
  out.push(line('Open tools', layout.openTools.length > 0 ? layout.openTools.join(', ') : 'none'))
  out.push('')

  out.push(`PROBLEMS (${snapshot.problems.length})`)
  if (snapshot.problems.length === 0) {
    out.push('  none')
  } else {
    for (const problem of snapshot.problems) {
      const severity = problem.severity.toUpperCase().padEnd(7)
      const source = scrubDiagnosticText(problem.source)
      const message = scrubDiagnosticText(problem.message)
      out.push(`  ${severity} ${stamp(problem.at)}  ${source} — ${message}`)
    }
  }
  out.push('')

  out.push('Secret-bearing values are replaced with [redacted]. No key, PIN, PAN, PEM body or')
  out.push('buffer content appears in this report.')

  return out.join('\n')
}
