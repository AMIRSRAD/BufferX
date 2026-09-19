/**
 * The field table (UX_SPEC 2.4).
 *
 * One full-width virtualized table — not a two-column grid, not a 180px fixed
 * value column. The toolbar carries filter, present-only, errors-only, the
 * column chooser and the add affordance; the add row is permanent and searches
 * the packager's field definitions by *name*, which the old modal could not do.
 *
 * Two behaviours from the Qt panel are deliberately gone: removing a field no
 * longer triggers an encode (the raw is marked stale instead), and the `Hx`
 * chip is no longer an inert 40%-opacity control that swallows clicks — for
 * binary fields it is an honest disabled state with a stated reason.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownUp,
  ChevronDown,
  Columns3,
  Eraser,
  ExternalLink,
  Filter,
  Lock,
  Maximize2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import { Popover } from '@/components/ui/Popover'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import type { Density } from '@/store/settings'
import {
  isBinaryType,
  offsetLabel,
  typeChip,
  typeWord,
  valueByteLength,
  type DiagnosticFix,
  type FieldDef,
  type FieldDiagnostic,
  type Region,
} from './model'

/* ── Row view model ───────────────────────────────────────────────────────── */

export interface FieldRowView {
  id: number
  value: string
  hexMode: boolean
  desc: string
  type: string | undefined
  declaredLength: number | undefined
  variable: boolean
  /** True when the active packager has no definition for this bit. */
  custom: boolean
  diagnostics: FieldDiagnostic[]
  severity: 'error' | 'warning' | 'info' | null
  colorIndex: number
  region: Region | undefined
}

export type SendTarget = 'tlv' | 'iransystem' | 'crypto' | 'pin' | 'mac'

const SEVERITY_STRIPE: Record<'error' | 'warning' | 'info', string> = {
  error: 'bg-error',
  warning: 'bg-warn',
  info: 'bg-info',
}

const SWATCH = [
  'bg-hl-1',
  'bg-hl-2',
  'bg-hl-3',
  'bg-hl-4',
  'bg-hl-5',
  'bg-hl-6',
  'bg-hl-7',
  'bg-hl-8',
] as const

const CHIP_TONE: Record<'error' | 'warning' | 'info', string> = {
  error: 'text-error',
  warning: 'text-warn',
  info: 'text-info',
}

/* ── Props ────────────────────────────────────────────────────────────────── */

export interface FieldTableProps {
  rows: readonly FieldRowView[]
  fieldDefs: readonly FieldDef[]
  bufferName: string
  packagerName: string

  decoded: boolean
  decoding: boolean

  filter: string
  onFilterChange(value: string): void
  presentOnly: boolean
  onPresentOnlyChange(value: boolean): void
  errorsOnly: boolean
  onErrorsOnlyChange(value: boolean): void

  showOffsetColumn: boolean
  showTypeColumn: boolean
  showLenColumn: boolean
  showFmtColumn: boolean
  onColumnChange(column: 'offset' | 'type' | 'len' | 'fmt', value: boolean): void
  density: Density
  onDensityChange(density: Density): void

  selectedId: number | null
  onSelect(id: number | null): void
  onHover(id: number | null): void

  onValueCommit(id: number, value: string): void
  onToggleHex(id: number, next: boolean): void
  onAddField(id: number): void
  onRemoveField(id: number): void
  onClearValue(id: number): void
  onApplyFix(id: number, fix: DiagnosticFix): void
  onExpand(id: number): void
  onShowBytes(id: number): void
  onSendTo(id: number, target: SendTarget): void

  onDecode(): void
  onReset(): void
  onClearAll(): void
  onSortByBit(): void
  onCopyJson(): void
  onCopyTsv(): void
  onExport(): void
  onImport(): void
  onIdentifyPackager(): void

  /** Focus request from the palette / Problems drawer / resolution card. */
  focusRequest: number | null
}

/* ── Component ────────────────────────────────────────────────────────────── */

export function FieldTable(props: FieldTableProps) {
  const {
    rows,
    fieldDefs,
    bufferName,
    packagerName,
    decoded,
    decoding,
    filter,
    onFilterChange,
    presentOnly,
    onPresentOnlyChange,
    errorsOnly,
    onErrorsOnlyChange,
    showOffsetColumn,
    showTypeColumn,
    showLenColumn,
    showFmtColumn,
    onColumnChange,
    density,
    onDensityChange,
    selectedId,
    onSelect,
    onHover,
    onValueCommit,
    onToggleHex,
    onAddField,
    onRemoveField,
    onClearValue,
    onApplyFix,
    onExpand,
    onShowBytes,
    onSendTo,
    onDecode,
    onReset,
    onClearAll,
    onSortByBit,
    onCopyJson,
    onCopyTsv,
    onExport,
    onImport,
    onIdentifyPackager,
    focusRequest,
  } = props

  const filterRef = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return rows.filter((row) => {
      if (presentOnly && row.value === '') return false
      if (errorsOnly && row.severity !== 'error' && row.severity !== 'warning') return false
      if (needle === '') return true
      return (
        String(row.id).includes(needle) ||
        row.desc.toLowerCase().includes(needle) ||
        (row.type ?? '').toLowerCase().includes(needle) ||
        row.value.toLowerCase().includes(needle)
      )
    })
  }, [rows, filter, presentOnly, errorsOnly])

  /** Wraps a cell so hovering anywhere over a rendered row reports the bit. */
  const hoverable = (row: FieldRowView, children: ReactNode, className?: string) => (
    <span
      onPointerEnter={() => onHover(row.id)}
      onPointerLeave={() => onHover(null)}
      className={cn('flex min-w-0 items-center gap-1', className)}
    >
      {children}
    </span>
  )

  const columns = useMemo<DataTableColumn<FieldRowView>[]>(() => {
    const list: DataTableColumn<FieldRowView>[] = [
      {
        key: 'id',
        header: 'Bit',
        width: 84,
        mono: true,
        render: (row) =>
          hoverable(
            row,
            <>
              {/* 3px severity gutter, pulled into the cell padding so it sits
                  flush against the row edge (UX_SPEC 2.4 column 1). */}
              <span
                aria-hidden="true"
                className={cn(
                  '-ml-cell-x h-4 w-[3px] shrink-0',
                  row.severity ? SEVERITY_STRIPE[row.severity] : 'bg-transparent',
                )}
              />
              <span
                aria-hidden="true"
                className={cn('h-2.5 w-1 shrink-0 rounded-xs', SWATCH[row.colorIndex % 8])}
              />
              <span className="tabular-nums">{row.id}</span>
              {row.severity ? (
                <span className="sr-only">
                  {row.severity === 'error'
                    ? 'has an error'
                    : row.severity === 'warning'
                      ? 'has a warning'
                      : 'has a note'}
                </span>
              ) : null}
            </>,
          ),
      },
      {
        key: 'desc',
        header: 'Name',
        width: 'minmax(150px, 320px)',
        render: (row) =>
          hoverable(
            row,
            <span className="truncate" title={row.desc}>
              {row.desc}
            </span>,
          ),
      },
    ]

    if (showTypeColumn) {
      list.push({
        key: 'type',
        header: 'Type',
        width: 84,
        render: (row) =>
          hoverable(
            row,
            <Tooltip content={typeWord(row.type)}>
              <span>
                <Badge tone="neutral" mono>
                  {typeChip(row.type)}
                </Badge>
              </span>
            </Tooltip>,
          ),
      })
    }

    if (showLenColumn) {
      list.push({
        key: 'length',
        header: 'Len',
        width: 84,
        mono: true,
        render: (row) => {
          const actual = valueByteLength(row.value, row.hexMode || isBinaryType(row.type))
          const declared = row.declaredLength
          const text =
            declared === undefined
              ? `${actual}/—`
              : row.variable
                ? `${actual}/…${declared}`
                : `${actual}/${declared}`
          const tone =
            declared === undefined
              ? 'text-text-secondary'
              : actual > declared
                ? 'text-error'
                : actual === declared || row.variable
                  ? 'text-text-secondary'
                  : 'text-warn'
          return hoverable(
            row,
            <span className={cn('tabular-nums', tone)} title={`${actual} bytes on the wire`}>
              {text}
            </span>,
          )
        },
      })
    }

    if (showOffsetColumn) {
      list.push({
        key: 'offset',
        header: 'Offset',
        width: 112,
        mono: true,
        render: (row) =>
          hoverable(
            row,
            row.region ? (
              <button
                type="button"
                onClick={() => onShowBytes(row.id)}
                className="truncate tabular-nums text-text-secondary hover:text-accent"
              >
                {offsetLabel(row.region.start)} +{row.region.end - row.region.start}
              </button>
            ) : (
              <Tooltip content="These bytes could not be located in the current raw buffer. Decode again after editing the raw pane.">
                <span className="text-text-tertiary">unmapped</span>
              </Tooltip>
            ),
          ),
      })
    }

    list.push({
      key: 'value',
      header: 'Value',
      width: 'minmax(200px, 3fr)',
      mono: true,
      editable: true,
      getEditValue: (row) => row.value,
      render: (row) =>
        hoverable(
          row,
          <>
            <span className="min-w-0 flex-1 truncate" title={row.value}>
              {row.value}
            </span>
            {row.diagnostics.map((diagnostic) => (
              <Tooltip
                key={`${row.id}-${diagnostic.code}`}
                content={
                  <span className="flex flex-col gap-0.5">
                    <span>{diagnostic.message}</span>
                    {diagnostic.fixLabel ? (
                      <span className="text-text-secondary">Activate to {diagnostic.fixLabel.toLowerCase()}.</span>
                    ) : null}
                  </span>
                }
              >
                <button
                  type="button"
                  disabled={diagnostic.fix === null}
                  onClick={(event) => {
                    event.stopPropagation()
                    onApplyFix(row.id, diagnostic.fix)
                  }}
                  aria-label={`${diagnostic.message}${diagnostic.fixLabel ? ` Activate to ${diagnostic.fixLabel.toLowerCase()}.` : ''}`}
                  className={cn(
                    'shrink-0 rounded-xs px-0.5 font-mono text-mono-xs',
                    CHIP_TONE[diagnostic.severity],
                    diagnostic.fix === null ? 'cursor-default' : 'hover:bg-surface-raised',
                  )}
                >
                  {diagnostic.glyph}
                </button>
              </Tooltip>
            ))}
            <Tooltip content="Expand the value editor (Alt+Enter)">
              <span className="shrink-0">
                <IconButton
                  icon={Maximize2}
                  label={`Expand field ${row.id}`}
                  size="xs"
                  variant="ghost"
                  tooltip={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    onExpand(row.id)
                  }}
                />
              </span>
            </Tooltip>
          </>,
          'w-full',
        ),
    })

    if (showFmtColumn) {
      list.push({
        key: 'fmt',
        header: 'Fmt',
        width: 96,
        render: (row) => {
          const binary = isBinaryType(row.type)
          return hoverable(
            row,
            binary ? (
              <Tooltip content="Binary fields are always shown in hex.">
                <span className="flex items-center gap-1">
                  <Badge tone="neutral" mono>
                    Hex
                  </Badge>
                  <Lock
                    size={11}
                    strokeWidth={1.5}
                    absoluteStrokeWidth
                    aria-hidden="true"
                    className="text-text-tertiary"
                  />
                  <span className="sr-only">locked to hex</span>
                </span>
              </Tooltip>
            ) : (
              <SegmentedControl
                value={row.hexMode ? 'hex' : 'txt'}
                onValueChange={(next) => onToggleHex(row.id, next === 'hex')}
                options={[
                  { value: 'txt', label: 'Txt' },
                  { value: 'hex', label: 'Hex' },
                ]}
                size="xs"
                aria-label={`Representation of field ${row.id}`}
              />
            ),
          )
        },
      })
    }

    list.push({
      key: 'actions',
      header: '',
      width: 76,
      align: 'right',
      render: (row) =>
        hoverable(
          row,
          <>
            <CopyButton value={row.value} label={`Copy field ${row.id}`} />
            <RowMenu
              row={row}
              onToggleHex={() => onToggleHex(row.id, !row.hexMode)}
              onExpand={() => onExpand(row.id)}
              onClearValue={() => onClearValue(row.id)}
              onRemove={() => onRemoveField(row.id)}
              onShowBytes={() => onShowBytes(row.id)}
              onSendTo={(target) => onSendTo(row.id, target)}
            />
          </>,
          'justify-end',
        ),
    })

    return list
    // `hoverable` is stable enough for this memo: it closes over `onHover`
    // only, which the parent keeps referentially stable.

  }, [
    showTypeColumn,
    showLenColumn,
    showOffsetColumn,
    showFmtColumn,
    onHover,
    onToggleHex,
    onApplyFix,
    onExpand,
    onShowBytes,
    onRemoveField,
    onClearValue,
    onSendTo,
  ])

  const emptyState = !decoded ? (
    <EmptyState
      title="Not decoded yet."
      description="Decode the raw buffer to populate the field table, or add fields by hand."
      action={
        <Button size="md" variant="primary" loading={decoding} onClick={onDecode}>
          Decode
        </Button>
      }
      hint="Ctrl+Enter to decode"
    />
  ) : rows.length === 0 ? (
    <EmptyState
      title={`Decoded 0 fields from ${bufferName}.`}
      description={`The packager may be wrong for this buffer. ${packagerName} produced no fields.`}
      action={
        <Button size="md" variant="primary" onClick={onIdentifyPackager}>
          Identify packager
        </Button>
      }
      hint="Ctrl+Shift+D"
    />
  ) : (
    <EmptyState
      title={`No fields match “${filter}”.`}
      description={
        presentOnly || errorsOnly
          ? 'The present-only or errors-only filter may also be hiding rows.'
          : undefined
      }
      action={
        <Button
          size="md"
          onClick={() => {
            onFilterChange('')
            onPresentOnlyChange(false)
            onErrorsOnlyChange(false)
          }}
        >
          Clear filter
        </Button>
      }
    />
  )

  return (
    <section
      aria-label={`Fields of ${bufferName}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden p-panel"
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-field">
        <h2 className="text-2xs tracking-wide text-text-tertiary uppercase">Fields</h2>

        <span className="w-56">
          <Input
            ref={filterRef}
            value={filter}
            onValueChange={onFilterChange}
            placeholder="filter…"
            aria-label="Filter fields by bit, name, type or value"
            prefix={<Filter size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onFilterChange('')
              }
            }}
          />
        </span>

        <Checkbox checked={presentOnly} onCheckedChange={onPresentOnlyChange} label="Present only" />
        <Checkbox checked={errorsOnly} onCheckedChange={onErrorsOnlyChange} label="Errors only" />

        <span className="font-mono text-mono-xs text-text-tertiary tabular-nums">
          {visible.length === rows.length
            ? `${rows.length} field${rows.length === 1 ? '' : 's'}`
            : `${visible.length} of ${rows.length} fields`}
        </span>

        <span className="ml-auto flex items-center gap-field">
          <Popover
            align="end"
            trigger={
              <span>
                <Button size="xs" icon={Columns3} iconRight={ChevronDown}>
                  Columns
                </Button>
              </span>
            }
          >
            <div className="flex w-56 flex-col gap-field">
              <span className="text-2xs tracking-wide text-text-tertiary uppercase">Columns</span>
              <Checkbox
                checked={showTypeColumn}
                onCheckedChange={(value) => onColumnChange('type', value)}
                label="Type"
              />
              <Checkbox
                checked={showLenColumn}
                onCheckedChange={(value) => onColumnChange('len', value)}
                label="Len"
              />
              <Checkbox
                checked={showOffsetColumn}
                onCheckedChange={(value) => onColumnChange('offset', value)}
                label="Offset"
                description="Byte offset and length. For wire analysis."
              />
              <Checkbox
                checked={showFmtColumn}
                onCheckedChange={(value) => onColumnChange('fmt', value)}
                label="Fmt"
              />
              <span className="mt-1 text-2xs tracking-wide text-text-tertiary uppercase">
                Row density
              </span>
              <SegmentedControl
                value={density}
                onValueChange={(value) =>
                  onDensityChange(value === 'comfortable' ? 'comfortable' : 'dense')
                }
                options={[
                  { value: 'dense', label: 'Compact' },
                  { value: 'comfortable', label: 'Comfortable' },
                ]}
                aria-label="Row density"
              />
            </div>
          </Popover>

          <Popover
            align="end"
            padded={false}
            trigger={
              <span>
                <IconButton icon={MoreHorizontal} label="Field table actions" size="xs" />
              </span>
            }
          >
            <ul className="flex w-64 flex-col py-1">
              <MenuItem icon={RotateCcw} label="Reset to packager defaults" onClick={onReset} />
              <MenuItem icon={Eraser} label="Clear all fields" onClick={onClearAll} danger />
              <MenuItem icon={ArrowDownUp} label="Sort by bit (default)" onClick={onSortByBit} />
              <li aria-hidden="true" className="my-1 h-px bg-border-subtle" />
              <MenuItem label="Copy all as JSON" onClick={onCopyJson} />
              <MenuItem label="Copy all as TSV" onClick={onCopyTsv} />
              <MenuItem label="Export fields…" onClick={onExport} />
              <MenuItem label="Import fields from JSON…" onClick={onImport} />
            </ul>
          </Popover>
        </span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        rows={visible}
        getRowId={(row) => String(row.id)}
        selectedId={selectedId === null ? undefined : String(selectedId)}
        onSelect={(rowId) => onSelect(Number.parseInt(rowId, 10))}
        onCellCommit={(rowId, columnKey, value) => {
          if (columnKey !== 'value') return
          onValueCommit(Number.parseInt(rowId, 10), value)
        }}
        emptyState={emptyState}
        aria-label={`ISO 8583 fields for ${bufferName}, packager ${packagerName}`}
        className="min-h-0 flex-1"
      />

      <AddFieldRow
        fieldDefs={fieldDefs}
        existing={rows.map((row) => row.id)}
        focusRequest={focusRequest}
        onAdd={onAddField}
        onJumpTo={(id) => onSelect(id)}
      />
    </section>
  )
}

/* ── Menu item ────────────────────────────────────────────────────────────── */

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon?: LucideIcon
  label: string
  onClick(): void
  danger?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 px-2 py-1 text-left text-sm',
          danger
            ? 'text-error hover:bg-error-bg'
            : 'text-text-secondary hover:bg-surface-raised hover:text-text',
        )}
      >
        {Icon ? (
          <Icon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        ) : (
          <span aria-hidden="true" className="w-3.5" />
        )}
        {label}
      </button>
    </li>
  )
}

/* ── Row menu ─────────────────────────────────────────────────────────────── */

function RowMenu({
  row,
  onToggleHex,
  onExpand,
  onClearValue,
  onRemove,
  onShowBytes,
  onSendTo,
}: {
  row: FieldRowView
  onToggleHex(): void
  onExpand(): void
  onClearValue(): void
  onRemove(): void
  onShowBytes(): void
  onSendTo(target: SendTarget): void
}) {
  const [open, setOpen] = useState(false)
  const close = (fn: () => void) => () => {
    fn()
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      padded={false}
      trigger={
        <span>
          <IconButton
            icon={MoreHorizontal}
            label={`Actions for field ${row.id}`}
            size="xs"
            variant="ghost"
          />
        </span>
      }
    >
      <ul className="flex w-56 flex-col py-1">
        <MenuItem
          label={row.hexMode ? 'Show as text' : 'Show as hex'}
          onClick={close(onToggleHex)}
        />
        <MenuItem icon={Maximize2} label="Expand editor (Alt+Enter)" onClick={close(onExpand)} />
        <MenuItem label="Clear value" onClick={close(onClearValue)} />
        <MenuItem icon={Trash2} label="Remove field (Delete)" onClick={close(onRemove)} danger />
        <li aria-hidden="true" className="my-1 h-px bg-border-subtle" />
        <MenuItem icon={ExternalLink} label="Send to TLV" onClick={close(() => onSendTo('tlv'))} />
        <MenuItem
          icon={ExternalLink}
          label="Send to IranSystem"
          onClick={close(() => onSendTo('iransystem'))}
        />
        <MenuItem
          icon={ExternalLink}
          label="Send to Crypto"
          onClick={close(() => onSendTo('crypto'))}
        />
        <MenuItem label="Use as MAC field" onClick={close(() => onSendTo('mac'))} />
        <MenuItem label="Use as PIN block" onClick={close(() => onSendTo('pin'))} />
        <li aria-hidden="true" className="my-1 h-px bg-border-subtle" />
        <MenuItem label="Show bytes in raw" onClick={close(onShowBytes)} />
      </ul>
    </Popover>
  )
}

/* ── Add row ──────────────────────────────────────────────────────────────── */

/**
 * The permanent add row. Typing filters the packager's field definitions live,
 * so an operator can search by name (`track` → `35 · Track 2 Data`) — the old
 * modal offered nothing but a raw number even though `fieldDefs` was loaded.
 * Validation is pre-commit: the button simply stays disabled, with helper text.
 */
function AddFieldRow({
  fieldDefs,
  existing,
  focusRequest,
  onAdd,
  onJumpTo,
}: {
  fieldDefs: readonly FieldDef[]
  existing: readonly number[]
  focusRequest: number | null
  onAdd(id: number): void
  onJumpTo(id: number): void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The shell's `Add field` command focuses this input.
  useEffect(() => {
    if (focusRequest === null) return
    inputRef.current?.focus()
  }, [focusRequest])

  const trimmed = query.trim()
  const numeric = /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null

  const suggestions = useMemo(() => {
    if (trimmed === '') return []
    const needle = trimmed.toLowerCase()
    return fieldDefs
      .filter(
        (def) =>
          String(def.id).startsWith(trimmed) || (def.name ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 8)
  }, [fieldDefs, trimmed])

  const duplicate = numeric !== null && existing.includes(numeric)
  const canAdd =
    numeric !== null && !duplicate && numeric >= 0 && numeric <= 128

  const helper = duplicate
    ? `F${numeric} is already present.`
    : trimmed !== '' && numeric === null && suggestions.length === 0
      ? 'Field id must be numeric.'
      : null

  const commit = (id: number) => {
    onAdd(id)
    setQuery('')
  }

  return (
    <div className="shrink-0 rounded-sm border border-border-subtle bg-surface-2 px-2 py-1">
      <div className="flex flex-wrap items-center gap-field">
        <span className="flex items-center gap-1 text-xs text-text-secondary">
          <Plus size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          Add field
        </span>
        <span className="w-72">
          <Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            mono
            placeholder="bit number or name…"
            aria-label="Add a field by bit number or name"
            aria-describedby="bufferx-add-field-help"
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const first = suggestions[0]
              if (canAdd && numeric !== null) commit(numeric)
              else if (first && !existing.includes(first.id)) commit(first.id)
            }}
          />
        </span>
        <Button
          size="xs"
          variant="primary"
          disabled={!canAdd}
          onClick={() => {
            if (numeric !== null) commit(numeric)
          }}
        >
          Add
        </Button>
        {duplicate && numeric !== null ? (
          <Button size="xs" variant="ghost" onClick={() => onJumpTo(numeric)}>
            Jump to it
          </Button>
        ) : null}
        {helper ? (
          <span id="bufferx-add-field-help" className="text-xs text-warn">
            {helper}
          </span>
        ) : (
          <span id="bufferx-add-field-help" className="sr-only">
            Type a bit number, or part of a field name, then press Enter.
          </span>
        )}
      </div>

      {suggestions.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1">
          {suggestions.map((def) => {
            const present = existing.includes(def.id)
            return (
              <li key={def.id}>
                <button
                  type="button"
                  disabled={present}
                  onClick={() => commit(def.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-sm border border-border-subtle px-1.5 py-0.5 text-xs',
                    present
                      ? 'cursor-not-allowed text-text-disabled'
                      : 'text-text-secondary hover:bg-surface-raised hover:text-text',
                  )}
                >
                  <span className="font-mono text-mono-xs text-text">{def.id}</span>
                  <span className="truncate">{def.name ?? `Field ${def.id}`}</span>
                  <span className="text-text-tertiary">{typeWord(def.type)}</span>
                  {present ? <span className="text-text-tertiary">· present</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
