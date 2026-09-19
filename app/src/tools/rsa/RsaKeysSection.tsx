/**
 * The shared Keys section of the RSA tool (UX_SPEC 3.4).
 *
 * Both sub-tabs read the same two PEM boxes, so the keys live above the tab
 * strip and survive a tab switch. Once loaded, a box collapses to a one-line
 * summary (`RSA private key · 2048 bit · loaded 11:40`) and expands back to the
 * full textarea on demand — the operator sees *that* a key is loaded without
 * the panel spending 200px on Base64.
 *
 * Both keys are memory-only. There is no persistence binding in this file by
 * design, and `Clear keys` (plus the shell's `Ctrl+Alt+L`) wipes them.
 */

import { useId, useRef, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, Eraser, FileUp } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Textarea } from '@/components/ui/Textarea'
import { hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { clockTime, type KeyState } from './model'
import { describeKey, findPemBlocks } from './pem'
import { Section } from './parts'

/** A PEM key is a few kilobytes; anything larger is the wrong file. */
const MAX_KEY_FILE_BYTES = 256 * 1024

export interface RsaKeysSectionProps {
  privateKey: KeyState
  publicKey: KeyState
  onChange(which: 'private' | 'public', pem: string, source: string | null): void
  onClear(): void
  /** Requirement error raised by the active sub-tab, e.g. `Sign needs a private key.` */
  privateError?: string | null
  publicError?: string | null
}

export function RsaKeysSection({
  privateKey,
  publicKey,
  onChange,
  onClear,
  privateError,
  publicError,
}: RsaKeysSectionProps) {
  const [open, setOpen] = useState(true)
  const capabilities = hostCapabilities()
  const hasKeys = privateKey.pem !== '' || publicKey.pem !== ''

  return (
    <Section
      title="Keys"
      action={
        <div className="flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            icon={Eraser}
            disabled={!hasKeys}
            title={hasKeys ? undefined : 'No key material is loaded.'}
            onClick={onClear}
          >
            Clear keys
          </Button>
          <Button
            size="xs"
            variant="ghost"
            icon={open ? ChevronDown : ChevronRight}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        </div>
      }
    >
      {open ? (
        <div className="flex flex-col gap-field">
          <KeyBox
            which="private"
            label="Private key (PEM)"
            state={privateKey}
            onChange={onChange}
            error={privateError ?? null}
            canReadFiles={capabilities.keyFiles}
          />
          <KeyBox
            which="public"
            label="Public key (PEM)"
            state={publicKey}
            onChange={onChange}
            error={publicError ?? null}
            canReadFiles={capabilities.keyFiles}
          />
          <p className="text-2xs text-text-tertiary">
            Key material is held in memory only. Neither PEM is saved, logged, or included in
            diagnostics.
            {capabilities.keyFiles ? null : ` ${capabilityHint('keyFiles')}`}
          </p>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">
          {hasKeys
            ? `${privateKey.pem === '' ? 'No private key' : 'Private key loaded'} · ${
                publicKey.pem === '' ? 'no public key' : 'public key loaded'
              }`
            : 'No key material loaded.'}
        </p>
      )}
    </Section>
  )
}

/* ── One PEM box ─────────────────────────────────────────────────────────── */

interface KeyBoxProps {
  which: 'private' | 'public'
  label: string
  state: KeyState
  onChange(which: 'private' | 'public', pem: string, source: string | null): void
  error: string | null
  canReadFiles: boolean
}

function KeyBox({ which, label, state, onChange, error, canReadFiles }: KeyBoxProps) {
  const fieldId = useId()
  /**
   * Collapsing is a property of the box, not of the value: a key that arrives
   * from a file collapses immediately, a key being typed or pasted collapses
   * when the box loses focus. Collapsing mid-keystroke — which is what
   * "collapse as soon as it is non-empty" would do — would pull the textarea
   * out from under the operator.
   */
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)

  const loaded = state.pem.trim() !== ''
  // An empty box always shows the textarea, because there is nothing to summarise.
  const showTextarea = !loaded || !collapsed

  const shapeProblem = keyShapeProblem(which, state)

  async function acceptFile(file: File): Promise<void> {
    setFileError(null)
    if (file.size > MAX_KEY_FILE_BYTES) {
      setFileError(
        `${file.name} is ${(file.size / 1024).toFixed(0)} KB. A PEM key file is a few kilobytes; this is probably the wrong file.`,
      )
      return
    }
    const text = await file.text()
    if (findPemBlocks(text).length === 0) {
      setFileError(`No PEM block found in ${file.name}. The file must contain a -----BEGIN…----- block.`)
      return
    }
    onChange(which, text.trim(), file.name)
    setCollapsed(true)
  }

  async function loadFromDisk(): Promise<void> {
    setFileError(null)
    if (!canReadFiles) {
      fileInput.current?.click()
      return
    }
    setLoading(true)
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Load ${which} key`,
        filters: [
          { name: 'PEM key', extensions: ['pem', 'key', 'pub', 'crt', 'cer', 'txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      })
      if (typeof selected !== 'string') return
      const { invoke } = await import('@tauri-apps/api/core')
      const contents = await invoke<string>('read_text_file', { path: selected })
      if (findPemBlocks(contents).length === 0) {
        setFileError('That file contains no PEM block. The file must contain a -----BEGIN…----- block.')
        return
      }
      onChange(which, contents.trim(), fileNameOf(selected))
      setCollapsed(true)
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : 'The key file could not be read.')
    } finally {
      setLoading(false)
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files.item(0)
    if (file) void acceptFile(file)
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2">
        <label htmlFor={fieldId} className="flex items-center gap-1.5 text-xs text-text-secondary">
          {label}
          {which === 'private' ? <Badge tone="warn">secret</Badge> : null}
        </label>

        <div className="flex items-center gap-1">
          {loaded ? (
            <Button
              size="xs"
              variant="ghost"
              icon={collapsed ? ChevronRight : ChevronDown}
              aria-expanded={!collapsed}
              aria-controls={fieldId}
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? 'Expand' : 'Collapse'}
            </Button>
          ) : null}
          <Button
            size="xs"
            variant="subtle"
            icon={FileUp}
            loading={loading}
            onClick={() => void loadFromDisk()}
          >
            Load from file…
          </Button>
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-sm transition-colors duration-fast ease-standard motion-reduce:transition-none',
          dragging && 'ring-2 ring-accent',
        )}
      >
        {showTextarea ? (
          <Textarea
            id={fieldId}
            value={state.pem}
            onValueChange={(value) => onChange(which, value, value.trim() === '' ? null : 'pasted')}
            mono
            rows={loaded ? 6 : 3}
            invalid={error !== null || shapeProblem !== null}
            spellCheck={false}
            autoComplete="off"
            onBlur={() => {
              // Leaving a box that now holds a recognisable key collapses it to
              // the one-line summary (UX_SPEC 3.4).
              if (loaded && state.info) setCollapsed(true)
            }}
            placeholder={
              which === 'private'
                ? '-----BEGIN PRIVATE KEY-----  (paste, drop a file, or load one)'
                : '-----BEGIN PUBLIC KEY-----  (paste, drop a file, or load one)'
            }
            aria-describedby={`${fieldId}-note`}
          />
        ) : (
          <button
            type="button"
            id={fieldId}
            onClick={() => setCollapsed(false)}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-left',
              'text-xs text-text hover:bg-surface-raised',
            )}
          >
            <ChevronRight size={14} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{summaryOf(state)}</span>
            <span className="shrink-0 text-text-tertiary">Expand</span>
          </button>
        )}
      </div>

      <p id={`${fieldId}-note`} className="text-2xs text-text-tertiary">
        {canReadFiles
          ? 'Load a file from disk, or drop one onto the box.'
          : 'Pick a file or drop one onto the box — it is read in this tab and never uploaded.'}
      </p>

      {/* Web fallback for `Load from file…`; harmless and unused on desktop. */}
      <input
        ref={fileInput}
        type="file"
        accept=".pem,.key,.pub,.crt,.cer,.txt,application/x-pem-file,text/plain"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0)
          if (file) void acceptFile(file)
          event.target.value = ''
        }}
      />

      {shapeProblem ? (
        <InlineAlert tone="warn">{shapeProblem}</InlineAlert>
      ) : null}
      {error ? <p className="text-xs text-error">{error}</p> : null}
      {fileError ? (
        <InlineAlert tone="error" title="Key file not loaded" onDismiss={() => setFileError(null)}>
          {fileError}
        </InlineAlert>
      ) : null}
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function summaryOf(state: KeyState): string {
  const parts: string[] = []
  parts.push(state.info ? describeKey(state.info) : 'PEM text (unrecognised block)')
  if (state.loadedAt !== null) parts.push(`loaded ${clockTime(state.loadedAt)}`)
  if (state.source) parts.push(state.source)
  return parts.join(' · ')
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/**
 * Client-side shape check (UX_SPEC 5.1 tier 1). It runs on every keystroke, so
 * pasting a public key into the private box is caught before a button is
 * pressed rather than by a backend error afterwards.
 */
function keyShapeProblem(which: 'private' | 'public', state: KeyState): string | null {
  if (state.pem.trim() === '') return null
  if (!state.info) {
    return 'No PEM block found. The text must contain a -----BEGIN…----- / -----END…----- pair.'
  }
  const { kind, blockCount } = state.info

  if (which === 'private') {
    if (kind === 'encrypted-private') {
      return 'This is an encrypted PEM private key. Decrypt it first — the engine cannot take a passphrase.'
    }
    if (kind === 'public') return 'This is a public key. Signing and decryption need the private key.'
    if (kind === 'certificate') {
      return 'This is an X.509 certificate. Extract the private key, or paste the certificate into the public key box.'
    }
    if (kind === 'unknown') return `Unrecognised PEM block "${state.info.label}".`
  } else {
    if (kind === 'private' || kind === 'encrypted-private') {
      return 'This is a private key. The public key box takes a public key or a certificate.'
    }
    if (kind === 'unknown') return `Unrecognised PEM block "${state.info.label}".`
  }

  if (blockCount > 1) {
    return `This text holds ${blockCount} PEM blocks; only the first one is used.`
  }
  return null
}
