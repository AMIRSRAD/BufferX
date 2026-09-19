/**
 * Host access for the saved-buffer library.
 *
 * The library reads `.bxb` documents from a folder the operator picks. Content
 * never enters application storage — see `store/library.ts` for why — so every
 * read goes to the filesystem, which means this is desktop-only. On web the
 * folder concept has no equivalent and callers must fall back to the existing
 * open/download flow.
 */

import { invoke } from '@tauri-apps/api/core'

import { hostCapabilities } from '@/engine/client'

/** One file in the library folder, as reported by the host. */
export interface LibraryFile {
  name: string
  path: string
  size: number
  /** Milliseconds since the Unix epoch, or 0 when the platform withholds it. */
  modified: number
}

export type ListResult =
  | { status: 'ok'; files: LibraryFile[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export type PickResult =
  | { status: 'ok'; folder: string }
  | { status: 'cancelled' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }

export function canUseLibrary(): boolean {
  return hostCapabilities().files
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Opens a folder picker. Only meaningful when `canUseLibrary()` is true. */
export async function pickLibraryFolder(): Promise<PickResult> {
  if (!canUseLibrary()) return { status: 'unavailable' }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ directory: true, multiple: false })
    if (typeof selected !== 'string') return { status: 'cancelled' }
    return { status: 'ok', folder: selected }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

/** Lists the saved buffers in `folder`, newest first. */
export async function listLibrary(folder: string, extension: string): Promise<ListResult> {
  if (!canUseLibrary()) return { status: 'unavailable' }
  try {
    const files = await invoke<LibraryFile[]>('list_buffer_files', { directory: folder, extension })
    return { status: 'ok', files }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

/** Reads one saved buffer. */
export async function readLibraryFile(
  path: string,
): Promise<{ status: 'ok'; text: string } | { status: 'error'; message: string }> {
  try {
    const text = await invoke<string>('read_text_file', { path })
    return { status: 'ok', text }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

/** Writes a saved buffer into the library folder. */
export async function writeLibraryFile(
  path: string,
  contents: string,
): Promise<{ status: 'ok' } | { status: 'error'; message: string }> {
  try {
    await invoke('write_text_file', { path, contents })
    return { status: 'ok' }
  } catch (cause) {
    return { status: 'error', message: errorMessage(cause) }
  }
}

/** Joins a folder and file name using the separator already in the path. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/'
  const trimmed = folder.replace(/[\\/]+$/, '')
  return `${trimmed}${separator}${name}`
}

/**
 * Turns a label into a safe file name.
 *
 * Reserved characters are replaced rather than stripped so two different labels
 * cannot collapse onto the same file and silently overwrite each other.
 */
export function toFileName(label: string, extension: string): string {
  const base = label
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120)
  const safe = base === '' ? 'buffer' : base
  const suffix = extension.startsWith('.') ? extension : `.${extension}`
  return safe.toLowerCase().endsWith(suffix.toLowerCase()) ? safe : `${safe}${suffix}`
}
