/**
 * Transport selection.
 *
 * BufferX runs in two hosts from one bundle. At startup we probe for the Tauri
 * runtime: if it is there we use native IPC (real sockets, real file dialogs,
 * full-speed C++), otherwise we fall back to the WASM build of the same core.
 * Both speak the identical envelope, so nothing above this file knows which
 * one it got.
 */

import {
  DESKTOP_CAPABILITIES,
  WEB_CAPABILITIES,
  type EngineRequest,
  type EngineResponse,
  type EngineTransport,
  type HostCapabilities,
} from './protocol'

declare global {
  interface Window {
    // Present only when running inside a Tauri webview.
    __TAURI_INTERNALS__?: unknown
  }
}

export function isTauriHost(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
}

/** Routes envelopes through Tauri IPC to the native C ABI. */
class NativeTransport implements EngineTransport {
  readonly kind = 'native' as const

  async invoke(request: EngineRequest): Promise<EngineResponse> {
    const { invoke } = await import('@tauri-apps/api/core')
    // The Rust side returns the envelope verbatim; it never reinterprets it.
    return (await invoke('engine_invoke', { request })) as EngineResponse
  }

  capabilities(): HostCapabilities {
    return DESKTOP_CAPABILITIES
  }
}

/**
 * Runs the core as WebAssembly in this tab. Computation only -- anything
 * needing the network or filesystem is reported as HOST_ONLY.
 */
class WasmTransport implements EngineTransport {
  readonly kind = 'wasm' as const

  #module: WasmEngineModule | null = null
  #loading: Promise<WasmEngineModule> | null = null

  async #load(): Promise<WasmEngineModule> {
    if (this.#module) return this.#module
    if (!this.#loading) {
      this.#loading = loadWasmEngine().then((module) => {
        this.#module = module
        return module
      })
    }
    return this.#loading
  }

  async invoke(request: EngineRequest): Promise<EngineResponse> {
    const module = await this.#load()
    const raw = module.invoke(JSON.stringify(request))
    return JSON.parse(raw) as EngineResponse
  }

  capabilities(): HostCapabilities {
    return WEB_CAPABILITIES
  }
}

export interface WasmEngineModule {
  invoke(requestJson: string): string
}

/**
 * Loads the Emscripten build of BufferXCore.
 *
 * The glue is produced by the WASM build (scripts/build-wasm.sh) and is absent
 * from the desktop bundle, so the specifier is computed rather than literal --
 * a static import would fail to type-check and would break the Tauri build.
 */
async function loadWasmEngine(): Promise<WasmEngineModule> {
  // BASE_URL is `/` for desktop/local development and `/bufferx/` for the
  // authenticated hosted build. This keeps both the glue module and its wasm
  // binary underneath the gated application prefix.
  const appBase = import.meta.env.BASE_URL.replace(/\/$/, '')
  const base = `${globalThis.location.origin}${appBase}/wasm`
  const factory = (await import(/* @vite-ignore */ `${base}/bufferx_core.js`)) as {
    default: (options?: Record<string, unknown>) => Promise<EmscriptenModule>
  }

  const instance = await factory.default({
    locateFile: (path: string) => `${base}/${path}`,
  })

  // The ABI is session-scoped so two hosts never share a packager registry.
  // One session per module instance is exactly right for a browser tab.
  const open = instance.cwrap('bufferx_open', 'number', []) as () => number
  const session = open()

  // Deliberately NOT cwrap(..., 'string', ...): that copies the result into a JS
  // string and drops the pointer, leaking the buffer the ABI malloc'd for every
  // single call. Take the pointer, read it, then hand it back to be freed.
  const invokeRaw = instance.cwrap('bufferx_invoke', 'number', ['number', 'string']) as (
    session: number,
    requestJson: string,
  ) => number
  const freeRaw = instance.cwrap('bufferx_string_free', null, ['number']) as (ptr: number) => void

  return {
    invoke(requestJson: string): string {
      const pointer = invokeRaw(session, requestJson)
      if (pointer === 0) {
        // The ABI contracts never to return NULL, so this means the module
        // itself is in trouble. Report it as an envelope rather than throwing
        // something the caller cannot interpret.
        return '{"ok":false,"error":{"code":"INTERNAL","message":"The engine returned no response."}}'
      }
      try {
        return instance.UTF8ToString(pointer)
      } finally {
        freeRaw(pointer)
      }
    },
  }
}

interface EmscriptenModule {
  cwrap(name: string, returnType: string | null, argTypes: string[]): unknown
  UTF8ToString(pointer: number): string
}

let cached: EngineTransport | null = null

export function getTransport(): EngineTransport {
  if (!cached) {
    cached = isTauriHost() ? new NativeTransport() : new WasmTransport()
  }
  return cached
}

/** Test seam: lets suites substitute a stub engine. */
export function setTransport(transport: EngineTransport | null): void {
  cached = transport
}
