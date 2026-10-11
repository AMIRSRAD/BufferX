import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { hexToAsciiDebug, spaceHex, type TlvNode } from './model'

interface Row extends TlvNode { depth: number; offset: number; lengthHex: string; tagOffset: number; valueOffset: number }
export function StructureInspector({ nodes, sourceHex = '', order = 'tlv', lengthBytes = 2 }: {
  nodes: TlvNode[]; sourceHex?: string; order?: 'tlv' | 'ltv'; lengthBytes?: number
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelected] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const all = useMemo(() => {
    const rows: Row[] = []
    function walk(list: TlvNode[], depth: number, start: number): number {
      let offset = start
      for (const node of list) {
        const tagBytes = node.tagHex.length / 2
        const lengthOffset = order === 'ltv' ? offset : offset + tagBytes
        const lead = parseInt(sourceHex.slice(lengthOffset * 2, lengthOffset * 2 + 2), 16)
        const width = order === 'ltv' ? lengthBytes : lead < 128 ? 1 : 1 + (lead & 0x7f)
        const valueOffset = offset + tagBytes + width
        // Read original BER lengths: re-encoding children can shorten their headers.
        const lengthHex = sourceHex.slice(lengthOffset * 2, (lengthOffset + width) * 2)
        const length = sourceHex && order === 'tlv'
          ? width === 1 ? lead : parseInt(lengthHex.slice(2), 16)
          : node.length
        rows.push({ ...node, length, depth, offset, lengthHex, tagOffset: order === 'ltv' ? offset + width : offset, valueOffset })
        if (node.children.length) walk(node.children, depth + 1, valueOffset)
        offset = valueOffset + length
      }
      return offset
    }
    walk(nodes, 0, 0)
    return rows
  }, [nodes, sourceHex, order, lengthBytes])
  const rows = useMemo(() => {
    const term = query.toLowerCase().trim()
    return all.filter((node) => {
      if (term) return `${node.tagHex} ${node.name} ${node.valueHex} ${node.ascii}`.toLowerCase().includes(term)
      let ancestor = node.id
      while (ancestor.includes('.')) {
        ancestor = ancestor.slice(0, ancestor.lastIndexOf('.'))
        if (closed.has(ancestor)) return false
      }
      return true
    })
  }, [all, closed, query])
  const active = all.find((node) => node.id === selectedId) ?? rows[0]
  const valueHex = active ? sourceHex ? sourceHex.slice(active.valueOffset * 2, (active.valueOffset + active.length) * 2) : active.valueHex : ''
  const columns: DataTableColumn<Row>[] = [
    { key: 'tagHex', header: 'Tag / structure', width: 'minmax(150px,1fr)', render: (row) => <button type="button" className="flex max-w-full items-center gap-1 font-mono" style={{ paddingLeft: row.depth * 14 }} onClick={() => {
      setSelected(row.id)
      setClosed((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })
    }}>{row.composite ? closed.has(row.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} /> : <span className="w-3" />}<span className="text-accent">{spaceHex(row.tagHex)}</span></button> },
    { key: 'name', header: 'Meaning', width: 'minmax(150px,2fr)', render: (row) => <span className="truncate">{row.name || (row.composite ? 'Constructed container' : 'Primitive value')}</span> },
    { key: 'length', header: 'Bytes', width: 65, mono: true },
    ...(sourceHex ? [{ key: 'offset', header: 'Offset', width: 70, mono: true }] : []),
  ]
  const parts = active ? [
    { label: 'Tag', value: spaceHex(active.tagHex), offset: active.tagOffset, className: 'border-accent bg-accent-muted text-accent' },
    { label: 'Length', value: spaceHex(active.lengthHex) || String(active.length), offset: order === 'ltv' ? active.offset : active.offset + active.tagHex.length / 2, className: 'border-warn text-warn' },
    { label: 'Value', value: spaceHex(valueHex), offset: active.valueOffset, className: 'border-border text-text' },
  ] : []
  if (order === 'ltv') [parts[0], parts[1]] = [parts[1]!, parts[0]!]
  return <div className="flex min-w-0 flex-col gap-group">
    <div className="flex items-center gap-2"><Input value={query} onValueChange={setQuery} aria-label="Search structure" placeholder="Search tag, meaning, hex, or text…" prefix={<Search size={14} />} /><span className="shrink-0 text-xs text-text-secondary">{all.length} nodes</span></div>
    <div className="h-64 overflow-hidden rounded-sm border border-border"><DataTable columns={columns} rows={rows} getRowId={(row) => row.id} onSelect={setSelected} selectedId={active?.id} aria-label="Decoded structure" /></div>
    {active && <section className="flex min-w-0 flex-col gap-field rounded-sm border border-border bg-surface-inset p-panel">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="font-medium text-text">{active.name || `Tag ${spaceHex(active.tagHex)}`}</h3><p className="break-all font-mono text-xs text-text-secondary">{active.path} · {active.composite ? `${active.children.length} children` : 'primitive'} · {active.length} value bytes</p></div><CopyButton value={spaceHex(valueHex)} label="Copy value hex" size="xs" /></div>
      <div className="grid min-w-0 grid-cols-[minmax(80px,1fr)_minmax(80px,1fr)_minmax(100px,3fr)] gap-2">{parts.map((part) => <div key={part.label} className={cn('min-w-0 rounded-sm border-l-2 bg-surface-2 p-2', part.className)}><div className="mb-1 flex justify-between gap-1 text-xs"><span>{part.label}</span>{sourceHex && <span className="text-text-tertiary">@{part.offset}</span>}</div><p className="max-h-32 overflow-auto break-all font-mono text-sm">{part.value || '(empty)'}</p></div>)}</div>
      <div><span className="text-xs text-text-secondary">Text / non-printable bytes</span><p className="max-h-32 overflow-auto break-all font-mono text-sm">{hexToAsciiDebug(valueHex) || '(empty)'}</p></div>
    </section>}
  </div>
}
