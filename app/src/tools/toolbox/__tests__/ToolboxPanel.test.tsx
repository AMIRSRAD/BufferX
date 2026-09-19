import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const call = vi.fn()
vi.mock('@/engine/client', () => ({
  tryCall: (op: string, args: unknown) => call(op, args),
  call: (op: string, args: unknown) => call(op, args),
  hostCapabilities: () => ({ tcp: false, files: false, keyFiles: false, desktop: false }),
  engineKind: () => 'wasm',
}))

import ToolboxPanel from '@/tools/toolbox/ToolboxPanel'
import { clearToolboxHistory } from '@/tools/toolbox/history'

describe('ToolboxPanel', () => {
  beforeEach(() => {
    call.mockReset()
    // History is module-scoped memory (never storage), so tests must reset it.
    clearToolboxHistory()
  })

  it('renders all 21 operations and runs the selected one', async () => {
    call.mockResolvedValue({ ok: true, data: { output: '0123456F' } })
    render(<ToolboxPanel />)

    expect(screen.getAllByRole('option')).toHaveLength(21)
    expect(screen.getByRole('heading', { name: 'BCD Encode Left' })).toBeTruthy()

    const input = screen.getByLabelText(/Input \(digits\)/)
    fireEvent.change(input, { target: { value: '1234567' } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))

    await waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect(call.mock.calls[0]![1]).toEqual({
      operation: 'bcdencodeleft',
      input: '1234567',
      secondary: '',
      parameter: 0,
    })
    await screen.findByText(/01 23 45 6F/)
  })

  it('blocks a run when client-side validation fails', async () => {
    render(<ToolboxPanel />)
    fireEvent.click(screen.getByRole('option', { name: 'XOR Hex' }))
    const input = screen.getByLabelText(/^Input \(hex\)/)
    fireEvent.change(input, { target: { value: 'AABB' } })
    const second = screen.getByLabelText(/Second value/)
    fireEvent.change(second, { target: { value: 'CC' } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    await screen.findByText(/same length/)
    expect(call).not.toHaveBeenCalled()
  })

  it('sends the hash input mode through secondary', async () => {
    call.mockResolvedValue({ ok: true, data: { output: 'ABCD' } })
    render(<ToolboxPanel />)
    fireEvent.click(screen.getByRole('option', { name: 'SHA-256' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Hex input' }))
    fireEvent.change(screen.getByLabelText(/Input \(hex\)/), { target: { value: 'AABB' } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    await waitFor(() => expect(call).toHaveBeenCalled())
    expect(call.mock.calls[0]![1]).toMatchObject({ operation: 'sha256', secondary: 'hex' })
  })

  it('validates key length before calling the engine and never stores the key', async () => {
    call.mockResolvedValue({ ok: true, data: { output: '4A2B71' } })
    render(<ToolboxPanel />)
    fireEvent.click(screen.getByRole('option', { name: 'KCV' }))

    const key = screen.getByLabelText(/Key \(hex\)/)
    fireEvent.change(key, { target: { value: '00112233' } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    await screen.findByText(/8, 16, 24, or 32 bytes/)
    expect(call).not.toHaveBeenCalled()

    const legal = '0123456789ABCDEFFEDCBA9876543210'
    fireEvent.change(key, { target: { value: legal } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1))
    expect(call.mock.calls[0]![1]).toEqual({
      operation: 'kcv',
      input: legal,
      secondary: '',
      parameter: 3,
    })

    // The history row carries a masked hint, never the key material.
    const recent = await screen.findByRole('region', { name: 'Recent runs' })
    expect(recent.textContent).toContain('key ••••… 16 bytes')
    expect(recent.textContent).not.toContain(legal)
    expect(window.localStorage.getItem('bufferx.toolbox')).toBeNull()
  })

  it('surfaces engine failures inline', async () => {
    call.mockResolvedValue({ ok: false, error: { code: 'BAD_ARGUMENT', message: 'Invalid BCD nibble.' } })
    render(<ToolboxPanel />)
    fireEvent.click(screen.getByRole('option', { name: 'BCD Decode Left' }))
    fireEvent.change(screen.getByLabelText(/Input \(hex\)/), { target: { value: 'AB' } })
    fireEvent.click(screen.getByRole('button', { name: /^Run$/ }))
    await screen.findByText('Invalid BCD nibble.')
  })
})
