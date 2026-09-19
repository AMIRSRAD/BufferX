/**
 * The matrix is the part of this tool that can be silently wrong: every cell
 * produces plausible-looking output, and only the byte sequence differs. These
 * tests pin which engine ops each cell runs, in order — which is exactly what
 * the provenance line promises the operator.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { WEB_CAPABILITIES, type EngineRequest, type EngineResponse, type EngineTransport } from '@/engine/protocol'
import { setTransport } from '@/engine/transport'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'

import IranSystemPanel from './IranSystemPanel'
import { runConversion, validateFieldId, validateRequest } from './matrix'

const calls: EngineRequest[] = []
let failNext: string | null = null

const stub: EngineTransport = {
  kind: 'wasm',
  async invoke(request: EngineRequest): Promise<EngineResponse> {
    calls.push(request)
    if (failNext !== null && request.op === failNext) {
      return { ok: false, error: { code: 'UNSUPPORTED', message: 'Unsupported byte 0xFF.' } }
    }
    switch (request.op) {
      case 'text.utf8ToHex':
        return { ok: true, data: { hex: 'aabb' } }
      case 'text.utf8ToAnsiHex':
        return { ok: true, data: { hex: 'c1c2' } }
      case 'text.iranSystemToUnicode':
      case 'text.atmEngineIranSystemToUnicode':
        return { ok: true, data: { text: 'خرید' } }
      case 'text.unicodeToIranSystem':
      case 'text.unicodeToAtmEngineIranSystem':
        return { ok: true, data: { hex: '8192a0', text: 'echo' } }
      case 'text.hexToUtf8':
        return { ok: true, data: { text: 'utf8-render' } }
      case 'text.ansiHexToUtf8':
        return { ok: true, data: { text: 'ansi-render' } }
      default:
        return { ok: false, error: { code: 'UNKNOWN_OP', message: `no ${request.op}` } }
    }
  },
  capabilities: () => WEB_CAPABILITIES,
}

function ops(): string[] {
  return calls.map((request) => request.op)
}

beforeEach(() => {
  calls.length = 0
  failNext = null
  setTransport(stub)
  useProblems.getState().clear()
})

describe('matrix', () => {
  it('decodes through hex without an extra engine call', async () => {
    const outcome = await runConversion({
      input: '81 92 a0',
      profile: 'normalized',
      direction: 'decode',
      encoding: 'hex',
      convertNumbers: true,
    })
    expect(ops()).toEqual(['text.iranSystemToUnicode'])
    expect(outcome.hex).toBe('8192A0')
    expect(outcome.bytes).toBe(3)
    expect(outcome.outputIsHex).toBe(false)
  })

  it('routes the ANSI cell through CP1256 before the ATM profile', async () => {
    await runConversion({
      input: 'text',
      profile: 'atm',
      direction: 'decode',
      encoding: 'ansi',
      convertNumbers: false,
    })
    expect(ops()).toEqual(['text.utf8ToAnsiHex', 'text.atmEngineIranSystemToUnicode'])
  })

  it('renders an encode result in the selected representation', async () => {
    const hexCell = await runConversion({
      input: 'خرید',
      profile: 'normalized',
      direction: 'encode',
      encoding: 'hex',
      convertNumbers: true,
    })
    expect(ops()).toEqual(['text.unicodeToIranSystem'])
    expect(hexCell.text).toBe('8192A0')
    expect(hexCell.outputIsHex).toBe(true)

    calls.length = 0
    const ansiCell = await runConversion({
      input: 'خرید',
      profile: 'atm',
      direction: 'encode',
      encoding: 'ansi',
      convertNumbers: false,
    })
    expect(ops()).toEqual(['text.unicodeToAtmEngineIranSystem', 'text.ansiHexToUtf8'])
    expect(ansiCell.text).toBe('ansi-render')
    expect(ansiCell.hex).toBe('8192A0')
  })

  it('passes the digit toggle only on encode', async () => {
    await runConversion({
      input: 'خرید',
      profile: 'normalized',
      direction: 'encode',
      encoding: 'utf8',
      convertNumbers: false,
    })
    expect(calls[0]?.args).toMatchObject({ convertNumbers: false })
  })

  it('rejects malformed hex before reaching the engine', () => {
    const base = {
      profile: 'normalized',
      direction: 'decode',
      encoding: 'hex',
      convertNumbers: true,
    } as const
    expect(validateRequest({ ...base, input: '81 92' })).toBeNull()
    expect(validateRequest({ ...base, input: '81 9' })).toMatch(/even number/)
    expect(validateRequest({ ...base, input: '81 9z' })).toMatch(/Not hexadecimal/)
    // The rule only applies where the input is the IranSystem side.
    expect(validateRequest({ ...base, direction: 'encode', input: 'zzz' })).toBeNull()
  })

  it('bounds the field id', () => {
    expect(validateFieldId('48')).toBeNull()
    expect(validateFieldId('129')).toMatch(/between 0 and 128/)
    expect(validateFieldId('')).toMatch(/Enter a field/)
    expect(validateFieldId('4x')).toMatch(/whole number/)
  })
})

describe('IranSystemPanel', () => {
  it('starts empty and converts on demand', async () => {
    render(<IranSystemPanel />)
    expect(screen.getByText('Nothing converted yet.')).toBeTruthy()

    fireEvent.change(screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))

    await waitFor(() =>
      expect(screen.getByText(/Transform: utf8ToHex → iranSystemToUnicode/)).toBeTruthy(),
    )
    expect(screen.getByText('AA BB')).toBeTruthy()
    expect(screen.getByText(/2 bytes in \/ 4 chars out/)).toBeTruthy()
  })

  it('marks a result stale when an input changes, and keeps it copyable', async () => {
    render(<IranSystemPanel />)
    const area = screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' })
    fireEvent.change(area, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.getByText('AA BB')).toBeTruthy())

    fireEvent.change(area, { target: { value: 'abcd' } })
    await waitFor(() => expect(screen.getByText('stale')).toBeTruthy())
    expect(screen.getByText(/inputs changed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy hex' })).toBeTruthy()
  })

  it('swaps the panes and flips the direction', async () => {
    render(<IranSystemPanel />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.getByText('AA BB')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Swap input and output' }))

    const swapped = screen.getByRole('textbox', { name: 'Input (Unicode, UTF-8)' })
    expect((swapped as HTMLTextAreaElement).value).toBe('خرید')
    expect(screen.getByText(/Swapped — not converted yet/)).toBeTruthy()
    expect(screen.getByText('swapped')).toBeTruthy()
  })

  it('reports an engine failure inline and in the problems log', async () => {
    failNext = 'text.iranSystemToUnicode'
    render(<IranSystemPanel />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))

    await waitFor(() => expect(screen.getByText('Conversion failed')).toBeTruthy())
    expect(screen.getByText('Unsupported byte 0xFF.')).toBeTruthy()
    expect(useProblems.getState().items.some((item) => item.source === 'IranSystem')).toBe(true)
  })

  it('keeps Convert unavailable until there is something to convert', () => {
    render(<IranSystemPanel />)
    const convert = screen.getByRole('button', { name: 'Convert' })
    expect(convert.getAttribute('aria-disabled')).toBe('true')

    fireEvent.change(screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }), {
      target: { value: '   ' },
    })
    expect(convert.getAttribute('aria-disabled')).toBe('true')

    fireEvent.change(screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }), {
      target: { value: 'abc' },
    })
    expect(convert.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('loads a field from the active buffer and applies the output back', async () => {
    const id = useBuffers.getState().newTab({ fields: [{ id: 48, value: 'ABC' }] })
    render(<IranSystemPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Load Field' }))
    expect(
      (screen.getByRole('textbox', { name: 'Input (IranSystem, UTF-8)' }) as HTMLTextAreaElement)
        .value,
    ).toBe('ABC')

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }))
    await waitFor(() => expect(screen.getByText('AA BB')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Apply to Field' }))
    const tab = useBuffers.getState().tabs.find((candidate) => candidate.id === id)
    expect(tab?.fields.find((row) => row.id === 48)?.value).toBe('خرید')

    useBuffers.getState().closeTab(id, { force: true })
  })

  it('explains a missing field instead of failing silently', () => {
    const id = useBuffers.getState().newTab({ fields: [] })
    render(<IranSystemPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Load Field' }))
    expect(screen.getByText('Field 48 is not present.')).toBeTruthy()
    useBuffers.getState().closeTab(id, { force: true })
  })
})
