import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { setTransport } from '@/engine/transport'
import type { EngineRequest, EngineResponse, EngineTransport, HostCapabilities } from '@/engine/protocol'
import { DESKTOP_CAPABILITIES } from '@/engine/protocol'

/**
 * A scriptable stand-in for the engine. Suites register handlers per operation
 * so component tests never need a real WASM module or a running Tauri host.
 */
export class StubTransport implements EngineTransport {
  readonly kind = 'native' as const

  readonly calls: EngineRequest[] = []
  #handlers = new Map<string, (args: Record<string, unknown>) => EngineResponse>()
  #capabilities: HostCapabilities = DESKTOP_CAPABILITIES

  on(op: string, handler: (args: Record<string, unknown>) => EngineResponse): this {
    this.#handlers.set(op, handler)
    return this
  }

  reply(op: string, data: unknown): this {
    return this.on(op, () => ({ ok: true, data }))
  }

  withCapabilities(capabilities: HostCapabilities): this {
    this.#capabilities = capabilities
    return this
  }

  async invoke(request: EngineRequest): Promise<EngineResponse> {
    this.calls.push(request)
    const handler = this.#handlers.get(request.op)
    if (!handler) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_OP', message: `No stub registered for "${request.op}".` },
      }
    }
    return handler(request.args)
  }

  capabilities(): HostCapabilities {
    return this.#capabilities
  }
}

export let stubEngine: StubTransport

beforeEach(() => {
  stubEngine = new StubTransport()
  setTransport(stubEngine)
})

afterEach(() => {
  setTransport(null)
})
