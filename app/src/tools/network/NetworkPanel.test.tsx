import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { WEB_CAPABILITIES } from '@/engine/protocol'
import { stubEngine } from '@/test/setup'
import NetworkPanel from './NetworkPanel'
import { DEFAULT_NETWORK, useNetwork } from './networkStore'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('./tcp', async (original) => ({ ...await original<typeof import('./tcp')>(), tcpSend: send }))

function mount() { return render(<TooltipProvider><NetworkPanel /></TooltipProvider>) }
beforeEach(() => {
  send.mockReset()
  localStorage.clear()
  useNetwork.setState({ ...DEFAULT_NETWORK, host: '127.0.0.1', inputHex: true, outputHex: true, request: '0200', result: null, history: [], endpoints: [] })
})
describe('network workspace', () => {
  it('sends body bytes once, displays the response body, and keeps wire framing in the result', async () => {
    send.mockResolvedValue({ requestHex: '303030320200', responseHex: '303030330210FF', elapsedMs: 12, bytesSent: 6, bytesReceived: 7 })
    const { container } = mount()
    expect(container.firstElementChild).toHaveClass('p-panel')
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    await waitFor(() => expect(useNetwork.getState().result?.responseHex).toBe('303030330210FF'))
    expect(send).toHaveBeenCalledWith({ host: '127.0.0.1', port: 5000, payloadHex: '0200', framing: 'ascii', headerSize: 4, timeoutMs: 5000 })
    expect(screen.getByLabelText('Response body').textContent?.replace(/\s/g, '')).toBe('0210FF')
    expect(useNetwork.getState().history[0]?.status).toBe('ok')
    expect(localStorage.getItem('bufferx.network')).not.toContain('303030330210FF')
    expect(localStorage.getItem('bufferx.network')).not.toContain('request')
  })
  it('blocks invalid input before contacting the host', () => {
    useNetwork.setState({ request: '0G' })
    mount()
    expect(screen.getByRole('button', { name: /^Send$/ })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(send).not.toHaveBeenCalled()
  })
  it('surfaces host failures and records the failed attempt', async () => {
    send.mockRejectedValue('TCP response ended before the framed payload was complete.')
    mount()
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    await screen.findByText('Short read')
    expect(useNetwork.getState().history[0]?.status).toBe('error')
  })
  it('gates sending in browsers with an explanation', () => {
    stubEngine.withCapabilities(WEB_CAPABILITIES)
    mount()
    expect(screen.getByRole('button', { name: /^Send$/ })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Sending needs the desktop app')).toBeInTheDocument()
  })
})
