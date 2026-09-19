/**
 * File plumbing for the Settings tool.
 *
 * Two hosts, one API. On the desktop build these calls reach the Tauri commands
 * (`read_text_file`, `write_text_file`) behind a native dialog; in a browser
 * they fall back to a file input and a download, which is exactly the
 * degradation UX_SPEC 5.7 prescribes -- the feature stays visible and usable,
 * only the path handling differs.
 *
 * Every Tauri import is dynamic. The same bundle ships to the web, where
 * `@tauri-apps/api` must never be evaluated.
 */

import { hostCapabilities } from '@/engine/client'

/** A file the operator chose, in whichever way this host offers. */
export interface PickedTextFile {
  /** Basename, always present. */
  name: string
  /** Absolute path on desktop, `null` in a browser. */
  path: string | null
  contents: string
}

export interface FilePickerFilter {
  name: string
  /** Extensions without the dot, e.g. `['xml']`. */
  extensions: string[]
}

/** True when native dialogs and real filesystem paths are available. */
export function canUseNativeFiles(): boolean {
  return hostCapabilities().files
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function messageOf(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error !== '') return error
  if (error instanceof Error && error.message !== '') return error.message
  return fallback
}

/**
 * Opens the native dialog and reads the chosen file.
 *
 * Returns `null` when the operator cancelled. Throws with the host's own
 * message when the read fails, so the panel can show it verbatim.
 */
export async function pickTextFileNative(
  title: string,
  filters: FilePickerFilter[],
): Promise<PickedTextFile | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selection = await open({ title, multiple: false, directory: false, filters })
  if (typeof selection !== 'string' || selection === '') return null

  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const contents = await invoke<string>('read_text_file', { path: selection })
    return { name: basename(selection), path: selection, contents }
  } catch (error) {
    throw new Error(messageOf(error, `Could not read ${basename(selection)}.`))
  }
}

/** Asks for a save path. Returns `null` when the operator cancelled. */
export async function pickSavePathNative(
  title: string,
  defaultName: string,
  filters: FilePickerFilter[],
): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const selection = await save({ title, defaultPath: defaultName, filters })
  return typeof selection === 'string' && selection !== '' ? selection : null
}

/** Writes text through the host command. Throws with the host's message. */
export async function writeTextFileNative(path: string, contents: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('write_text_file', { path, contents })
  } catch (error) {
    throw new Error(messageOf(error, `Could not write ${basename(path)}.`))
  }
}

/** Reads a path that is already known -- the Reload and Recent-open paths. */
export async function readTextFileNative(path: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<string>('read_text_file', { path })
  } catch (error) {
    throw new Error(messageOf(error, `Could not read ${basename(path)}.`))
  }
}

/** Reads a `File` from an `<input type="file">` or a drop. */
export async function readBrowserFile(file: File): Promise<PickedTextFile> {
  const contents = await file.text()
  return { name: file.name, path: null, contents }
}

/**
 * The web `Save`: a download. UX_SPEC 5.7 requires the note that this behaves
 * as `Save As`, which the calling panel renders.
 */
export function downloadText(name: string, contents: string, mime = 'application/json'): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick: Safari needs the object URL to outlive the click.
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Opens an external URL in a new tab.
 *
 * The desktop build has no shell-opener permission in
 * `src-tauri/capabilities/default.json`, so this is a webview tab there too.
 * Panels state that plainly rather than implying a system-browser hand-off.
 */
export function openExternal(url: string): void {
  globalThis.open(url, '_blank', 'noreferrer')
}

/** `C:\Users\…\packagers.xml` — head plus basename, never a bare truncation. */
export function elidePath(path: string, keep = 48): string {
  if (path.length <= keep) return path
  const name = basename(path)
  if (name.length + 2 >= keep) return `…${name.slice(-(keep - 1))}`
  return `${path.slice(0, keep - name.length - 1)}…${name}`
}

/** SHA-256 of a text file, hex, for the diagnostics readout. */
export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', bytes)
      const out: string[] = []
      for (const byte of new Uint8Array(digest)) out.push(byte.toString(16).padStart(2, '0'))
      return `sha256:${out.join('')}`
    } catch {
      /* Insecure context: fall through to the non-cryptographic marker. */
    }
  }
  // Not a security control -- it only tells two packager files apart in a
  // diagnostics report, and it is labelled as what it is.
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`
}
