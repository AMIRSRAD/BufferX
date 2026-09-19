import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { stubEngine } from '@/test/setup'
import RsaPanel from '../RsaPanel'

/** A syntactically valid PEM envelope. The engine itself is stubbed. */
function pem(label: string): string {
  return `-----BEGIN ${label}-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\n-----END ${label}-----`
}

function set(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } })
}

/** Radix activates a tab on mousedown, not on click. */
function switchToCipherTab(): void {
  const tab = screen.getByRole('tab', { name: 'Encrypt / Decrypt' })
  fireEvent.mouseDown(tab)
  fireEvent.click(tab)
}

function loadKeys(): void {
  set(screen.getByLabelText(/private key \(pem\)/i), pem('PRIVATE KEY'))
  set(screen.getByLabelText(/public key \(pem\)/i), pem('PUBLIC KEY'))
}

describe('RsaPanel', () => {
  it('starts empty, with both sub-tabs and the primary action blocked', () => {
    render(<RsaPanel />)
    expect(screen.getByRole('tab', { name: 'Sign / Verify' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Encrypt / Decrypt' })).toBeInTheDocument()
    expect(screen.getByText(/nothing signed or verified yet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('signs a payload and records provenance', async () => {
    stubEngine.reply('rsa.sign', { signature: 'QUJDRA==' })
    render(<RsaPanel />)

    loadKeys()
    set(screen.getByLabelText(/^payload$/i), 'hello')

    const sign = screen.getByRole('button', { name: 'Sign' })
    await waitFor(() => expect(sign).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(sign)

    await waitFor(() => expect(screen.getByText(/signed \d\d:/)).toBeInTheDocument())
    const request = stubEngine.calls.find((call) => call.op === 'rsa.sign')
    expect(request?.args).toMatchObject({ digest: 'sha256', payload: 'hello' })
    expect(screen.getByRole('textbox', { name: /signature \(base64\)/i })).toHaveValue('QUJDRA==')
  })

  it('withdraws the verdict as soon as an input changes', async () => {
    stubEngine.reply('rsa.verify', { valid: true })
    render(<RsaPanel />)

    loadKeys()
    set(screen.getByLabelText(/^payload$/i), 'hello')
    set(screen.getByRole('textbox', { name: /signature \(base64\)/i }), 'QUJDRA==')

    const verify = screen.getByRole('button', { name: 'Verify' })
    await waitFor(() => expect(verify).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(verify)
    await waitFor(() => expect(screen.getByText('MATCH')).toBeInTheDocument())

    set(screen.getByLabelText(/^payload$/i), 'hello!')
    expect(screen.queryByText('MATCH')).not.toBeInTheDocument()
  })

  it('shows a MISMATCH verdict rather than an error when verification fails', async () => {
    stubEngine.reply('rsa.verify', { valid: false })
    render(<RsaPanel />)

    loadKeys()
    set(screen.getByLabelText(/^payload$/i), 'hello')
    set(screen.getByRole('textbox', { name: /signature \(base64\)/i }), 'QUJDRA==')

    const verify = screen.getByRole('button', { name: 'Verify' })
    await waitFor(() => expect(verify).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(verify)

    await waitFor(() => expect(screen.getByText('MISMATCH')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces an engine failure inline, retitled when the key is at fault', async () => {
    stubEngine.on('rsa.sign', () => ({
      ok: false,
      error: { code: 'PARSE_FAILED', message: 'not a valid PEM private key' },
    }))
    render(<RsaPanel />)

    loadKeys()
    set(screen.getByLabelText(/^payload$/i), 'hello')
    const sign = screen.getByRole('button', { name: 'Sign' })
    await waitFor(() => expect(sign).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(sign)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Key failed to parse')
    expect(alert).toHaveTextContent('not a valid PEM private key')
  })

  it('keeps decrypted plaintext out of the plaintext input until asked', async () => {
    stubEngine.reply('rsa.decrypt', { plaintext: 'recovered' })
    render(<RsaPanel />)

    loadKeys()
    switchToCipherTab()
    set(screen.getByLabelText(/^plaintext$/i), 'original')
    set(screen.getByRole('textbox', { name: /ciphertext \(base64\)/i }), 'QUJDRA==')

    const decrypt = screen.getByRole('button', { name: 'Decrypt' })
    await waitFor(() => expect(decrypt).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.click(decrypt)

    await waitFor(() => expect(screen.getByText('Decrypted plaintext')).toBeInTheDocument())
    // The operator's own plaintext is untouched — the old app overwrote it.
    expect(screen.getByLabelText(/^plaintext$/i)).toHaveValue('original')

    fireEvent.click(screen.getByRole('button', { name: /use as plaintext/i }))
    expect(screen.getByLabelText(/^plaintext$/i)).toHaveValue('recovered')
  })

  it('blocks encryption that cannot fit the padding, next to the control', () => {
    render(<RsaPanel />)
    // A 256-bit modulus: OAEP SHA-256 needs 66 bytes of overhead alone, so no
    // plaintext fits and Encrypt must stay blocked.
    const der = [0x30, 0x25, 0x02, 0x20, ...new Array<number>(32).fill(0xff), 0x02, 0x01, 0x03]
    const body = btoa(String.fromCharCode(...der))
    set(
      screen.getByLabelText(/public key \(pem\)/i),
      `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`,
    )
    switchToCipherTab()
    set(screen.getByLabelText(/^plaintext$/i), 'x')
    expect(screen.getByRole('button', { name: 'Encrypt' })).toHaveAttribute('aria-disabled', 'true')
  })
})
