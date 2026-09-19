/**
 * The value sheet (UX_SPEC 2.4, `Alt+Enter`).
 *
 * A wide editor for one field: multi-line value, hex/text toggle, byte length,
 * a hex dump of just that field, and — for TLV-bearing fields (48, 55, 62, and
 * anything the packager types as binary) — an inline parse with a hand-off to
 * the TLV tool. Field 35's `D` ⇄ `=` substitution is shown in both forms rather
 * than silently applied.
 */

import { useEffect, useState } from 'react'
import { ExternalLink, ListTree } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog } from '@/components/ui/Dialog'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Textarea } from '@/components/ui/Textarea'
import { tryCall } from '@/engine/client'
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  isBinaryType,
  normalizeHex,
  toHexDump,
  track2Display,
  track2Wire,
  TRACK2_FIELD_ID,
  valueByteLength,
  hexToBytes,
  textToBytes,
} from './model'

/** Fields that habitually carry BER-TLV. */
const TLV_FIELDS = new Set([48, 55, 62])

interface TlvRow {
  path: string
  tag: string
  name: string
  length: number
  value: string
}

function normalizeTlvRows(data: unknown): TlvRow[] {
  const record = asRecord(data)
  const source = asArray(record?.flat ?? record?.nodes)
  const rows: TlvRow[] = []

  for (const entry of source) {
    const item = asRecord(entry)
    if (!item) continue
    const tag = asString(item.tag) ?? asString(item.tagHex)
    if (!tag) continue
    rows.push({
      path: asString(item.path) ?? tag,
      tag,
      name: asString(item.name) ?? asString(item.desc) ?? 'unknown tag',
      length: asNumber(item.length) ?? asNumber(item.len) ?? 0,
      value: asString(item.value) ?? asString(item.valueHex) ?? '',
    })
  }
  return rows
}

export interface ValueSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  fieldId: number
  desc: string
  type: string | undefined
  value: string
  hexMode: boolean
  onValueChange(value: string): void
  onToggleHex(next: boolean): void
  onOpenInTlv(payload: string): void
}

export function ValueSheet({
  open,
  onOpenChange,
  fieldId,
  desc,
  type,
  value,
  hexMode,
  onValueChange,
  onToggleHex,
  onOpenInTlv,
}: ValueSheetProps) {
  const asHex = hexMode || isBinaryType(type)
  const bytes = asHex ? hexToBytes(value) : textToBytes(value)
  const byteCount = valueByteLength(value, asHex)

  const [tlvRows, setTlvRows] = useState<TlvRow[] | null>(null)
  const [tlvError, setTlvError] = useState<string | null>(null)
  const [tlvBusy, setTlvBusy] = useState(false)

  const tlvCandidate = TLV_FIELDS.has(fieldId) || isBinaryType(type)

  // Parse on open and whenever the value changes; a field the operator is
  // editing should show a live tree, not a stale one.
  useEffect(() => {
    if (!open || !tlvCandidate) {
      setTlvRows(null)
      setTlvError(null)
      return
    }
    const payload = asHex ? normalizeHex(value) : value
    if (payload.length === 0) {
      setTlvRows(null)
      setTlvError(null)
      return
    }

    let cancelled = false
    setTlvBusy(true)
    void tryCall('tlv.parse', { payload, inputHex: asHex }).then((result) => {
      if (cancelled) return
      setTlvBusy(false)
      if (result.ok) {
        setTlvRows(normalizeTlvRows(result.data))
        setTlvError(null)
      } else {
        setTlvRows(null)
        setTlvError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, tlvCandidate, value, asHex])

  const isTrack2 = fieldId === TRACK2_FIELD_ID && !asHex

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-mono-lg">F{String(fieldId).padStart(3, '0')}</span>
          <span>{desc}</span>
        </span>
      }
      description={`${byteCount} byte${byteCount === 1 ? '' : 's'} · ${asHex ? 'hex' : 'text'} representation`}
      footer={
        <div className="flex w-full items-center justify-end gap-field">
          <Button size="md" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-group">
        <section className="flex flex-col gap-field">
          <div className="flex items-center gap-field">
            <SegmentedControl
              value={asHex ? 'hex' : 'text'}
              onValueChange={(next) => onToggleHex(next === 'hex')}
              options={[
                { value: 'text', label: 'Txt' },
                { value: 'hex', label: 'Hex' },
              ]}
              disabled={isBinaryType(type)}
              aria-label="Value representation"
            />
            {isBinaryType(type) ? (
              <Badge tone="neutral">Binary fields are always shown in hex.</Badge>
            ) : null}
            <span className="ml-auto flex items-center gap-field">
              <span className="font-mono text-mono-xs text-text-tertiary tabular-nums">
                {byteCount} bytes
              </span>
              <CopyButton value={value} label="Copy value" />
            </span>
          </div>

          <Textarea
            value={value}
            onValueChange={onValueChange}
            mono
            rows={5}
            spellCheck={false}
            autoComplete="off"
            aria-label={`Value of field ${fieldId}`}
          />
        </section>

        {isTrack2 ? (
          <section className="flex flex-col gap-0.5 rounded-sm border border-border-subtle bg-surface-2 p-2">
            <h4 className="text-2xs tracking-wide text-text-tertiary uppercase">
              Track 2 wire and display forms
            </h4>
            <p className="font-mono text-mono-sm text-text">
              Wire form: <span className="text-text-secondary">{track2Wire(value)}</span>
            </p>
            <p className="font-mono text-mono-sm text-text">
              Display form: <span className="text-text-secondary">{track2Display(value)}</span>
            </p>
            <p className="text-2xs text-text-tertiary">
              The wire carries <span className="font-mono text-mono-xs">D</span> as the field
              separator; the display convention writes{' '}
              <span className="font-mono text-mono-xs">=</span>. The substitution is a rendering
              rule and is never applied to the stored value.
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-field">
          <div className="flex items-center gap-field">
            <h4 className="text-2xs tracking-wide text-text-tertiary uppercase">Bytes</h4>
            <span className="ml-auto">
              <CopyButton value={toHexDump(bytes)} label="Copy dump" />
            </span>
          </div>
          <pre className="max-h-40 overflow-auto rounded-sm border border-border-subtle bg-surface-inset p-2 font-mono text-mono-xs text-text-secondary">
            {bytes.length === 0 ? 'No bytes.' : toHexDump(bytes)}
          </pre>
        </section>

        {tlvCandidate ? (
          <section className="flex flex-col gap-field">
            <div className="flex items-center gap-field">
              <h4 className="flex items-center gap-1 text-2xs tracking-wide text-text-tertiary uppercase">
                <ListTree size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                TLV
              </h4>
              <span className="ml-auto">
                <Button
                  size="xs"
                  icon={ExternalLink}
                  onClick={() => onOpenInTlv(asHex ? normalizeHex(value) : value)}
                >
                  Open in TLV tool
                </Button>
              </span>
            </div>

            {tlvBusy ? (
              <p className="text-xs text-text-tertiary">Parsing…</p>
            ) : tlvError ? (
              <InlineAlert tone="warn" title="This value is not valid BER-TLV">
                {tlvError}
              </InlineAlert>
            ) : tlvRows && tlvRows.length > 0 ? (
              <ul className="max-h-40 overflow-auto rounded-sm border border-border-subtle bg-surface-1">
                {tlvRows.map((row, index) => (
                  <li
                    key={`${row.path}-${index}`}
                    className="flex items-baseline gap-2 border-b border-border-subtle px-2 py-0.5 last:border-b-0"
                  >
                    <span className="w-20 shrink-0 font-mono text-mono-sm text-text">{row.tag}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                      {row.name}
                    </span>
                    <span className="w-8 shrink-0 text-right font-mono text-mono-xs text-text-tertiary tabular-nums">
                      {row.length}
                    </span>
                    <span className="w-48 shrink-0 truncate font-mono text-mono-xs text-text-secondary">
                      {row.value}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-text-tertiary">Nothing parsed from this value yet.</p>
            )}
          </section>
        ) : null}
      </div>
    </Dialog>
  )
}
