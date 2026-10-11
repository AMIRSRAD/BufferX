import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { tryCall } from '@/engine/client'
import { reportToolStatus } from '@/shell/toolStatus'
import { FieldBridge } from './FieldBridge'
import { normalizeParse, spaceHex, type TlvNode, type TlvParseResponse } from './model'
import { StructureInspector } from './StructureInspector'

const WIDTHS = [1, 2, 3, 4].map((width) => ({ value: String(width), label: `${width} ${width === 1 ? 'byte' : 'bytes'}` }))
export function LtvPanel({ active }: { active: boolean }) {
  const [lengthBytes, setLengthBytes] = useState('2')
  const [tagBytes, setTagBytes] = useState('1')
  const [endian, setEndian] = useState('big')
  const [scope, setScope] = useState('value')
  const [payload, setPayload] = useState('')
  const [tag, setTag] = useState('01')
  const [value, setValue] = useState('')
  const [fieldId, setFieldId] = useState('48')
  const [encoded, setEncoded] = useState('')
  const [nodes, setNodes] = useState<TlvNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [parsedSignature, setParsedSignature] = useState('')
  const [parsedWidth, setParsedWidth] = useState(2)
  const options = { lengthBytes: Number(lengthBytes), tagBytes: Number(tagBytes), littleEndian: endian === 'little', lengthIncludesHeader: scope === 'record' }
  const signature = JSON.stringify([payload, lengthBytes, tagBytes, endian, scope])
  const stale = parsedSignature !== '' && signature !== parsedSignature
  useEffect(() => { if (active) reportToolStatus('tlv', { result: nodes !== null, stale, error: error !== null, secret: false }) }, [active, nodes, stale, error])
  async function run(build = false) {
    setBusy(true); setError(null)
    let wire = payload
    if (build) {
      const result = await tryCall<{ hex: string }>('ltv.build', { ...options, tagHex: tag, payload: value, valueIsHex: true })
      if (!result.ok) { setError(result.error.message); setBusy(false); return }
      wire = result.data.hex; setPayload(wire)
    }
    const result = await tryCall<TlvParseResponse>('ltv.parse', { ...options, payload: wire, inputHex: true })
    setBusy(false)
    if (!result.ok) { setError(result.error.message); return }
    setNodes(normalizeParse(result.data).map((node) => ({ ...node, name: '' })))
    setEncoded(wire.replace(/\s/g, '').toUpperCase()); setParsedWidth(options.lengthBytes)
    setParsedSignature(JSON.stringify([wire, lengthBytes, tagBytes, endian, scope]))
  }
  return <div className="flex min-w-0 flex-col gap-group p-panel">
    <p className="text-sm text-text-secondary">Length → Tag → Value records. Choose the host’s fixed widths and length convention. Tags are opaque; records are parsed sequentially.</p>
    <div className="grid grid-cols-2 gap-field xl:grid-cols-4">
      <Field label="Length width"><Select value={lengthBytes} onValueChange={setLengthBytes} options={WIDTHS} /></Field>
      <Field label="Tag width"><Select value={tagBytes} onValueChange={setTagBytes} options={WIDTHS} /></Field>
      <Field label="Length byte order"><Select value={endian} onValueChange={setEndian} options={[{ value: 'big', label: 'Big-endian' }, { value: 'little', label: 'Little-endian' }]} /></Field>
      <Field label="Length counts"><Select value={scope} onValueChange={setScope} options={[{ value: 'value', label: 'Value only' }, { value: 'record', label: 'Whole record (L + T + V)' }]} /></Field>
    </div>
    <FieldBridge fieldId={fieldId} onFieldIdChange={setFieldId} onLoad={(text, hex) => setPayload(hex ? text : Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, '0')).join(''))} applyValue={encoded} applyEmptyReason="Parse or build a record first." />
    <Field label="LTV payload (hex)"><Textarea mono rows={4} value={payload} onValueChange={setPayload} placeholder="00 03 01 41 42 43" /></Field>
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="primary" disabled={!payload.trim()} loading={busy} onClick={() => void run()}>Parse LTV</Button><Button size="sm" onClick={() => { setPayload(''); setNodes(null); setEncoded(''); setError(null) }}>Clear</Button><CopyButton value={spaceHex(encoded)} label="Copy encoded LTV" size="sm" />{stale && nodes && <span className="text-xs text-warn">Inputs changed · parse again</span>}</div>
    {error && <InlineAlert tone="error" title="LTV operation failed">{error}</InlineAlert>}
    <details className="rounded-sm border border-border p-panel"><summary className="cursor-pointer text-sm font-medium">Build a record</summary><div className="mt-3 flex flex-col gap-field"><Field label="Tag (hex)"><Input value={tag} onValueChange={setTag} mono /></Field><Field label="Value (hex)"><Textarea value={value} onValueChange={setValue} mono rows={3} /></Field><Button size="sm" loading={busy} onClick={() => void run(true)}>Build LTV</Button></div></details>
    {nodes && <StructureInspector nodes={nodes} sourceHex={encoded} order="ltv" lengthBytes={parsedWidth} />}
  </div>
}
