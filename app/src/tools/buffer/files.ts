/**
 * Buffer open / save, gated on host capability (UX_SPEC 5.7).
 *
 * Desktop: the native dialog plus the host's `read_text_file` / `write_text_file`
 * commands, so `Save` is a real save to a real path.
 * Web: a file input (or a drop) for open, and a download for save. `Save`
 * behaves as `Save As`, which the caller states in the UI rather than hiding.
 *
 * The Tauri modules are imported dynamically so the web bundle never pulls them
 * in and a browser build cannot fail at module-evaluation time.
 */

import { hostCapabilities } from '@/engine/client'

export interface PickedFile {
  name: string
  text: string
  /** Real filesystem path. Desktop only — the web has no path to show. */
  path?: string
}

export type OpenResult =
  | { status: 'ok'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type SaveResult =
  | { status: 'ok'; path?: string; downloaded: boolean }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

const BUFFER_FILTERS = [
  { name: 'BufferX buffer', extensions: ['bxb', 'json'] },
  { name: 'Hex capture', extensions: ['hex', 'txt'] },
  { name: 'Packager definitions', extensions: ['xml'] },
]

export function canUseNativeFiles(): boolean {
  return hostCapabilities().files
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/* ── Open ─────────────────────────────────────────────────────────────────── */

/** Native open dialog. Only call when `canUseNativeFiles()` is true. */
export async function openBufferNative(): Promise<OpenResult> {
  try {
    const [{ open }, { invoke }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/api/core'),
    ])
    const selected = await open({ multiple: false, directory: false, filters: BUFFER_FILTERS })
    if (typeof selected !== 'string') return { status: 'cancelled' }
    const text = await invoke<string>('read_text_file', { path: selected })
    return { status: 'ok', file: { name: basename(selected), text, path: selected } }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

/**
 * Browser open: a transient `<input type="file">`. Resolves `cancelled` when
 * the picker closes without a selection, which browsers report only via focus,
 * so the promise also settles on the window regaining focus.
 */
export function openBufferWeb(): Promise<OpenResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ status: 'error', message: 'No document to host a file picker.' })
      return
    }

    let settled = false
    const finish = (result: OpenResult) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(result)
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.bxb,.json,.hex,.txt,.xml,application/json,text/plain,text/xml'
    input.style.position = 'fixed'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) {
        finish({ status: 'cancelled' })
        return
      }
      void readFile(file).then(finish)
    })

    // A cancelled picker fires no event; the window regaining focus is the only
    // reliable signal. One frame of grace so a real `change` wins the race.
    const onFocus = () => {
      window.setTimeout(() => {
        if (!input.files || input.files.length === 0) finish({ status: 'cancelled' })
      }, 250)
    }

    document.body.appendChild(input)
    window.addEventListener('focus', onFocus, { once: true })
    input.click()
  })
}

export async function readFile(file: File): Promise<OpenResult> {
  try {
    const text = await file.text()
    return { status: 'ok', file: { name: file.name, text } }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

export async function openBuffer(): Promise<OpenResult> {
  return canUseNativeFiles() ? openBufferNative() : openBufferWeb()
}

/* ── Save ─────────────────────────────────────────────────────────────────── */

export async function saveBufferNative(
  suggestedName: string,
  contents: string,
  existingPath?: string,
): Promise<SaveResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    let target = existingPath
    if (!target) {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const picked = await save({ defaultPath: suggestedName, filters: BUFFER_FILTERS })
      if (typeof picked !== 'string') return { status: 'cancelled' }
      target = picked
    }
    await invoke('write_text_file', { path: target, contents })
    return { status: 'ok', path: target, downloaded: false }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

export function downloadText(name: string, contents: string, mime = 'application/json'): SaveResult {
  try {
    const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoke on the next tick: revoking synchronously cancels the download in
    // Safari and older Chromium.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return { status: 'ok', downloaded: true }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

export async function saveBuffer(
  suggestedName: string,
  contents: string,
  existingPath?: string,
): Promise<SaveResult> {
  if (canUseNativeFiles()) return saveBufferNative(suggestedName, contents, existingPath)
  return downloadText(suggestedName, contents)
}
