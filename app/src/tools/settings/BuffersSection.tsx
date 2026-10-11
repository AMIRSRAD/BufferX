/**
 * Settings → Buffers and session (UX_SPEC 3.9).
 *
 * "`Open…` · `Save` · `Save As…` · Recent buffers list with paths, timestamps,
 * and pin/remove. Autosave-drafts toggle (default on, see 5.5). Current path
 * display."
 *
 * Web degradation follows 5.7 exactly: open is a file input plus drag-and-drop,
 * `Save` behaves as `Save As` (a download) *with the note*, and recent entries
 * keep names but say why they cannot be reopened.
 */

import { useRef, useState } from 'react'
import { FileDown, FilePlus2, FolderOpen, Pin, PinOff, Save, Upload, X } from 'lucide-react'
import { useBuffers } from '@/store/buffers'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Switch } from '@/components/ui/Switch'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { capabilityHint } from '@/engine/protocol'
import { Readout, ReadoutGroup, SectionCard, SettingRow } from './parts'
import {
  BUFFER_FILE_EXTENSION,
  parseBufferFile,
  sensitiveFieldsIn,
  serializeBuffer,
  suggestedFileName,
} from './bufferFile'
import {
  canUseNativeFiles,
  downloadText,
  elidePath,
  pickSavePathNative,
  pickTextFileNative,
  readBrowserFile,
  readTextFileNative,
  writeTextFileNative,
} from './hostFiles'
import { usePreferences } from './preferences'
import { LibraryLocation } from './LibraryLocation'

const BUFFER_FILTERS = [{ name: 'BufferX buffers', extensions: [BUFFER_FILE_EXTENSION, 'json'] }]

function relativeTime(at: number): string {
  if (at === 0) return 'unknown'
  const delta = Date.now() - at
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${String(minutes)} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${String(hours)} h ago`
  return new Date(at).toLocaleDateString()
}

export function BuffersSection() {
  const nativeFiles = canUseNativeFiles()

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const newTab = useBuffers((state) => state.newTab)
  const update = useBuffers((state) => state.update)
  const active = tabs.find((tab) => tab.id === activeId)

  const framing = usePreferences((state) => state.framing)
  const autosaveDrafts = usePreferences((state) => state.autosaveDrafts)
  const setAutosaveDrafts = usePreferences((state) => state.setAutosaveDrafts)
  const recents = usePreferences((state) => state.recents)
  const rememberRecent = usePreferences((state) => state.rememberRecent)
  const toggleRecentPin = usePreferences((state) => state.toggleRecentPin)
  const removeRecent = usePreferences((state) => state.removeRecent)
  const clearRecents = usePreferences((state) => state.clearRecents)
  const bufferPaths = usePreferences((state) => state.bufferPaths)
  const setBufferPath = usePreferences((state) => state.setBufferPath)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'open' | 'save' | 'saveAs' | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const activePath = active ? (bufferPaths[active.id] ?? null) : null
  const sensitive = active ? sensitiveFieldsIn(active.fields) : []

  function adoptFile(name: string, path: string | null, contents: string) {
    const parsed = parseBufferFile(contents, name)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(null)
    const id = newTab({
      ...parsed.init,
      // A file with no framing preference of its own inherits the defaults.
      autoDetect: parsed.init.autoDetect ?? framing.autoDetect,
    })
    if (path) setBufferPath(id, path)
    rememberRecent({ name, path })
    toast.success(`Opened ${name}`)
  }

  async function onOpen() {
    setError(null)
    if (!nativeFiles) {
      inputRef.current?.click()
      return
    }
    setBusy('open')
    try {
      const picked = await pickTextFileNative('Open buffer', BUFFER_FILTERS)
      if (picked) adoptFile(picked.name, picked.path, picked.contents)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The buffer could not be opened.')
    } finally {
      setBusy(null)
    }
  }

  async function onFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setError(null)
    try {
      const picked = await readBrowserFile(file)
      adoptFile(picked.name, null, picked.contents)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The buffer could not be read.')
    }
  }

  async function onSave(forceDialog: boolean) {
    if (!active) return
    setError(null)
    const contents = serializeBuffer(active)
    const fileName = suggestedFileName(active)

    if (!nativeFiles) {
      // 5.7: `Save` is a download on web, and the note says so.
      downloadText(fileName, contents)
      rememberRecent({ name: fileName, path: null })
      update(active.id, { dirty: false })
      toast.success(`Downloaded ${fileName}`)
      return
    }

    setBusy(forceDialog ? 'saveAs' : 'save')
    try {
      let path = forceDialog ? null : activePath
      if (path === null) {
        path = await pickSavePathNative('Save buffer', fileName, BUFFER_FILTERS)
        if (path === null) return
      }
      await writeTextFileNative(path, contents)
      setBufferPath(active.id, path)
      const name = path.split(/[\\/]/).pop() ?? fileName
      update(active.id, { name, dirty: false })
      rememberRecent({ name, path })
      toast.success(`Saved ${name}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The buffer could not be saved.')
    } finally {
      setBusy(null)
    }
  }

  async function openRecent(path: string, name: string) {
    setError(null)
    try {
      const contents = await readTextFileNative(path)
      adoptFile(name, path, contents)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not reopen ${name}.`)
    }
  }

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Buffer files"
        description="Buffer files carry packager, raw text, framing and field values — never tool secrets."
        action={
          <>
            <Button size="xs" icon={nativeFiles ? FolderOpen : Upload} onClick={() => void onOpen()} loading={busy === 'open'}>
              Open…
            </Button>
            <Button
              size="xs"
              icon={nativeFiles ? Save : FileDown}
              onClick={() => void onSave(false)}
              loading={busy === 'save'}
              disabled={!active}
            >
              Save
            </Button>
            <Button
              size="xs"
              icon={FilePlus2}
              onClick={() => void onSave(true)}
              loading={busy === 'saveAs'}
              disabled={!active}
            >
              Save As…
            </Button>
          </>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={`.${BUFFER_FILE_EXTENSION},.json,application/json`}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void onFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void onFiles(event.dataTransfer.files)
          }}
          className={cn(
            'rounded-sm border border-dashed p-panel text-xs transition-colors duration-fast ease-standard',
            dragging ? 'border-accent bg-accent-muted text-text' : 'border-border-subtle bg-surface-inset text-text-secondary',
          )}
        >
          Drop a <span className="font-mono text-mono-xs">.{BUFFER_FILE_EXTENSION}</span> file here to open it in
          a new tab.
        </div>

        {!nativeFiles ? (
          <InlineAlert tone="info" title="This host saves by downloading">
            {capabilityHint('files')} Here, <strong>Save</strong> behaves as <strong>Save As</strong>: the file
            is downloaded and no path is kept, so the tab keeps its name.
          </InlineAlert>
        ) : null}

        {sensitive.length > 0 ? (
          <InlineAlert tone="warn" title="This buffer contains PIN and track data">
            Fields {sensitive.map((id) => `F${String(id)}`).join(' and ')} are populated. Saving writes them to
            the file as message content. Store it accordingly.
          </InlineAlert>
        ) : null}

        {error ? (
          <InlineAlert tone="error" title="File operation failed" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        ) : null}

        <ReadoutGroup>
          <Readout label="Active buffer" value={active?.name ?? ''} />
          <Readout
            label="Current path"
            value={activePath ?? ''}
            display={
              activePath ? (
                elidePath(activePath)
              ) : (
                <span className="text-text-tertiary">{nativeFiles ? 'not saved yet' : 'not available on this host'}</span>
              )
            }
          />
          <Readout label="Unsaved changes" value={active ? (active.dirty ? 'yes' : 'no') : ''} />
          <Readout label="Fields" value={active ? String(active.fields.length) : ''} />
        </ReadoutGroup>
      </SectionCard>

      <LibraryLocation />
      <SectionCard title="Session">
        <Switch
          checked={autosaveDrafts}
          onCheckedChange={setAutosaveDrafts}
          label="Autosave drafts"
          description="Keep a draft of each open unsaved buffer so a reload does not lose work. Drafts hold message content; tool secrets are never written."
        />
        <SettingRow
          labelAs="span"
          label="Open buffers"
          hint="Buffers themselves are never persisted — they can contain PANs."
          control={<span className="font-mono text-mono-sm text-text">{tabs.length}</span>}
        />
      </SectionCard>

      <SectionCard
        title="Recent buffers"
        description={
          nativeFiles
            ? 'Paths only. Contents are never stored.'
            : 'Names only. A browser never reveals a path, so these cannot be reopened — drop the file again.'
        }
        action={
          recents.length > 0 ? (
            <Button size="xs" variant="ghost" onClick={clearRecents}>
              Clear
            </Button>
          ) : null
        }
      >
        {recents.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No recent buffers"
            description="Files you open or save from here are listed for quick reopening."
          />
        ) : (
          <ul className="flex flex-col">
            {recents.map((entry) => {
              const reopenable = nativeFiles && entry.path !== null
              return (
                <li
                  key={entry.id}
                  className="flex items-center gap-1.5 border-b border-border-subtle py-cell-y last:border-b-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm text-text" title={entry.path ?? entry.name}>
                      {entry.name}
                    </span>
                    <span className="truncate font-mono text-mono-xs text-text-tertiary">
                      {entry.path ? elidePath(entry.path, 56) : 'no path on this host'} · {relativeTime(entry.at)}
                    </span>
                  </span>
                  <Tooltip
                    content={
                      reopenable
                        ? `Open ${entry.name}`
                        : 'Not reopenable: this host gave no path. Drop the file again to open it.'
                    }
                  >
                    <span>
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!reopenable}
                        onClick={() => {
                          if (entry.path) void openRecent(entry.path, entry.name)
                        }}
                      >
                        Open
                      </Button>
                    </span>
                  </Tooltip>
                  {entry.path ? <CopyButton value={entry.path} size="xs" variant="ghost" /> : null}
                  <IconButton
                    icon={entry.pinned ? PinOff : Pin}
                    label={entry.pinned ? `Unpin ${entry.name}` : `Pin ${entry.name}`}
                    size="xs"
                    variant="ghost"
                    onClick={() => toggleRecentPin(entry.id)}
                  />
                  <IconButton
                    icon={X}
                    label={`Remove ${entry.name} from the list`}
                    size="xs"
                    variant="ghost"
                    onClick={() => removeRecent(entry.id)}
                  />
                </li>
              )
            })}
          </ul>
        )}

        {recents.some((entry) => entry.pinned) ? (
          <p className="flex items-center gap-1 text-xs text-text-tertiary">
            <Pin size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            Pinned entries are kept by <span className="text-text-secondary">Clear</span>; remove them
            individually.
          </p>
        ) : null}
      </SectionCard>
    </div>
  )
}
