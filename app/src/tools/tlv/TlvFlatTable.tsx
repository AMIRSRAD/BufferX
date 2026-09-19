/**
 * The `Flat` view (UX_SPEC 3.5).
 *
 * > `Flat` — a table with columns `Path`, `Tag`, `Name`, `Len`, `Value (hex)`,
 * > `Value (ascii)`, sortable, filterable, copyable as TSV.
 *
 * Constructed nodes are rows here too, marked `constructed`. The engine's own
 * flattener emits leaves only, which hides where a branch begins and how long
 * it is — information a reader chasing a length mismatch needs.
 */

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { flatRowsToTsv, spaceHex, type TlvFlatRow } from './model'
import { UNKNOWN_TAG_LABEL } from './tags'

type SortKey = 'path' | 'tagHex' | 'name' | 'length' | 'valueHex' | 'ascii'
type SortDirection = 'asc' | 'desc'

export interface TlvFlatTableProps {
  rows: TlvFlatRow[]
  className?: string
}

export function TlvFlatTable({ rows, className }: TlvFlatTableProps) {
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    const filtered =
      needle === ''
        ? rows
        : rows.filter((row) =>
            [row.path, row.tagHex, row.name, String(row.length), row.valueHex, row.ascii]
              .join(' ')
              .toLowerCase()
              .includes(needle),
          )

    if (sort === null) return filtered

    const factor = sort.direction === 'asc' ? 1 : -1
    return filtered.slice().sort((left, right) => {
      if (sort.key === 'length') return (left.length - right.length) * factor
      const a = String(left[sort.key])
      const b = String(right[sort.key])
      return a.localeCompare(b, undefined, { numeric: true }) * factor
    })
  }, [rows, filter, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) => {
      if (current === null || current.key !== key) return { key, direction: 'asc' }
      if (current.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  const header = (key: SortKey, label: string) => (
    <SortHeader
      label={label}
      active={sort?.key === key ? sort.direction : null}
      onClick={() => toggleSort(key)}
    />
  )

  const columns: DataTableColumn<TlvFlatRow>[] = [
    {
      key: 'path',
      header: header('path', 'Path'),
      width: 'minmax(9rem, 1.1fr)',
      mono: true,
      render: (row) => (
        <span className="truncate" title={row.path}>
          {row.path}
        </span>
      ),
    },
    {
      key: 'tagHex',
      header: header('tagHex', 'Tag'),
      width: '6.5rem',
      mono: true,
      render: (row) => <span className="truncate text-hl-1">{spaceHex(row.tagHex)}</span>,
    },
    {
      key: 'name',
      header: header('name', 'Name'),
      width: 'minmax(10rem, 1.6fr)',
      render: (row) => (
        <span
          className={cn('truncate', row.name === '' && 'text-text-tertiary italic')}
          title={row.name === '' ? UNKNOWN_TAG_LABEL : row.name}
        >
          {row.name === '' ? UNKNOWN_TAG_LABEL : row.name}
        </span>
      ),
    },
    {
      key: 'length',
      header: header('length', 'Len'),
      width: '3.5rem',
      align: 'right',
      mono: true,
    },
    {
      key: 'valueHex',
      header: header('valueHex', 'Value (hex)'),
      width: 'minmax(10rem, 1.6fr)',
      mono: true,
      render: (row) =>
        row.composite ? (
          <span className="truncate text-2xs text-text-tertiary">
            constructed · {row.length} bytes of children
          </span>
        ) : (
          <span className="truncate" title={spaceHex(row.valueHex)}>
            {row.valueHex === '' ? '—' : spaceHex(row.valueHex)}
          </span>
        ),
    },
    {
      key: 'ascii',
      header: header('ascii', 'Value (ascii)'),
      width: 'minmax(8rem, 1.2fr)',
      mono: true,
      render: (row) => (
        <span className="truncate" title={row.ascii}>
          {row.ascii === '' ? '—' : row.ascii}
        </span>
      ),
    },
  ]

  return (
    <div className={cn('flex min-h-0 flex-col gap-field', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filter}
          onValueChange={setFilter}
          size="xs"
          placeholder="Filter path, tag, name or value"
          aria-label="Filter TLV nodes"
          prefix={<Search size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
          containerClassName="min-w-40 flex-1"
        />
        <span className="text-2xs text-text-tertiary tabular-nums">
          {visible.length} of {rows.length} rows
        </span>
        <CopyButton
          value={flatRowsToTsv(visible)}
          label="Copy rows as TSV"
          size="xs"
          variant="subtle"
          showLabel
        />
      </div>

      <DataTable<TlvFlatRow>
        aria-label="TLV nodes, flat"
        columns={columns}
        rows={visible}
        getRowId={(row) => row.id}
        selectedId={selectedId}
        onSelect={setSelectedId}
        virtualized={visible.length > 60}
        className="max-h-96"
        emptyState={
          <EmptyState
            title={rows.length === 0 ? 'Nothing parsed yet.' : 'No row matches this filter.'}
            description={
              rows.length === 0
                ? 'Parse a payload to populate the flat view.'
                : `Clear the filter to see all ${rows.length} rows.`
            }
          />
        }
      />
    </div>
  )
}

function SortHeader({
  label,
  active,
  onClick,
}: {
  label: string
  active: SortDirection | null
  onClick: () => void
}) {
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ChevronsUpDown
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}`}
      className="flex min-w-0 items-center gap-1 text-2xs tracking-wide text-text-secondary uppercase hover:text-text"
    >
      <span className="truncate">{label}</span>
      <Icon
        size={10}
        strokeWidth={1.5}
        absoluteStrokeWidth
        aria-hidden="true"
        className={cn('shrink-0', active === null && 'text-text-tertiary')}
      />
    </button>
  )
}
