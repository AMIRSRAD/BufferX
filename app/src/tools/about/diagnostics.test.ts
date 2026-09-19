import { describe, expect, it } from 'vitest'
import {
  buildDiagnosticsReport,
  countRedactions,
  normalizeEngineVersion,
  scrubDiagnosticText,
  transportLabel,
  type DiagnosticsSnapshot,
} from './diagnostics'

describe('scrubDiagnosticText', () => {
  it('redacts key material behind a label', () => {
    expect(scrubDiagnosticText('MAC key 0011223344556677 loaded')).toBe('MAC key [redacted] loaded')
  })

  it('redacts a bare hex run', () => {
    expect(scrubDiagnosticText('Calculated 9A4C71E288B03D51 (ISO9797 M2).')).toBe(
      'Calculated [redacted] (ISO9797 M2).',
    )
  })

  it('redacts a PAN-length digit run', () => {
    expect(scrubDiagnosticText('F2 6274129005473742 rejected')).toBe('F2 [redacted] rejected')
  })

  it('keeps short, non-sensitive numbers readable', () => {
    expect(scrubDiagnosticText('F52 declared 8 bytes, value is 6.')).toBe(
      'F52 declared 8 bytes, value is 6.',
    )
  })
})

describe('countRedactions', () => {
  it('counts every substitution', () => {
    const before = 'key 0011223344556677 and 8899AABBCCDDEEFF'
    expect(countRedactions(before, scrubDiagnosticText(before))).toBe(2)
  })

  it('reports zero when nothing changed', () => {
    expect(countRedactions('all clear', 'all clear')).toBe(0)
  })
})

describe('normalizeEngineVersion', () => {
  it('accepts the current ABI shape', () => {
    const info = normalizeEngineVersion({ version: '2.0.0', protocol: 1 })
    expect(info.version).toBe('2.0.0')
    expect(info.protocol).toBe('1')
    expect(info.cryptoBackend).toBeNull()
  })

  it('lights up optional fields a later core may report', () => {
    const info = normalizeEngineVersion({ version: '2.1.0', protocol: 1, openssl: 'OpenSSL 3.3.1' })
    expect(info.cryptoBackend).toBe('OpenSSL 3.3.1')
  })

  it('degrades on a malformed answer instead of throwing', () => {
    expect(normalizeEngineVersion(null).version).toBe('—')
  })
})

describe('buildDiagnosticsReport', () => {
  const snapshot: DiagnosticsSnapshot = {
    generatedAt: Date.parse('2026-08-09T10:00:00.000Z'),
    build: { appVersion: '2.0.0', mode: 'production', buildDate: null, commit: null },
    engine: {
      version: '2.0.0',
      protocol: '1',
      cryptoBackend: null,
      buildDate: null,
      commit: null,
    },
    engineError: null,
    transport: 'wasm',
    capabilities: { tcp: false, files: false, keyFiles: false, desktop: false },
    packagers: {
      label: 'packagers.xml',
      kind: 'file',
      path: 'C:/data/packagers.xml',
      hash: 'sha256:abc',
      bytes: 1234,
      loadedAt: Date.parse('2026-08-09T09:00:00.000Z'),
      count: 32,
    },
    layout: {
      theme: 'dark',
      density: 'dense',
      railLabeled: false,
      legacyEngine: false,
      openTools: ['about'],
    },
    problems: [
      {
        severity: 'info',
        source: 'MAC',
        message: 'Calculated 9A4C71E288B03D51 with key 0011223344556677.',
        at: Date.parse('2026-08-09T09:30:00.000Z'),
      },
    ],
  }

  it('scrubs the problems log', () => {
    const report = buildDiagnosticsReport(snapshot)
    expect(report).not.toContain('9A4C71E288B03D51')
    expect(report).not.toContain('0011223344556677')
    expect(report).toContain('[redacted]')
  })

  it('carries the versions, host and packager provenance', () => {
    const report = buildDiagnosticsReport(snapshot)
    expect(report).toContain('App version')
    expect(report).toContain(transportLabel('wasm'))
    expect(report).toContain('sha256:abc')
    expect(report).toContain('32')
  })

  it('states the engine failure instead of dropping the section', () => {
    const report = buildDiagnosticsReport({
      ...snapshot,
      engine: null,
      engineError: 'The engine could not be reached.',
    })
    expect(report).toContain('The engine could not be reached.')
  })
})
