import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTransport } from '@/engine/transport'
import type { EngineRequest, EngineResponse, EngineTransport } from '@/engine/protocol'
import AboutPanel from './AboutPanel'
import { PRODUCT } from './identity'

function stubTransport(answer: (request: EngineRequest) => EngineResponse): EngineTransport {
  return {
    kind: 'wasm',
    async invoke(request) {
      return answer(request)
    },
    capabilities() {
      return { tcp: false, files: false, keyFiles: false, desktop: false }
    },
  }
}

afterEach(() => {
  setTransport(null)
  vi.restoreAllMocks()
})

describe('AboutPanel', () => {
  it('renders the credits and the engine version', async () => {
    setTransport(
      stubTransport((request) =>
        request.op === 'engine.version'
          ? { ok: true, data: { version: '2.0.0', protocol: 1 } }
          : { ok: true, data: { packagers: [] } },
      ),
    )

    render(<AboutPanel />)

    expect(screen.getByText(PRODUCT.creator)).toBeInTheDocument()
    expect(screen.getByText(PRODUCT.ownership)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('2.0.0')).toBeInTheDocument())
  })

  it('shows the engine failure inline rather than blanking the panel', async () => {
    setTransport(
      stubTransport((request) =>
        request.op === 'engine.version'
          ? { ok: false, error: { code: 'INTERNAL', message: 'The engine could not be reached.' } }
          : { ok: true, data: { packagers: [] } },
      ),
    )

    render(<AboutPanel />)

    await waitFor(() =>
      expect(screen.getByText(/The engine did not report its version\./)).toBeInTheDocument(),
    )
    expect(screen.getByText(/The engine could not be reached\./)).toBeInTheDocument()
    // The rest of the screen still renders — that is the point of a diagnostics tool.
    expect(screen.getByText(PRODUCT.creator)).toBeInTheDocument()
  })
})
