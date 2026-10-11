import { useMemo, useRef, useState } from 'react'
import { Copy, Download, Package, Plus, Trash2, Upload } from 'lucide-react'
import builtinXml from '../../../../data/packagers.xml?raw'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { toast } from '@/components/ui/toast'
import { useBuffers } from '@/store/buffers'
import { usePackagerSource } from '@/tools/settings/packagerSource'
import { downloadText, canUseNativeFiles, pickSavePathNative, writeTextFileNative } from '@/tools/settings/hostFiles'
import { usePreferences } from '@/tools/settings/preferences'
import { XmlEditor } from '@/tools/tlv/XmlEditor'
import { FIELD_TYPES, mergePackagerXml, newField, newPackager, packagerXml, parsePackagers, validatePackager, type BuilderField, type BuilderPackager } from './model'

export default function PackagerPanel() {
  const registryXml = usePackagerSource((state) => state.xml) ?? builtinXml
  const [draft, setDraft] = useState(newPackager)
  const [selected, setSelected] = useState<string | null>(null)
  const [template, setTemplate] = useState('SLM')
  const [filter, setFilter] = useState('')
  const [showXml, setShowXml] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const templates = useMemo(() => parsePackagers(registryXml), [registryXml])
  const errors = useMemo(() => validatePackager(draft), [draft])
  const xml = `<Packagers>\n${packagerXml(draft)}\n</Packagers>\n`
  const active = draft.fields.find((field) => field.uid === selected)
  const rows = draft.fields.filter((field) => `${field.id} ${field.description} ${field.type}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(a.id) - Number(b.id))
  const columns: DataTableColumn<BuilderField>[] = [
    { key: 'id', header: 'Bit', width: 55, mono: true }, { key: 'description', header: 'Description' },
    { key: 'type', header: 'Wire type', width: 160, mono: true }, { key: 'length', header: 'Max length', width: 95, mono: true },
  ]
  function patch(patch: Partial<BuilderPackager>) { setDraft((current) => ({ ...current, ...patch })); setError(null) }
  function edit(patch: Partial<BuilderField>) { if (active) setDraft((current) => ({ ...current, fields: current.fields.map((field) => field.uid === active.uid ? { ...field, ...patch } : field) })) }
  function createDraft() {
    const next = newPackager()
    const names = new Set(templates.map((pack) => pack.name))
    let suffix = 2
    while (names.has(next.name)) next.name = `CUSTOM_${suffix++}`
    setDraft(next)
    setSelected(next.fields[0]!.uid)
    setFilter('')
    setError(null)
    setShowXml(false)
    nameInput.current?.focus()
    nameInput.current?.select()
    toast.success('New packager draft. Enter a name and add your fields.')
  }
  function clone() { const source = templates.find((pack) => pack.name === template); if (source) { setDraft({ ...source, name: `${source.name}_CUSTOM` }); setSelected(null); setError(null) } }
  async function apply() {
    if (errors.length) return
    const name = draft.name.trim()
    if (templates.some((pack) => pack.name === name) && !window.confirm(`Replace ${name} in the active registry? Other definitions will be kept.`)) return
    setBusy(true); setError(null)
    try {
      const merged = mergePackagerXml(usePackagerSource.getState().xml ?? builtinXml, draft)
      if (!await usePackagerSource.getState().loadXml(merged, { label: 'Packager builder', path: null })) throw new Error(usePackagerSource.getState().error ?? 'The engine rejected this definition.')
      usePreferences.getState().setPackagerPath(null)
      const buffers = useBuffers.getState(); if (buffers.activeId) buffers.update(buffers.activeId, { packager: name, stale: true })
      toast.success(`Loaded ${name}. Export XML to keep it for future sessions.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function save() {
    try {
      const fileName = `${draft.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'packager'}.xml`
      if (canUseNativeFiles()) {
        const path = await pickSavePathNative('Save packager', fileName, [{ name: 'Packager XML', extensions: ['xml'] }])
        if (path) await writeTextFileNative(path, xml)
      } else downloadText(fileName, xml, 'application/xml')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return <div className="flex min-w-0 flex-col gap-group p-panel">
    <header className="flex flex-wrap items-center gap-2"><Package size={18} className="text-accent" /><h2 className="mr-auto font-medium">Packager builder</h2>
      <Button size="sm" disabled={busy} onClick={createDraft}>New</Button>
      <Button size="sm" icon={Upload} onClick={() => input.current?.click()}>Import XML</Button>
      <Button size="sm" icon={Download} disabled={errors.length > 0} onClick={() => void save()}>Export XML</Button>
      <Button size="sm" variant="primary" disabled={errors.length > 0} loading={busy} onClick={() => void apply()}>Use packager</Button>
    </header>
    <input ref={input} type="file" accept=".xml" className="sr-only" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      try { const packs = parsePackagers(await file.text()); setDraft(packs[0]!); setSelected(null); setError(packs.length > 1 ? `Imported the first of ${packs.length} definitions (${packs[0]!.name}).` : null) } catch (cause) { setError(String(cause)) }
    }} />
    <div className="flex flex-wrap items-end gap-2 rounded-sm border border-border p-panel"><div className="min-w-52 flex-1"><Field label="Start from an existing definition"><Combobox value={template} onValueChange={setTemplate} options={templates.map((pack) => ({ value: pack.name, label: pack.name }))} /></Field></div><Button size="sm" icon={Copy} onClick={clone}>Clone</Button></div>
    <div className="grid grid-cols-2 gap-field xl:grid-cols-4">
      <Field label="Name"><Input ref={nameInput} value={draft.name} onValueChange={(name) => patch({ name })} /></Field>
      <Field label="Field count"><Input value={draft.fieldCount} onValueChange={(fieldCount) => patch({ fieldCount })} /></Field>
      <Field label="Bitmap index"><Select value={draft.bitmapIndex} onValueChange={(bitmapIndex) => patch({ bitmapIndex })} options={[{ value: '1', label: '1 · ISO with MTI' }, { value: '0', label: '0 · bitmap only' }, { value: '-1', label: '-1 · sequential fields' }]} /></Field>
      <Field label="Second bitmap boundary"><Input value={draft.secondPartBitmap} onValueChange={(secondPartBitmap) => patch({ secondPartBitmap })} /></Field>
      <Field label="MAC method"><Select value={draft.macMethod} onValueChange={(macMethod) => patch({ macMethod })} options={[{ value: '', label: 'None' }, { value: 'FULL', label: 'FULL' }, { value: 'PARTIAL', label: 'PARTIAL' }]} /></Field>
      <Field label="MAC size (hex characters)"><Input value={draft.macSize} onValueChange={(macSize) => patch({ macSize })} /></Field>
      <Field label="Length format (host label)"><Input value={draft.lenFormat} onValueChange={(lenFormat) => patch({ lenFormat })} /></Field>
      <Field label="Length header width"><Input value={draft.lenLen} onValueChange={(lenLen) => patch({ lenLen })} /></Field>
    </div>
    {error && <InlineAlert tone="error" title="Packager builder">{error}</InlineAlert>}
    {errors.length > 0 && <InlineAlert tone="warn" title={`${errors.length} items to fix before use`}><ul className="list-disc pl-4">{errors.slice(0, 8).map((message, index) => <li key={index}>{message}</li>)}</ul>{errors.length > 8 && <p>And {errors.length - 8} more…</p>}</InlineAlert>}
    <div className="grid grid-cols-1 gap-group xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <section className="flex min-w-0 flex-col gap-2"><div className="flex items-center gap-2"><Input value={filter} onValueChange={setFilter} aria-label="Filter fields" placeholder="Filter fields…" /><Button size="sm" icon={Plus} onClick={() => { const ids = new Set(draft.fields.map((field) => Number(field.id))); let id = 0; while (ids.has(id)) id++; const field = newField(id); patch({ fields: [...draft.fields, field] }); setSelected(field.uid) }}>Add field</Button></div>
        <div className="h-96 overflow-hidden rounded-sm border border-border"><DataTable columns={columns} rows={rows} getRowId={(row) => row.uid} selectedId={selected ?? undefined} onSelect={setSelected} virtualized={false} aria-label="Packager fields" /></div>
        <p className="text-xs text-text-secondary">{draft.fields.length} fields · select a row to edit it · binary lengths are in bytes</p>
      </section>
      <section className="flex flex-col gap-field rounded-sm border border-border bg-surface-inset p-panel">
        {active ? <><div className="flex items-center justify-between"><h3 className="font-medium">Field {active.id}</h3><Button size="xs" icon={Trash2} onClick={() => { patch({ fields: draft.fields.filter((field) => field.uid !== active.uid) }); setSelected(null) }}>Remove</Button></div>
          <Field label="Field id"><Input value={active.id} onValueChange={(id) => edit({ id })} /></Field>
          <Field label="Description"><Input value={active.description} onValueChange={(description) => edit({ description })} /></Field>
          <Field label="Wire type"><Combobox value={active.type} onValueChange={(type) => edit({ type })} options={FIELD_TYPES.map((type) => ({ value: type, label: type }))} mono /></Field>
          <Field label="Maximum length"><Input value={active.length} onValueChange={(length) => edit({ length })} /></Field>
          <Field label="Flags"><Input value={active.flags} onValueChange={(flags) => edit({ flags })} /></Field>
          {active.type.startsWith('IFB') && <p className="text-xs text-warn">IFB packing rules depend on Legacy ATM Engine mode.</p>}
        </> : <p className="text-sm text-text-secondary">Select a field to edit its wire type, length, description, and flags.</p>}
      </section>
    </div>
    <div className="flex items-center gap-2"><Button size="sm" onClick={() => setShowXml(!showXml)}>{showXml ? 'Hide XML' : 'Preview XML'}</Button><CopyButton value={xml} label="Copy packager XML" size="sm" /><span className="text-xs text-text-secondary">Use packager keeps other loaded definitions. Export XML to save your work.</span></div>
    {showXml && <div className="h-80"><XmlEditor value={xml} onValueChange={() => {}} readOnly ariaLabel="Generated packager XML" /></div>}
  </div>
}
