import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { stubEngine } from '@/test/setup'
import { useBuffers } from '@/store/buffers'
import { useSettings } from '@/store/settings'
import SettingsPanel from '../SettingsPanel'
import { usePackagerSource } from '../packagerSource'
import {
  PREFERENCES_PERSISTED_KEYS,
  PREFERENCES_STORAGE_KEY,
  clearPersistedPreferences,
  usePreferences,
} from '../preferences'
import { legacyFramingFor, previewLegacyFraming } from '../legacyFraming'
import { parseBufferFile, serializeBuffer, sensitiveFieldsIn } from '../bufferFile'

const SUMMARY = {
  name: 'SLM',
  macMethod: 'FULL',
  macSize: 8,
  macConfigured: true,
  bitmapIndex: 1,
  secondPartBitmap: false,
  fieldCount: 64,
  lenFormat: 'ASCII',
  lenLen: 4,
  fieldDefinitionCount: 2,
  macFieldIds: [64],
}

function seedEngine() {
  stubEngine.reply('packager.list', { packagers: [SUMMARY, { ...SUMMARY, name: 'HYPERCOM', lenLen: 2 }] })
  stubEngine.reply('packager.fields', {
    fields: [
      { id: 2, type: 'N', length: 19, desc: 'Primary account number', flags: 0, lengthDigits: 2, variable: true, sourceType: 'LLVAR' },
      { id: 3, type: 'N', length: 6, desc: 'Processing code', flags: 0, lengthDigits: 0, variable: false, sourceType: 'FIXED' },
    ],
  })
  stubEngine.reply('engine.version', { version: '2.0.0', protocol: 1 })
}

function openSection(label: string) {
  fireEvent.click(screen.getByRole('tab', { name: label }))
}

beforeEach(() => {
  seedEngine()
  usePackagerSource.setState({ packagers: [], source: null, status: 'idle', error: null, xml: null })
  useSettings.setState({ legacyEngine: false })
  useBuffers.setState({ tabs: [], activeId: null, closed: [], seq: 0 })
})

afterEach(() => {
  clearPersistedPreferences()
})

describe('SettingsPanel', () => {
  it('renders every section of UX_SPEC 3.9 in the sub-nav', () => {
    render(<SettingsPanel />)
    for (const label of [
      'Packagers',
      'Engine',
      'Framing defaults',
      'Buffers and session',
      'Appearance',
      'Keyboard',
      'Security',
      'Diagnostics and About',
    ]) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('loads the packager registry and shows the field-definition reference', async () => {
    render(<SettingsPanel />)
    await waitFor(() => expect(screen.getByText('Primary account number')).toBeInTheDocument())
    expect(screen.getByText('Processing code')).toBeInTheDocument()
    expect(screen.getByText('2 of 32')).toBeInTheDocument()
  })

  it('surfaces a registry failure inline rather than throwing', async () => {
    stubEngine.on('packager.list', () => ({
      ok: false,
      error: { code: 'INTERNAL', message: 'registry unavailable' },
    }))
    render(<SettingsPanel />)
    await waitFor(() => expect(screen.getByText('registry unavailable')).toBeInTheDocument())
  })

  it('never applies the legacy engine without an explicit Apply', () => {
    useBuffers.getState().newTab({ name: 'auth.bxb', packager: 'HYPERCOM' })
    render(<SettingsPanel />)
    openSection('Engine')

    fireEvent.click(screen.getByRole('switch', { name: /legacy atm engine/i }))
    expect(useSettings.getState().legacyEngine).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(useSettings.getState().legacyEngine).toBe(true)

    const tab = useBuffers.getState().active()
    expect(tab?.header).toEqual({ enabled: true, mode: 'binary', size: 2 })
    expect(tab?.autoDetect).toBe(true)
  })

  it('cancels a pending engine change without touching the buffer', () => {
    useBuffers.getState().newTab({ name: 'auth.bxb', packager: 'SLM' })
    render(<SettingsPanel />)
    openSection('Engine')
    fireEvent.click(screen.getByRole('switch', { name: /legacy atm engine/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useSettings.getState().legacyEngine).toBe(false)
    expect(useBuffers.getState().active()?.header.mode).toBe('none')
  })

  it('validates the header size before it reaches the store', () => {
    render(<SettingsPanel />)
    openSection('Framing defaults')
    const input = screen.getByLabelText('Header size')
    fireEvent.change(input, { target: { value: '12' } })
    expect(screen.getByText(/between 1 and 8 bytes/i)).toBeInTheDocument()
    expect(usePreferences.getState().framing.size).toBe(4)

    fireEvent.change(input, { target: { value: '7' } })
    expect(usePreferences.getState().framing.size).toBe(7)
  })

  it('validates the idle-wipe timeout', () => {
    render(<SettingsPanel />)
    openSection('Security')
    const input = screen.getByLabelText('Timeout')
    fireEvent.change(input, { target: { value: '999' } })
    expect(screen.getByText(/between 1 and 120 minutes/i)).toBeInTheDocument()
    expect(usePreferences.getState().idleWipeMinutes).toBe(15)
  })

  it('drives theme and density through the shell store', () => {
    render(<SettingsPanel />)
    openSection('Appearance')
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(useSettings.getState().theme).toBe('light')
    fireEvent.click(screen.getByRole('radio', { name: 'Comfortable' }))
    expect(useSettings.getState().density).toBe('comfortable')
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })

  it('emits a diagnostics report with no secret-shaped content', async () => {
    render(<SettingsPanel />)
    openSection('Diagnostics and About')
    const report = await screen.findByText(/# BufferX diagnostics/)
    const text = report.textContent ?? ''
    expect(text).toContain('transport')
    expect(text).toContain('protocol')
    expect(/\bpin\b|\bpan\b|key |pvk|pem/i.test(text)).toBe(false)
  })

  it('keeps the shortcut sheet searchable', () => {
    render(<SettingsPanel />)
    openSection('Keyboard')
    fireEvent.change(screen.getByLabelText('Filter shortcuts'), { target: { value: 'palette' } })
    const sheet = screen.getByRole('region', { name: 'Shortcut sheet' })
    expect(within(sheet).getByText('Command palette')).toBeInTheDocument()
    expect(within(sheet).queryByText('Undo')).not.toBeInTheDocument()
  })
})

describe('persistence', () => {
  it('writes only allowlisted, non-secret keys', () => {
    usePreferences.getState().setUiScale(125)
    const raw = globalThis.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw ?? '{}') as { data: Record<string, unknown> }
    for (const key of Object.keys(parsed.data)) {
      expect(PREFERENCES_PERSISTED_KEYS as readonly string[]).toContain(key)
    }
  })
})

describe('legacy framing rules', () => {
  it('maps every family from the UX_SPEC table', () => {
    expect(legacyFramingFor('HYPERCOM')).toMatchObject({ mode: 'binary', size: 2, enabled: true })
    expect(legacyFramingFor('SLM')).toMatchObject({ mode: 'ascii', size: 4 })
    // NEGINLink replaced SLMLink in the shipped definitions and declares
    // LenLen="4" like NEGIN, so it takes the default rule rather than the
    // 7-digit header the old app hardcoded for the name "SLMLink".
    expect(legacyFramingFor('NEGINLink')).toMatchObject({ mode: 'ascii', size: 4 })
    expect(legacyFramingFor('NEGIN')).toMatchObject({ mode: 'ascii', size: 4 })
    for (const name of ['DATASET', 'TABLE71', 'AMNT87', 'STX10', 'STMNT2003', 'BIT121']) {
      expect(legacyFramingFor(name)).toMatchObject({ enabled: false, autoDetect: false, mode: 'none' })
    }
  })

  it('leaves the header size alone when the rule declares none', () => {
    const { changes } = previewLegacyFraming('TABLE71', { enabled: true, mode: 'ascii', size: 6 }, true)
    const size = changes.find((change) => change.label === 'Header size')
    expect(size?.after).toContain('unchanged')
  })
})

describe('buffer files', () => {
  it('round-trips a buffer', () => {
    const id = useBuffers.getState().newTab({
      name: 'auth.bxb',
      packager: 'SLM',
      raw: '0200',
      inputHex: true,
      fields: [{ id: 2, value: '6011000990139424' }],
    })
    const tab = useBuffers.getState().tabs.find((candidate) => candidate.id === id)
    expect(tab).toBeDefined()
    const parsed = parseBufferFile(serializeBuffer(tab as NonNullable<typeof tab>), 'fallback')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.init.packager).toBe('SLM')
      expect(parsed.init.inputHex).toBe(true)
      expect(parsed.init.fields?.[0]?.value).toBe('6011000990139424')
    }
  })

  it('rejects a file that is not a buffer, with a sentence', () => {
    const parsed = parseBufferFile('{"format":"something-else"}', 'x.bxb')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.error).toMatch(/bufferx\.buffer/)
      // The message must name what was found, or the operator cannot tell a
      // wrong file from a corrupt one.
      expect(parsed.error).toContain('something-else')
    }
  })

  /**
   * Settings and the buffer workspace each had their own file module, and they
   * disagreed on the format string: the workspace wrote `bufferx.buffer` while
   * this one demanded `bufferx-buffer`. Both parsers checked strictly, so each
   * surface rejected files the other had just saved.
   */
  it('opens buffers saved by either surface', () => {
    const body =
      '"version":1,"name":"b","packager":"SLM","raw":"0200","rawFormat":"text",' +
      '"header":{"enabled":false,"mode":"none","size":4},"autoDetect":true,"fields":[]'
    for (const format of ['bufferx.buffer', 'bufferx-buffer']) {
      const parsed = parseBufferFile(`{"format":"${format}",${body}}`, 'x.bxb')
      expect(parsed.ok, `${format} should be accepted`).toBe(true)
    }
  })

  it('flags PIN and track fields for the save note', () => {
    expect(sensitiveFieldsIn([{ id: 52, value: 'AABB' }])).toEqual([52])
    expect(sensitiveFieldsIn([{ id: 52, value: '' }])).toEqual([])
  })
})
