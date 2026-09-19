/**
 * Saved buffers — a curated library of reusable test messages.
 *
 * The library is a folder of `.bxb` documents the operator chooses. BufferX
 * remembers the folder and per-file annotations; the messages themselves stay
 * in those files. That is the point: a saved buffer carries a PAN, track 2 data
 * and a PIN block, and the operator's own filesystem is where retention and
 * encryption are already handled. See `store/library.ts`.
 *
 * Desktop-only, and honestly so: a browser has no folder to read. On web the
 * panel explains that and points at the workspace's open/download flow rather
 * than pretending to work.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FolderOpen,
  FolderSearch,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers } from '@/store/buffers'
import { useLibrary } from '@/store/library'
import {
  BUFFER_FILE_EXTENSION,
  BUFFER_FILE_FORMAT,
  BUFFER_FILE_VERSION,
  bufferFileToTabInit,
  encodeBufferFile,
  sensitiveFieldNote,
} from '@/tools/buffer/model'
import {
  canUseLibrary,
  joinPath,
  listLibrary,
  pickLibraryFolder,
  readLibraryFile,
  toFileName,
  writeLibraryFile,
  type LibraryFile,
} from './libraryFiles'

/** A file plus whatever the operator has said about it. */
interface Entry extends LibraryFile {
  label: string
  note: string
  pinned: boolean
}

function formatWhen(ms: number): string {
  if (ms <= 0) return '—'
  const date = new Date(ms)
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} kB`
}

export default function LibraryPanel() {
  const available = canUseLibrary()

  const folder = useLibrary((state) => state.folder)
  const notes = useLibrary((state) => state.notes)
  const setFolder = useLibrary((state) => state.setFolder)
  const annotate = useLibrary((state) => state.annotate)
  const togglePin = useLibrary((state) => state.togglePin)
  const forget = useLibrary((state) => state.forget)

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const newTab = useBuffers((state) => state.newTab)
  const active = tabs.find((tab) => tab.id === activeId)

  const [files, setFiles] = useState<LibraryFile[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draftLabel, setDraftLabel] = useState('')
  const [saveName, setSaveName] = useState('')

  const refresh = useCallback(async () => {
    if (!folder || !available) return
    setLoading(true)
    const result = await listLibrary(folder, BUFFER_FILE_EXTENSION)
    setLoading(false)

    if (result.status === 'ok') {
      setFiles(result.files)
      setError(null)
      return
    }
    setFiles([])
    setError(
      result.status === 'unavailable'
        ? capabilityHint('files')
        : `${result.message} The folder may have been moved or removed.`,
    )
  }, [folder, available])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const entries = useMemo<Entry[]>(() => {
    const list = (files ?? []).map((file) => {
      const note = notes[file.path]
      return {
        ...file,
        label: note?.label ?? file.name.replace(/\.bxb$/i, ''),
        note: note?.note ?? '',
        pinned: note?.pinned ?? false,
      }
    })

    const needle = filter.trim().toLowerCase()
    const matched = needle
      ? list.filter(
          (entry) =>
            entry.label.toLowerCase().includes(needle) ||
            entry.note.toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle),
        )
      : list

    // Pinned first, then whatever order the host reported (newest first).
    return [...matched].sort((a, b) => Number(b.pinned) - Number(a.pinned))
  }, [files, notes, filter])

  async function choose() {
    const result = await pickLibraryFolder()
    if (result.status === 'cancelled') return
    if (result.status !== 'ok') {
      toast.error(result.status === 'unavailable' ? capabilityHint('files') : result.message)
      return
    }
    setFolder(result.folder)
    setFiles(null)
  }

  async function openEntry(entry: Entry) {
    const result = await readLibraryFile(entry.path)
    if (result.status !== 'ok') {
      toast.error(result.message)
      return
    }
    const { init, parsed } = bufferFileToTabInit(entry.label, result.text)
    newTab(init)
    toast.success(parsed ? `Opened ${entry.label}.` : `Opened ${entry.label} as a raw capture.`)
  }

  async function saveActive() {
    if (!folder || !active) return
    const label = saveName.trim() || active.name
    const fileName = toFileName(label, BUFFER_FILE_EXTENSION)
    const path = joinPath(folder, fileName)

    const existing = files?.some((file) => file.name.toLowerCase() === fileName.toLowerCase())
    if (existing && !window.confirm(`${fileName} already exists in this folder. Replace it?`)) {
      return
    }

    const contents = encodeBufferFile({
      format: BUFFER_FILE_FORMAT,
      version: BUFFER_FILE_VERSION,
      name: label,
      packager: active.packager,
      raw: active.raw,
      rawFormat: active.inputHex ? 'hex' : 'text',
      header: active.header,
      autoDetect: active.autoDetect,
      fields: active.fields.map((field) => ({
        id: field.id,
        value: field.value,
        hex: field.hex ?? false,
      })),
    })

    const result = await writeLibraryFile(path, contents)
    if (result.status !== 'ok') {
      toast.error(result.message)
      return
    }

    // Saying which sensitive fields just landed on disk is the honest thing to
    // do — the operator is choosing where card data lives, so they should know
    // it is in there.
    const note = sensitiveFieldNote(active.fields.map((field) => field.id))
    toast.success(`Saved ${fileName}.`, note ? { description: note } : undefined)
    setSaveName('')
    void refresh()
  }

  function commitRename(path: string) {
    annotate(path, { label: draftLabel.trim() || undefined })
    setRenaming(null)
    setDraftLabel('')
  }

  if (!available) {
    return (
      <div className="p-panel">
        <EmptyState
          icon={FolderSearch}
          title="The library needs the desktop app"
          description={`${capabilityHint('files')} Saved buffers live in a folder on disk, and a browser cannot read one. You can still open and download individual buffers from the workspace.`}
        />
      </div>
    )
  }

  if (!folder) {
    return (
      <div className="p-panel">
        <EmptyState
          icon={FolderOpen}
          title="Choose a folder for saved buffers"
          description="Pick a folder to keep reusable test messages in. BufferX remembers where it is and what you call each message; the messages themselves stay in your files, so card data never enters application storage."
          action={
            <Button variant="primary" icon={FolderOpen} onClick={choose}>
              Choose folder…
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-group p-panel">
      <div className="flex flex-col gap-field">
        <div className="flex items-center gap-field">
          <Tooltip content={folder}>
            <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-secondary">
              {folder}
            </span>
          </Tooltip>
          <IconButton icon={RefreshCw} label="Refresh the list" size="xs" onClick={() => void refresh()} />
          <IconButton icon={FolderSearch} label="Choose a different folder" size="xs" onClick={choose} />
        </div>

        {active ? (
          <div className="flex items-center gap-field">
            <Input
              value={saveName}
              onValueChange={setSaveName}
              placeholder={active.name}
              aria-label="Name for the saved buffer"
              size="sm"
            />
            <Button
              size="sm"
              icon={Save}
              onClick={() => void saveActive()}
              disabled={active.raw.trim() === '' && active.fields.length === 0}
            >
              Save current
            </Button>
          </div>
        ) : null}

        <Input
          value={filter}
          onValueChange={setFilter}
          placeholder="filter…"
          aria-label="Filter saved buffers"
          size="sm"
        />
      </div>

      {error ? <InlineAlert tone="error" title="Could not read the folder">{error}</InlineAlert> : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && files === null ? (
          <div className="flex flex-col gap-field">
            <Skeleton height="2.5rem" />
            <Skeleton height="2.5rem" />
            <Skeleton height="2.5rem" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Save}
            title={filter ? 'Nothing matches that filter' : 'No saved buffers yet'}
            description={
              filter
                ? undefined
                : `Build or paste a message, then use Save current to keep it here for reuse.`
            }
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {entries.map((entry) => (
              <li
                key={entry.path}
                className={cn(
                  'group rounded-sm border border-border-subtle bg-surface-1 px-cell-x py-cell-y',
                  'hover:border-border hover:bg-surface-raised',
                )}
              >
                <div className="flex items-center gap-field">
                  {renaming === entry.path ? (
                    <Input
                      value={draftLabel}
                      onValueChange={setDraftLabel}
                      autoFocus
                      size="xs"
                      aria-label={`Rename ${entry.label}`}
                      onBlur={() => commitRename(entry.path)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(entry.path)
                        if (event.key === 'Escape') {
                          setRenaming(null)
                          setDraftLabel('')
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-sm hover:text-accent"
                      onClick={() => void openEntry(entry)}
                      title={`Open ${entry.name}`}
                    >
                      {entry.label}
                    </button>
                  )}

                  <span className="shrink-0 tabular-nums text-2xs text-text-tertiary">
                    {formatWhen(entry.modified)} · {formatSize(entry.size)}
                  </span>

                  <IconButton
                    icon={entry.pinned ? PinOff : Pin}
                    label={entry.pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
                    size="xs"
                    variant="ghost"
                    onClick={() => togglePin(entry.path)}
                  />
                  <IconButton
                    icon={Pencil}
                    label={`Rename ${entry.label}`}
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setRenaming(entry.path)
                      setDraftLabel(entry.label)
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label={`Forget ${entry.label}`}
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      forget(entry.path)
                      toast.info(`Forgot the label for ${entry.name}. The file was not deleted.`)
                    }}
                  />
                </div>

                {entry.note ? (
                  <p className="mt-0.5 truncate text-2xs text-text-tertiary">{entry.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-2xs text-text-tertiary">
        Buffers are stored as files in this folder. BufferX keeps only the folder path and your
        labels — never the message content.
      </p>
    </div>
  )
}
