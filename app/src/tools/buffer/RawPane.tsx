/**
 * The raw pane (UX_SPEC 2.3).
 *
 * ```
 * RAW   [Text│Hex│Bytes]  [Decode ⌃⏎] [Build ⌃⇧⏎] [Auto ✓]    [⧉ copy ▾] [Follow]
 * ── structure ribbon ───────────────────────────────────────────────────────
 * Framing  [Auto-detect ✓] [Include on build ☐] [ASCII│Binary] [size 4 ⇅] [+ Add length]
 * ```
 *
 * Three deliberate departures from the Qt panel are implemented here:
 * the 140–170px hard height cap is gone (the pane is a flex child that grows
 * with the window), the encoding control proposes rather than mutates, and the
 * framing state lives next to `+ Add length` instead of in a disconnected
 * settings popover.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Binary,
  Check,
  ChevronDown,
  Copy,
  Hammer,
  Hash,
  Lock,
  Play,
  Type,
  Unlock,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { HexViewer, type HexHighlight } from '@/components/ui/HexViewer'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { Popover } from '@/components/ui/Popover'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Textarea } from '@/components/ui/Textarea'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import type { HeaderConfig } from '@/store/buffers'
import { StructureRibbon } from './StructureRibbon'
import {
  bytesToHex,
  bytesToText,
  groupHex,
  isHexChar,
  nonAsciiOffsets,
  normalizeHex,
  offsetLabel,
  previewLengthPrefix,
  textToBytes,
  writeClipboard,
  type EncodingGuess,
  type Region,
} from './model'
import type { RawView } from './prefs'

export interface CopyFormat {
  id: string
  label: string
  build(): string
}

export interface RawPaneProps {
  raw: string
  inputHex: boolean
  bytes: Uint8Array
  regions: readonly Region[]
  highlights: readonly HexHighlight[]
  bufferName: string

  view: RawView
  onViewChange(view: RawView): void

  encodingGuess: EncodingGuess | null
  encodingLocked: boolean

  autoDecode: boolean
  onAutoDecodeChange(value: boolean): void
  follow: boolean
  onFollowChange(value: boolean): void

  decoding: boolean
  building: boolean
  verified: boolean | null
  /** Fields were edited after the last decode — the raw no longer matches. */
  rawStale: boolean

  onRawChange(raw: string): void
  onEncodingChange(inputHex: boolean, converted: string): void
  onDecode(): void
  onBuild(): void

  header: HeaderConfig
  autoDetect: boolean
  headerLocked: boolean
  headerOrigin: string
  detectedFlash: boolean
  onHeaderChange(patch: Partial<HeaderConfig>): void
  onAutoDetectChange(value: boolean): void
  onHeaderLockChange(value: boolean): void
  onAddLength(prefixHex: string): void

  selectedFieldId: number | null
  hoveredFieldId: number | null
  onHoverRegion(region: Region | null): void
  onSelectRegion(region: Region): void
  onSelectBytes(range: { start: number; end: number } | null): void

  copyFormats: readonly CopyFormat[]
  error: string | null
  onDismissError(): void
}

const VIEW_OPTIONS = [
  { value: 'text', label: 'Text', icon: Type },
  { value: 'hex', label: 'Hex', icon: Hash },
  { value: 'bytes', label: 'Bytes', icon: Binary },
]

/** Cycles Text → Hex → Bytes (`Ctrl+Shift+V`). */
export function nextRawView(view: RawView): RawView {
  return view === 'text' ? 'hex' : view === 'hex' ? 'bytes' : 'text'
}

export function RawPane(props: RawPaneProps) {
  const {
    raw,
    inputHex,
    bytes,
    regions,
    highlights,
    bufferName,
    view,
    onViewChange,
    encodingGuess,
    encodingLocked,
    autoDecode,
    onAutoDecodeChange,
    follow,
    onFollowChange,
    decoding,
    building,
    verified,
    rawStale,
    onRawChange,
    onEncodingChange,
    onDecode,
    onBuild,
    header,
    autoDetect,
    headerLocked,
    headerOrigin,
    detectedFlash,
    onHeaderChange,
    onAutoDetectChange,
    onHeaderLockChange,
    onAddLength,
    selectedFieldId,
    hoveredFieldId,
    onHoverRegion,
    onSelectRegion,
    onSelectBytes,
    copyFormats,
    error,
    onDismissError,
  } = props

  const [pendingConversion, setPendingConversion] = useState<{
    offsets: number[]
    text: string
  } | null>(null)
  const [addLengthOpen, setAddLengthOpen] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)

  /* ── Encoding switch (UX_SPEC 2.7) ────────────────────────────────────── */

  const requestEncoding = (next: 'text' | 'hex') => {
    const wantHex = next === 'hex'
    if (wantHex === inputHex) return
    setPendingConversion(null)

    if (wantHex) {
      // Text → Hex is always lossless.
      onEncodingChange(true, bytesToHex(bytes))
      return
    }

    const offsets = nonAsciiOffsets(bytes)
    const asText = bytesToText(bytes)
    if (offsets.length > 0) {
      setPendingConversion({ offsets, text: asText })
      return
    }
    onEncodingChange(false, asText)
  }

  /* ── Add length preview ───────────────────────────────────────────────── */

  const framingMode = header.mode === 'binary' ? 'binary' : 'ascii'
  const lengthPreview = previewLengthPrefix(bytes, framingMode, header.size)

  const framingActive = autoDetect || header.enabled

  return (
    <section
      aria-label={`Raw buffer for ${bufferName}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden p-panel"
    >
      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-field">
        <h2 className="text-2xs tracking-wide text-text-tertiary uppercase">Raw</h2>

        <SegmentedControl
          value={view}
          onValueChange={(value) => onViewChange(value as RawView)}
          options={VIEW_OPTIONS}
          aria-label="Raw view mode"
        />

        <span aria-hidden="true" className="h-4 w-px bg-border" />

        <SegmentedControl
          value={inputHex ? 'hex' : 'text'}
          onValueChange={(value) => requestEncoding(value === 'hex' ? 'hex' : 'text')}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'hex', label: 'Hex' },
          ]}
          aria-label="Buffer encoding"
        />

        {encodingGuess ? (
          <Tooltip
            content={
              encodingLocked
                ? 'You chose this encoding, so detection no longer changes it for this buffer.'
                : 'Detected from the pasted content. Change it and the choice sticks for this buffer.'
            }
          >
            <span>
              <Badge tone={encodingLocked ? 'neutral' : 'info'} mono>
                {`${encodingGuess === 'hex' ? 'Hex' : 'Text'} (${encodingLocked ? 'locked' : 'detected'})`}
              </Badge>
            </span>
          </Tooltip>
        ) : null}

        <span className="ml-auto flex items-center gap-field">
          {rawStale ? (
            <Tooltip content="Fields were edited after the last decode. Build to bring the raw buffer up to date.">
              <span>
                <Badge tone="warn" dot>
                  Raw is stale · fields edited
                </Badge>
              </span>
            </Tooltip>
          ) : null}

          {verified === true ? (
            <Tooltip content="The built buffer round-trips back to identical fields.">
              <span>
                <Badge tone="ok" dot>
                  verified
                </Badge>
              </span>
            </Tooltip>
          ) : null}
          {verified === false ? (
            <Tooltip content="The built buffer did not round-trip back to identical fields. The table was not modified.">
              <span>
                <Badge tone="warn" dot>
                  round-trip differs
                </Badge>
              </span>
            </Tooltip>
          ) : null}

          <Button size="sm" variant="primary" icon={Play} loading={decoding} onClick={onDecode}>
            Decode
          </Button>
          <Button size="sm" icon={Hammer} loading={building} onClick={onBuild}>
            Build
          </Button>

          <Tooltip content="Auto-decode 350 ms after typing stops, and immediately on paste or drop.">
            <span className="flex items-center">
              <Checkbox checked={autoDecode} onCheckedChange={onAutoDecodeChange} label="Auto" />
            </span>
          </Tooltip>

          <Tooltip content="Scroll the byte view to the selected field. Highlighting still happens when off.">
            <span className="flex items-center">
              <Checkbox checked={follow} onCheckedChange={onFollowChange} label="Follow" />
            </span>
          </Tooltip>

          <span className="flex items-center">
            <CopyButton value={raw} label="Copy raw buffer" />
            <Popover
              open={copyOpen}
              onOpenChange={setCopyOpen}
              align="end"
              padded={false}
              trigger={
                <span>
                  <IconButton icon={ChevronDown} label="Copy as…" size="xs" variant="ghost" />
                </span>
              }
            >
              <ul className="flex w-60 flex-col py-1">
                {copyFormats.map((format) => (
                  <li key={format.id}>
                    <CopyMenuItem
                      label={format.label}
                      value={format.build}
                      onDone={() => setCopyOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            </Popover>
          </span>
        </span>
      </div>

      {/* ── Structure ribbon ────────────────────────────────────────────── */}
      <StructureRibbon
        regions={regions}
        totalBytes={bytes.length}
        selectedFieldId={selectedFieldId}
        hoveredFieldId={hoveredFieldId}
        onHover={onHoverRegion}
        onSelect={onSelectRegion}
      />

      {/* ── Conversion guard (UX_SPEC 2.7) ──────────────────────────────── */}
      {pendingConversion ? (
        <InlineAlert
          tone="warn"
          title={`Converting to Text will lose ${pendingConversion.offsets.length} non-ASCII byte${pendingConversion.offsets.length === 1 ? '' : 's'}.`}
          onDismiss={() => setPendingConversion(null)}
          action={
            <span className="flex items-center gap-field">
              <Button
                size="xs"
                variant="primary"
                onClick={() => {
                  onEncodingChange(false, pendingConversion.text)
                  setPendingConversion(null)
                }}
              >
                Convert anyway
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setPendingConversion(null)}>
                Cancel
              </Button>
            </span>
          }
        >
          <span className="flex flex-wrap items-center gap-1">
            <span>Text mode does not support non-ASCII characters. Offsets:</span>
            {pendingConversion.offsets.slice(0, 24).map((offset) => (
              <button
                key={offset}
                type="button"
                onClick={() => {
                  onViewChange('bytes')
                  onSelectBytes({ start: offset, end: offset + 1 })
                }}
                className="rounded-xs bg-surface-2 px-1 font-mono text-mono-xs text-text hover:bg-surface-raised"
              >
                {offsetLabel(offset)}
              </button>
            ))}
            {pendingConversion.offsets.length > 24 ? (
              <span className="text-text-tertiary">
                +{pendingConversion.offsets.length - 24} more
              </span>
            ) : null}
          </span>
        </InlineAlert>
      ) : null}

      {error ? (
        <InlineAlert tone="error" title="Decode failed" onDismiss={onDismissError}>
          {error}
        </InlineAlert>
      ) : null}

      {/* ── Editor / viewer ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === 'text' ? (
          <Textarea
            value={raw}
            onValueChange={onRawChange}
            mono
            spellCheck={false}
            autoComplete="off"
            aria-label="Raw buffer, text"
            placeholder="Paste or build an ISO 8583 buffer here…"
            containerClassName="min-h-0 flex-1"
            className="resize-none"
          />
        ) : view === 'hex' ? (
          <HexEditor
            raw={raw}
            inputHex={inputHex}
            onCommit={(hex) => {
              // Editing hex while the buffer is in Text mode would otherwise
              // write hex into a text buffer. Committing switches the buffer's
              // representation instead — visibly, and as one undo entry.
              if (inputHex) onRawChange(hex)
              else onEncodingChange(true, hex)
            }}
          />
        ) : (
          <HexViewer
            bytes={bytes}
            highlights={highlights as HexHighlight[]}
            onHoverRange={(range) => {
              const region = range
                ? (regions.find((item) => item.start === range.start && item.end === range.end) ??
                  null)
                : null
              onHoverRegion(region)
            }}
            onSelectRange={(range) => {
              if (!range) return
              const region = regions.find(
                (item) => item.start === range.start && item.end === range.end,
              )
              if (region) onSelectRegion(region)
            }}
            onSelectBytes={onSelectBytes}
            aria-label={`Bytes of ${bufferName}`}
            className="min-h-0 flex-1"
          />
        )}
      </div>

      {/* ── Framing ─────────────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-field rounded-sm border border-border-subtle bg-surface-2 px-2 py-1',
          detectedFlash && 'inset-ring-1 inset-ring-accent',
        )}
      >
        <span className="text-2xs tracking-wide text-text-tertiary uppercase">Framing</span>

        <Checkbox
          checked={autoDetect}
          onCheckedChange={onAutoDetectChange}
          label="Auto-detect"
        />
        <Checkbox
          checked={header.enabled}
          onCheckedChange={(value) => onHeaderChange({ enabled: value })}
          label="Include on build"
        />

        {framingActive ? (
          <SegmentedControl
            value={framingMode}
            onValueChange={(value) =>
              onHeaderChange({ mode: value === 'binary' ? 'binary' : 'ascii' })
            }
            options={[
              { value: 'ascii', label: 'ASCII' },
              { value: 'binary', label: 'Binary' },
            ]}
            aria-label="Length header mode"
          />
        ) : (
          <Tooltip content="No header is in play: auto-detect is off and the header is not included on build. Turn either on to edit the mode.">
            <span>
              <Badge tone="neutral" mono>
                {framingMode === 'binary' ? 'Binary' : 'ASCII'} · unused
              </Badge>
            </span>
          </Tooltip>
        )}

        <label className="flex items-center gap-1 text-xs text-text-secondary">
          <span>size</span>
          <Tooltip content={headerOrigin}>
            <span className="w-16">
              <Input
                type="number"
                min={1}
                max={8}
                value={String(header.size)}
                onValueChange={(value) => {
                  const parsed = Number.parseInt(value, 10)
                  if (Number.isNaN(parsed)) return
                  onHeaderChange({ size: Math.max(1, Math.min(8, parsed)) })
                }}
                mono
                size="xs"
                aria-label="Length header size in bytes"
                suffix={<span className="text-2xs text-text-tertiary">B</span>}
              />
            </span>
          </Tooltip>
          <IconButton
            icon={headerLocked ? Lock : Unlock}
            label={
              headerLocked
                ? 'Header size is pinned against packager and legacy writes. Unlock it.'
                : 'Pin the header size against packager LenLen and legacy framing.'
            }
            size="xs"
            variant="ghost"
            onClick={() => onHeaderLockChange(!headerLocked)}
          />
        </label>

        <Popover
          open={addLengthOpen}
          onOpenChange={setAddLengthOpen}
          align="start"
          trigger={
            <span>
              <Button size="xs" variant="subtle" disabled={bytes.length === 0}>
                + Add length
              </Button>
            </span>
          }
        >
          <div className="flex w-80 flex-col gap-field">
            <p className="text-sm text-text">
              {lengthPreview.refusal ? (
                lengthPreview.refusal
              ) : (
                <>
                  Will prefix{' '}
                  <span className="font-mono text-mono-sm text-text">
                    {lengthPreview.prefixText
                      ? `"${lengthPreview.prefixText}"`
                      : groupHex(lengthPreview.prefixHex)}
                  </span>{' '}
                  ({header.size} {framingMode === 'ascii' ? 'ASCII' : 'binary'} byte
                  {header.size === 1 ? '' : 's'}). Total {lengthPreview.totalBytes} bytes.
                </>
              )}
            </p>
            <p className="text-2xs text-text-tertiary">
              Adding the header also turns on “Include on build”.
            </p>
            <div className="flex items-center justify-end gap-field">
              <Button size="xs" variant="ghost" onClick={() => setAddLengthOpen(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                variant="primary"
                disabled={lengthPreview.refusal !== null}
                onClick={() => {
                  onAddLength(lengthPreview.prefixHex)
                  setAddLengthOpen(false)
                }}
              >
                Add
              </Button>
            </div>
          </div>
        </Popover>

        <span className="ml-auto font-mono text-mono-xs text-text-tertiary tabular-nums">
          {bytes.length} bytes
          {inputHex && normalizeHex(raw).length % 2 === 1 ? (
            <span className="ml-1 text-warn">+ 1 nibble</span>
          ) : null}
        </span>
      </div>
    </section>
  )
}

/* ── Copy menu item ───────────────────────────────────────────────────────── */

function CopyMenuItem({
  label,
  value,
  onDone,
}: {
  label: string
  value: () => string
  onDone(): void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await writeClipboard(value())
        setCopied(ok)
        window.setTimeout(() => {
          setCopied(false)
          onDone()
        }, 900)
      }}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-1 text-left text-sm',
        'text-text-secondary hover:bg-surface-raised hover:text-text',
      )}
    >
      {copied ? (
        <Check size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="text-ok" />
      ) : (
        <Copy size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
      )}
      {label}
    </button>
  )
}

/* ── Hex editor ───────────────────────────────────────────────────────────── */

/**
 * Hex view. Pairs are grouped for reading, non-hex keystrokes never reach the
 * model, and an odd nibble count is a trailing amber marker rather than an
 * error. Grouping is presentational: the draft is kept locally so the caret
 * does not jump while typing, and it is reflowed on blur.
 */
function HexEditor({
  raw,
  inputHex,
  onCommit,
}: {
  raw: string
  inputHex: boolean
  onCommit(hex: string): void
}) {
  const canonical = inputHex ? normalizeHex(raw) : bytesToHex(textToBytes(raw))
  const [draft, setDraft] = useState(() => groupHex(canonical))
  const dirty = useRef(false)

  // Adopt external changes (decode, build, undo) unless the operator is typing.
  useEffect(() => {
    if (dirty.current) return
    setDraft(groupHex(canonical))
  }, [canonical])

  const commit = (next: string) => {
    let filtered = ''
    for (const ch of next) {
      if (isHexChar(ch) || ch === ' ' || ch === '\n') filtered += ch
    }
    dirty.current = true
    setDraft(filtered)
    onCommit(normalizeHex(filtered))
  }

  const half = normalizeHex(draft).length % 2 === 1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {!inputHex ? (
        <p className="shrink-0 text-2xs text-warn">
          The buffer is in Text mode. These are its bytes; editing here switches the buffer to Hex.
        </p>
      ) : null}
      <Textarea
        value={draft}
        onValueChange={commit}
        onBlur={() => {
          dirty.current = false
          setDraft(groupHex(normalizeHex(draft)))
        }}
        mono
        spellCheck={false}
        autoComplete="off"
        aria-label="Raw buffer, hex"
        placeholder="3031 3230 F23C 4491 …"
        containerClassName="min-h-0 flex-1"
        className="resize-none"
      />
      <div className="flex shrink-0 items-center gap-2 text-2xs text-text-tertiary">
        <span className="font-mono text-mono-xs tabular-nums">
          {Math.floor(normalizeHex(draft).length / 2)} bytes
        </span>
        {half ? <span className="text-warn">trailing half-byte</span> : null}
        <span className="ml-auto">
          The aligned byte grid, offsets and field colouring are in Bytes view.
        </span>
      </div>
    </div>
  )
}
