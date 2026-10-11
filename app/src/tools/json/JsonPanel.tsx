import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Braces, ChevronDown, ChevronRight, FileUp, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { Input } from '@/components/ui/Input'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { reportToolStatus } from '@/shell/toolStatus'
import { JsonEditor } from './JsonEditor'
import type { JsonNode, JsonResult } from './parser'

interface TreeRow extends JsonNode { depth: number }
const MAX_SIZE = 25 * 1024 * 1024
export default function JsonPanel() {
  const [source, setSource] = useState('')
  const [result, setResult] = useState<JsonResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const search = useDeferredValue(query.trim().toLowerCase())
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]))
  const [reveal, setReveal] = useState<{ from: number; to: number; sequence: number } | null>(null)
  const [selected, setSelected] = useState<JsonNode | null>(null)
  const worker = useRef<Worker | null>(null)
  const serial = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const instance = new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module' })
    worker.current = instance
    instance.onmessage = (event: MessageEvent<{ id: number; result: JsonResult; formatted?: string }>) => {
      if (event.data.id !== serial.current) return
      setBusy(false)
      if (event.data.formatted !== undefined) { setSource(event.data.formatted); return }
      setResult(event.data.result); setExpanded(new Set([0])); setSelected(null)
    }
    instance.onerror = () => { setBusy(false); setError('The JSON worker stopped. Reopen this tool to retry.'); setResult(null) }
    return () => { instance.terminate(); worker.current = null }
  }, [])
  useEffect(() => {
    const id = ++serial.current
    setResult(null); setError(null); setSelected(null)
    if (!source.trim()) { setBusy(false); return }
    if (source.length > MAX_SIZE) { setError('The inspector supports up to 25 MB of JSON. Split this document into smaller files.'); setBusy(false); return }
    setBusy(true)
    const timer = setTimeout(() => worker.current?.postMessage({ id, source }), 350)
    return () => clearTimeout(timer)
  }, [source])
  useEffect(() => { reportToolStatus('json', { result: result?.ok === true, stale: busy, error: result?.ok === false || error !== null, secret: false }) }, [result, busy, error])
  const rows = useMemo(() => {
    const rows: TreeRow[] = []
    if (!result?.ok) return rows
    function walk(node: JsonNode, depth: number) {
      if (rows.length >= 10_000) return
      if (!search || `${node.key} ${node.preview} ${node.path}`.toLowerCase().includes(search)) rows.push({ ...node, depth })
      if (search || expanded.has(node.id)) for (const child of node.children) walk(child, depth + 1)
    }
    walk(result.root, 0)
    return rows
  }, [result, search, expanded])
  function jump(node: Pick<JsonNode, 'from' | 'to'>) { setReveal({ from: node.from, to: node.to, sequence: Date.now() }) }
  const columns: DataTableColumn<TreeRow>[] = [
    { key: 'key', header: 'Property / index', width: 'minmax(160px, 1fr)', render: (row) => <button type="button" className="flex max-w-full items-center gap-1 text-left" style={{ paddingLeft: Math.min(row.depth, 12) * 12 }} onClick={() => {
      setExpanded((current) => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next })
      setSelected(row); jump(row)
    }}>{row.children.length ? expanded.has(row.id) || search ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="w-3 shrink-0" />}<span className="truncate font-mono" title={row.path || '/'}>{row.key}</span></button> },
    { key: 'type', header: 'Type', width: 80, render: (row) => <span className="text-accent">{row.type}</span> },
    { key: 'preview', header: 'Value', render: (row) => <span className="truncate font-mono" title={row.preview}>{row.preview}</span> },
  ]
  async function openFile(file?: File) {
    if (!file) return
    if (file.size > MAX_SIZE) { setError('Choose a JSON file smaller than 25 MB.'); return }
    try { setSource(await file.text()) } catch { setError('Could not read the file.') }
  }
  function format(mode: 'pretty' | 'compact') {
    if (!result?.ok) return
    setBusy(true); worker.current?.postMessage({ id: ++serial.current, source, format: mode })
  }
  const issue = result && !result.ok ? result.error : undefined
  return <div className="flex min-h-0 flex-1 flex-col gap-group p-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void openFile(event.dataTransfer.files[0]) }}>
    <header className="flex flex-wrap items-center gap-2">
      <Braces size={18} className="text-accent" /><h2 className="font-medium">JSON inspector</h2>
      <span role="status" className="mr-auto text-xs text-text-secondary">{busy ? 'Parsing…' : result?.ok ? `${result.count.toLocaleString()} values · valid JSON` : 'Paste JSON or drop a file'}</span>
      <input ref={fileInput} type="file" accept=".json,application/json" className="sr-only" onChange={(event) => { void openFile(event.target.files?.[0]); event.target.value = '' }} />
      <Button size="sm" icon={FileUp} onClick={() => fileInput.current?.click()}>Open file</Button>
      <Button size="sm" disabled={!result?.ok || busy} onClick={() => format('pretty')}>Format</Button>
      <Button size="sm" disabled={!result?.ok || busy} onClick={() => format('compact')}>Minify</Button>
      <CopyButton value={source} label="Copy JSON" size="sm" />
      <Button size="sm" onClick={() => setSource('')}>Clear</Button>
    </header>
    {issue && <InlineAlert tone="error" title={`Line ${issue.line}, column ${issue.column} · offset ${issue.offset}`} action={<Button size="xs" onClick={() => jump({ from: issue.offset, to: issue.offset + 1 })}>Jump to error</Button>}>{issue.message}</InlineAlert>}
    {error && <InlineAlert tone="error" title="JSON inspector">{error}</InlineAlert>}
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-group xl:grid-cols-2">
      <section className="flex min-h-80 min-w-0 flex-col gap-2"><span className="text-xs text-text-secondary">Source · Ctrl+F to search · fold objects in the gutter</span><div className="h-[55vh] min-h-80 flex-1"><JsonEditor value={source} onChange={setSource} issue={issue} reveal={reveal} /></div></section>
      <section className="flex min-h-80 min-w-0 flex-col gap-2">
        <Input value={query} onValueChange={setQuery} aria-label="Search JSON structure" placeholder="Search keys, values, or JSON pointer…" prefix={<Search size={14} />} />
        <div className="h-[55vh] min-h-64 flex-1 overflow-hidden rounded-sm border border-border"><DataTable columns={columns} rows={rows} getRowId={(row) => String(row.id)} selectedId={selected ? String(selected.id) : undefined} onSelect={(id) => { const node = rows.find((row) => String(row.id) === id); if (node) { setSelected(node); jump(node) } }} aria-label="JSON structure" emptyState={<p className="p-panel text-sm text-text-secondary">{issue ? 'Fix the highlighted error to explore the structure.' : 'Objects and arrays appear here. Select a value to locate it in the source.'}</p>} /></div>
        {selected && <div className="flex items-center gap-2 text-xs text-text-secondary"><span className="min-w-0 flex-1 truncate font-mono" title={selected.path || '/'}>{selected.path || '/'} · characters {selected.from}–{selected.to}</span><CopyButton value={selected.path} label="Copy JSON pointer" size="xs" /><CopyButton value={source.slice(selected.from, selected.to)} label="Copy selected value" size="xs" /></div>}
        {rows.length >= 10_000 && <p className="text-xs text-warn">Showing the first 10,000 matches. Refine your search.</p>}
      </section>
    </div>
    <p className="text-xs text-text-tertiary">Processed locally · no input history · numbers keep their exact digits when formatting</p>
  </div>
}
