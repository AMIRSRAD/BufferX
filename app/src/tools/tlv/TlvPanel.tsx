/**
 * The TLV tool (UX_SPEC 3.5).
 *
 * Four operations from the Qt panel — parse, build, TLV→XML, XML→TLV — become
 * three surfaces: `Parse`, `Build`, and one two-pane converter with an explicit
 * direction. The old converter replaced the input box with XML, wrote the
 * sentence "XML is now editable in the input area." into the *tree output box*,
 * and flipped the mode combobox by itself. None of that survives: both panes
 * exist at once, both are editable, both are preserved, and a conversion only
 * happens when a direction button is pressed.
 *
 * The read-only text blobs are gone too. `Tree` is a real tree grid that edits
 * and re-encodes; `Flat` is a sortable, filterable, TSV-copyable table. And
 * `validateTlv` — implemented in the core since the beginning and reachable
 * from no control in the Qt build — is a `Validate` button.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Braces,
  CircleHelp,
  ClipboardPaste,
  Eraser,
  ListTree,
  Play,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { HexInput, normalizeHex } from '@/components/ui/HexInput'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from '@/components/ui/toast'
import { call, tryCall } from '@/engine/client'
import { EngineCallError } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { reportToolStatus } from '@/shell/toolStatus'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useTools } from '@/store/tools'
import { ActionBar, Divider, ProgressStrip, ReadonlyMono, ResultBlock, Section } from './chrome'
import { FieldBridge } from './FieldBridge'
import { TlvFlatTable } from './TlvFlatTable'
import { TlvTreeView } from './TlvTreeView'
import { XmlEditor } from './XmlEditor'
import { LtvPanel } from './LtvPanel'
import { StructureInspector } from './StructureInspector'
import { DICTIONARY_SOURCES } from './tags'
import { useDeferredBusy } from './useDeferredBusy'
import {
  findNode,
  firstNonHex,
  flattenTree,
  hexByteLength,
  isWholeBytes,
  nodesToXml,
  normalizeParse,
  payloadToHex,
  setNodeValue,
  spaceHex,
  tagIsConstructed,
  type TlvNode,
  type TlvParseResponse,
  type TlvValidateResponse,
} from './model'

type Mode = 'parse' | 'build' | 'xml'
type StructureView = 'inspect' | 'tree' | 'flat'
type Busy = null | 'parse' | 'validate' | 'build' | 'toXml' | 'fromXml' | 'reencode'

interface ToolError {
  title: string
  message: string
  /** Raw engine payload for the `Details` disclosure. */
  detail?: string
}

const MODE_OPTIONS = [
  { value: 'parse', label: 'Parse', icon: ListTree },
  { value: 'build', label: 'Build', icon: Play },
  { value: 'xml', label: 'To XML ⇄ From XML', icon: Braces },
]

const INPUT_OPTIONS = [
  { value: 'hex', label: 'Hex in' },
  { value: 'text', label: 'Text in' },
]

const VALUE_MODE_OPTIONS = [
  { value: 'hex', label: 'Hex value' },
  { value: 'text', label: 'Text value' },
]

const VIEW_OPTIONS = [
  { value: 'inspect', label: 'Visual' },
  { value: 'tree', label: 'Tree' },
  { value: 'flat', label: 'Flat' },
]

const XML_PLACEHOLDER = '<Tlv>\n  <Node tag="9F02" value="000000001000" />\n</Tlv>'

export default function TlvPanel() {
  const [format, setFormat] = useState('tlv')
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="px-panel pt-panel"><SegmentedControl aria-label="Record format" value={format} onValueChange={setFormat} options={[{ value: 'tlv', label: 'BER-TLV' }, { value: 'ltv', label: 'LTV' }]} size="sm" /></div>
    <div className={format === 'tlv' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><BerTlvPanel active={format === 'tlv'} /></div>
    <div className={format === 'ltv' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}><LtvPanel active={format === 'ltv'} /></div>
  </div>
}

function BerTlvPanel({ active }: { active: boolean }) {
  const promoted = useTools((state) => state.promoted) === 'tlv'
  const activeBufferName = useBuffers((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === state.activeId)
    return tab?.name
  })
  const addProblem = useProblems((state) => state.add)

  /* ── Shared state ───────────────────────────────────────────────────────── */
  const [mode, setMode] = useState<Mode>('parse')
  const [showHelp, setShowHelp] = useState(false)
  const [fieldId, setFieldId] = useState('48')
  const [inputHex, setInputHex] = useState(true)
  const [payload, setPayload] = useState('')
  const [encoded, setEncoded] = useState('')
  const [origin, setOrigin] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<ToolError | null>(null)

  /* ── Parse state ────────────────────────────────────────────────────────── */
  const [nodes, setNodes] = useState<TlvNode[] | null>(null)
  const [parsedHex, setParsedHex] = useState('')
  const [generation, setGeneration] = useState(0)
  const [treeDirty, setTreeDirty] = useState(false)
  const [view, setView] = useState<StructureView>('inspect')
  const [validation, setValidation] = useState<TlvValidateResponse | null>(null)

  /* ── Build state ────────────────────────────────────────────────────────── */
  const [tagHex, setTagHex] = useState('')
  const [valueIsHex, setValueIsHex] = useState(true)
  const [constructed, setConstructed] = useState(false)
  const [buildValue, setBuildValue] = useState('')

  /* ── Converter state ────────────────────────────────────────────────────── */
  const [xmlText, setXmlText] = useState('')

  const showProgress = useDeferredBusy(busy !== null)
  const payloadRef = useRef<HTMLTextAreaElement | null>(null)

  const flatRows = useMemo(() => (nodes === null ? [] : flattenTree(nodes)), [nodes])

  /* ── Status reporting (rail dots, UX_SPEC 1.2) ──────────────────────────── */
  useEffect(() => {
    if (!active) return
    reportToolStatus('tlv', {
      result: encoded !== '' || nodes !== null,
      stale,
      error: error !== null,
      // The TLV tool never holds a key, a PIN or a PAN of its own.
      secret: false,
    })
  }, [active, encoded, nodes, stale, error])

  /* ── Helpers ────────────────────────────────────────────────────────────── */

  const fail = useCallback(
    (title: string, cause: EngineCallError | string) => {
      const message = typeof cause === 'string' ? cause : cause.message
      const next: ToolError =
        typeof cause === 'string'
          ? { title, message }
          : { title, message, detail: `op ${cause.op} · code ${cause.code}` }
      setError(next)
      addProblem({ severity: 'error', source: 'TLV', message: `${title} ${message}` })
    },
    [addProblem],
  )

  /**
   * Everything about the payload that can be judged without the engine: the
   * box is empty, a character is not hex, or the nibble count is odd.
   */
  const payloadProblem = useCallback((): string | null => {
    if (payload.trim() === '') {
      return 'Nothing to read: the payload box is empty.'
    }
    if (!inputHex) return null

    const offender = firstNonHex(payload)
    if (offender !== null) {
      return `Not valid hex: unexpected '${offender.char}' at position ${offender.position}.`
    }
    if (!isWholeBytes(payload)) {
      const nibbles = normalizeHex(payload).length
      return `Hex payload has an odd nibble count: ${nibbles} nibbles is ${Math.floor(nibbles / 2)} bytes + 1 nibble.`
    }
    return null
  }, [payload, inputHex])

  const markStale = useCallback(() => {
    setStale(true)
    setValidation(null)
  }, [])

  const changePayload = useCallback(
    (value: string) => {
      setPayload(value)
      markStale()
    },
    [markStale],
  )

  const changeInputHex = useCallback(
    (next: boolean) => {
      setInputHex(next)
      markStale()
    },
    [markStale],
  )

  /* ── Actions ────────────────────────────────────────────────────────────── */

  const runParse = useCallback(async () => {
    const problem = payloadProblem()
    if (problem !== null) {
      fail('Parse failed:', problem)
      return
    }

    setBusy('parse')
    const result = await tryCall<TlvParseResponse>('tlv.parse', { payload, inputHex })
    setBusy(null)

    if (!result.ok) {
      fail('Parse failed:', result.error)
      setStale(true)
      return
    }

    setError(null)
    setValidation(null)
    setNodes(normalizeParse(result.data))
    setParsedHex(payloadToHex(payload, inputHex))
    setGeneration((current) => current + 1)
    setTreeDirty(false)
    setEncoded(payloadToHex(payload, inputHex))
    setOrigin('tlv.parse')
    setStale(false)
  }, [payload, inputHex, payloadProblem, fail])

  const runValidate = useCallback(async () => {
    const problem = payloadProblem()
    if (problem !== null) {
      fail('Validation failed:', problem)
      return
    }

    setBusy('validate')
    const result = await tryCall<TlvValidateResponse>('tlv.validate', { payload, inputHex })
    setBusy(null)

    if (!result.ok) {
      fail('Validation failed:', result.error)
      return
    }

    setError(null)
    setValidation(result.data)
    addProblem({
      severity: result.data.valid ? 'info' : 'error',
      source: 'TLV',
      message: result.data.valid
        ? `TLV structure is well-formed: ${result.data.nodeCount} nodes in ${hexByteLength(payloadToHex(payload, inputHex))} bytes.`
        : result.data.message,
    })
  }, [payload, inputHex, payloadProblem, fail, addProblem])

  const buildProblem = useCallback((): string | null => {
    const tag = normalizeHex(tagHex)
    if (tag === '') return 'A TLV tag must be at least one byte. The tag box is empty.'
    if (tag.length % 2 !== 0) {
      return `Tag has an odd nibble count: ${tag.length} nibbles is ${Math.floor(tag.length / 2)} bytes + 1 nibble.`
    }
    if (constructed !== tagIsConstructed(tag)) {
      return tagIsConstructed(tag)
        ? `Tag ${spaceHex(tag)} has the constructed bit (0x20) set, so 'Constructed TLV' must be on.`
        : `Tag ${spaceHex(tag)} does not have the constructed bit (0x20) set, so 'Constructed TLV' must be off.`
    }
    if ((valueIsHex || constructed) && buildValue.trim() !== '') {
      const offender = firstNonHex(buildValue)
      if (offender !== null) {
        return `Not valid hex: unexpected '${offender.char}' at position ${offender.position}.`
      }
      if (!isWholeBytes(buildValue)) {
        const nibbles = normalizeHex(buildValue).length
        return `Value has an odd nibble count: ${nibbles} nibbles is ${Math.floor(nibbles / 2)} bytes + 1 nibble.`
      }
    }
    return null
  }, [tagHex, constructed, valueIsHex, buildValue])

  const runBuild = useCallback(async () => {
    const problem = buildProblem()
    if (problem !== null) {
      fail('Build failed:', problem)
      return
    }

    setBusy('build')
    const result = await tryCall<{ hex: string }>('tlv.build', {
      tagHex: normalizeHex(tagHex),
      payload: buildValue,
      // A constructed node's payload is child TLV hex regardless of the value
      // mode, which is why the mode control disables itself when Constructed is
      // on rather than quietly meaning something else.
      valueIsHex: constructed ? true : valueIsHex,
      constructed,
    })
    setBusy(null)

    if (!result.ok) {
      fail('Build failed:', result.error)
      setStale(true)
      return
    }

    setError(null)
    setEncoded(normalizeHex(result.data.hex))
    setOrigin('tlv.build')
    setStale(false)
  }, [tagHex, buildValue, valueIsHex, constructed, buildProblem, fail])

  const runToXml = useCallback(async () => {
    const problem = payloadProblem()
    if (problem !== null) {
      fail('Conversion to XML failed:', problem)
      return
    }

    setBusy('toXml')
    const result = await tryCall<{ xml: string }>('tlv.toXml', { payload, inputHex })
    setBusy(null)

    if (!result.ok) {
      fail('Conversion to XML failed:', result.error)
      return
    }

    setError(null)
    setXmlText(result.data.xml)
    setEncoded(payloadToHex(payload, inputHex))
    setOrigin('tlv.toXml')
    setStale(false)
  }, [payload, inputHex, payloadProblem, fail])

  const runFromXml = useCallback(async () => {
    if (xmlText.trim() === '') {
      fail('Conversion to TLV failed:', 'Nothing to read: the XML pane is empty.')
      return
    }

    setBusy('fromXml')
    const result = await tryCall<{ hex: string }>('tlv.fromXml', { xml: xmlText })
    setBusy(null)

    if (!result.ok) {
      fail('Conversion to TLV failed:', result.error)
      return
    }

    setError(null)
    const hex = normalizeHex(result.data.hex)
    setPayload(spaceHex(hex))
    setInputHex(true)
    setEncoded(hex)
    setOrigin('tlv.fromXml')
    setStale(false)
  }, [xmlText, fail])

  const runReencode = useCallback(async () => {
    if (nodes === null) return

    setBusy('reencode')
    const encodedResult = await tryCall<{ hex: string }>('tlv.fromXml', { xml: nodesToXml(nodes) })
    if (!encodedResult.ok) {
      setBusy(null)
      fail('Re-encode failed:', encodedResult.error)
      return
    }

    const hex = normalizeHex(encodedResult.data.hex)
    const reparsed = await tryCall<TlvParseResponse>('tlv.parse', { payload: hex, inputHex: true })
    setBusy(null)

    if (!reparsed.ok) {
      fail('Re-encode failed:', reparsed.error)
      return
    }

    setError(null)
    setNodes(normalizeParse(reparsed.data))
    setParsedHex(hex)
    setGeneration((current) => current + 1)
    setTreeDirty(false)
    setEncoded(hex)
    setOrigin('tlv.fromXml (re-encode)')
    setStale(false)
    toast.success(`Re-encoded to ${hexByteLength(hex)} bytes.`)
  }, [nodes, fail])

  const handleEditValue = useCallback((id: string, valueHex: string) => {
    setNodes((current) => {
      if (current === null) return current
      return setNodeValue(current, id, valueHex)
    })
    setTreeDirty(true)
  }, [])

  const copyNodeTlv = useCallback(
    async (node: TlvNode): Promise<string> => {
      // Encoding one node is the same round trip as re-encoding the tree, so the
      // engine stays the only encoder in the app.
      const source = nodes === null ? node : (findNode(nodes, node.id) ?? node)
      const data = await call<{ hex: string }>('tlv.fromXml', { xml: nodesToXml([source]) })
      return spaceHex(normalizeHex(data.hex))
    },
    [nodes],
  )

  const pasteIntoPayload = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text.trim() === '') {
        toast.info('The clipboard is empty.')
        return
      }
      changePayload(text.trim())
      payloadRef.current?.focus()
    } catch {
      toast.error('The clipboard is not readable in this window. Paste into the payload box with Ctrl+V.')
    }
  }, [changePayload])

  const clearCurrentMode = useCallback(() => {
    setError(null)
    setStale(false)
    if (mode === 'build') {
      setTagHex('')
      setBuildValue('')
      setConstructed(false)
      setValueIsHex(true)
      setEncoded('')
      setOrigin(null)
      return
    }
    if (mode === 'xml') {
      setXmlText('')
      setPayload('')
      setEncoded('')
      setOrigin(null)
      return
    }
    setPayload('')
    setNodes(null)
    setValidation(null)
    setTreeDirty(false)
    setEncoded('')
    setOrigin(null)
  }, [mode])

  /* ── Keyboard (UX_SPEC 3.0) ─────────────────────────────────────────────── */

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || event.key !== 'Enter' || busy !== null) return
    event.preventDefault()
    if (mode === 'parse') {
      void (event.shiftKey ? runValidate() : runParse())
    } else if (mode === 'build') {
      if (!event.shiftKey) void runBuild()
    } else {
      void (event.shiftKey ? runFromXml() : runToXml())
    }
  }

  /* ── Derived copy ───────────────────────────────────────────────────────── */

  const encodedBytes = hexByteLength(encoded)
  const inputBytes = hexByteLength(payloadToHex(payload, inputHex))
  const nodeCount = flatRows.length

  const provenance =
    origin === null
      ? undefined
      : `${origin} · ${encodedBytes} ${encodedBytes === 1 ? 'byte' : 'bytes'}${
          nodes !== null && mode === 'parse' ? ` · ${nodeCount} nodes` : ''
        }${activeBufferName ? ` · buffer ${activeBufferName}` : ''}`

  /* ── Render ─────────────────────────────────────────────────────────────── */

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex min-h-0 flex-1 flex-col gap-group p-panel"
    >
      <ProgressStrip active={showProgress} label="Running a TLV operation" />

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="TLV mode"
          value={mode}
          onValueChange={(next) => setMode(next as Mode)}
          options={MODE_OPTIONS}
          size="sm"
          className="min-w-0 flex-1"
        />
        <IconButton
          icon={CircleHelp}
          label={showHelp ? 'Hide help' : 'Show help'}
          size="sm"
          variant="ghost"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((current) => !current)}
        />
      </div>

      {showHelp ? <HelpDisclosure /> : null}

      {mode === 'parse' ? (
        <div
          className={cn(
            'flex min-h-0 flex-col gap-group',
            // Promoted to a workspace tab the tool takes the three-pane layout
            // of UX_SPEC 3.5: source, encoded, structure. In the dock it stacks.
            promoted &&
              '@min-[960px]:grid @min-[960px]:grid-cols-[minmax(16rem,1fr)_minmax(14rem,1fr)_minmax(22rem,2fr)] items-start',
          )}
        >
          <div className="flex min-w-0 flex-col gap-group">
            <Section title="Source">
              <FieldBridge
                fieldId={fieldId}
                onFieldIdChange={setFieldId}
                onLoad={(value, isHex) => {
                  setPayload(value)
                  setInputHex(isHex)
                  markStale()
                }}
                applyValue={encoded}
                applyEmptyReason="Nothing to apply — run Parse first."
              />

              <SegmentedControl
                aria-label="Payload input format"
                value={inputHex ? 'hex' : 'text'}
                onValueChange={(next) => changeInputHex(next === 'hex')}
                options={INPUT_OPTIONS}
                size="xs"
              />

              <Field
                label="Payload"
                hint={
                  inputHex
                    ? 'Hex, spaces optional. Whole bytes only.'
                    : 'Text is read as UTF-8 bytes before parsing.'
                }
              >
                <Textarea
                  ref={payloadRef}
                  value={payload}
                  onValueChange={changePayload}
                  mono
                  rows={4}
                  autoResize
                  spellCheck={false}
                  placeholder={inputHex ? '9F02 06 000000001000' : 'TLV payload as text'}
                />
              </Field>
            </Section>
          </div>

          <div className="flex min-w-0 flex-col gap-group">
            {promoted ? null : <Divider />}

            <ResultBlock
              title="Encoded"
              stale={stale}
              provenance={provenance}
              actions={
                <>
                  <Badge tone="neutral" mono>
                    {encodedBytes} B
                  </Badge>
                  <CopyButton value={spaceHex(encoded)} label="Copy encoded hex" size="xs" variant="ghost" />
                </>
              }
            >
              <ReadonlyMono value={spaceHex(encoded)} emptyText="Nothing encoded yet." />
            </ResultBlock>

            {validation !== null ? (
              <InlineAlert
                tone={validation.valid ? 'ok' : 'error'}
                title={validation.valid ? 'Structure is well-formed' : 'Structure is malformed'}
                onDismiss={() => setValidation(null)}
                action={
                  <CopyButton value={validation.message} label="Copy verdict" size="xs" variant="ghost" />
                }
              >
                <ul className="list-disc pl-4">
                  <li>{validation.message}</li>
                  {validation.valid ? (
                    <li>
                      {validation.nodeCount} {validation.nodeCount === 1 ? 'node' : 'nodes'} in {inputBytes}{' '}
                      {inputBytes === 1 ? 'byte' : 'bytes'}.
                    </li>
                  ) : null}
                </ul>
              </InlineAlert>
            ) : null}
          </div>

          <div
            className={cn(
              'flex min-w-0 flex-col gap-field',
              // The tree and the table are results too: when the payload has
              // moved on they grey out and say so, but stay readable and
              // copyable (UX_SPEC 3.0).
              stale && nodes !== null && 'opacity-55',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                aria-label="Structure view"
                value={view}
                onValueChange={(next) => setView(next as StructureView)}
                options={VIEW_OPTIONS}
                size="xs"
              />
              {nodes !== null ? (
                <span className="text-2xs text-text-tertiary tabular-nums">
                  {inputBytes} {inputBytes === 1 ? 'byte' : 'bytes'} in
                  {stale ? ' · inputs changed' : null}
                </span>
              ) : null}
            </div>

            {nodes === null ? (
              <EmptyState
                icon={ListTree}
                title="Parse a TLV payload, or load one from a field."
                description="Paste hex into the payload box, or pull the current buffer's field into it."
                action={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="default" icon={ClipboardPaste} onClick={() => void pasteIntoPayload()}>
                      Paste
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={Play}
                      onClick={() => void runParse()}
                      disabled={busy !== null}
                    >
                      Parse
                    </Button>
                  </div>
                }
              />
            ) : view === 'inspect' ? (
              <StructureInspector nodes={nodes} sourceHex={treeDirty ? '' : parsedHex} />
            ) : view === 'tree' ? (
              <TlvTreeView
                nodes={nodes}
                generation={generation}
                dirty={treeDirty}
                reencoding={busy === 'reencode'}
                onEditValue={handleEditValue}
                onReencode={() => void runReencode()}
                onCopyNodeTlv={copyNodeTlv}
              />
            ) : (
              <TlvFlatTable rows={flatRows} />
            )}
          </div>
        </div>
      ) : null}

      {mode === 'build' ? (
        <div className="flex min-h-0 flex-col gap-group">
          <Section title="Source">
            <FieldBridge
              fieldId={fieldId}
              onFieldIdChange={setFieldId}
              onLoad={(value, isHex) => {
                setBuildValue(value)
                setValueIsHex(isHex)
                setStale(true)
              }}
              applyValue={encoded}
              applyEmptyReason="Nothing to apply — run Build first."
            />
          </Section>

          <Divider />

          <Section title="Node">
            <Field
              label="Tag hex"
              hint="One or more bytes. The 0x20 bit in the first byte marks a constructed tag."
            >
              <HexInput
                value={tagHex}
                onValueChange={(next) => {
                  setTagHex(next)
                  setStale(true)
                }}
                placeholder="9F02"
                invalid={normalizeHex(tagHex).length % 2 !== 0}
              />
            </Field>

            <SegmentedControl
              aria-label="Value mode"
              value={valueIsHex ? 'hex' : 'text'}
              onValueChange={(next) => {
                setValueIsHex(next === 'hex')
                setStale(true)
              }}
              options={VALUE_MODE_OPTIONS}
              size="xs"
              disabled={constructed}
            />
            {constructed ? (
              <p className="text-2xs text-text-tertiary">
                Value mode is fixed to hex while Constructed is on — a constructed node's payload is child
                TLV hex.
              </p>
            ) : null}

            <Checkbox
              checked={constructed}
              onCheckedChange={(next) => {
                setConstructed(next)
                setStale(true)
              }}
              label="Constructed TLV (input is child TLV hex)"
              description="Must agree with the 0x20 bit in the tag."
            />

            {normalizeHex(tagHex) !== '' && constructed !== tagIsConstructed(tagHex) ? (
              <InlineAlert
                tone="warn"
                title={
                  tagIsConstructed(tagHex)
                    ? `Tag ${spaceHex(normalizeHex(tagHex))} has the constructed bit (0x20) set.`
                    : `Tag ${spaceHex(normalizeHex(tagHex))} does not have the constructed bit (0x20) set.`
                }
                action={
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => setConstructed(tagIsConstructed(tagHex))}
                  >
                    Set constructed to {tagIsConstructed(tagHex) ? 'on' : 'off'}
                  </Button>
                }
              >
                The engine refuses a node whose tag and constructed flag disagree, rather than picking one
                for you.
              </InlineAlert>
            ) : null}

            <Field label="Value">
              <Textarea
                value={buildValue}
                onValueChange={(next) => {
                  setBuildValue(next)
                  setStale(true)
                }}
                mono
                rows={4}
                autoResize
                spellCheck={false}
                placeholder={constructed ? 'Child TLV hex payload' : valueIsHex ? 'Value hex' : 'Value text'}
              />
            </Field>
          </Section>

          <Divider />

          <ResultBlock
            title="Encoded"
            stale={stale}
            provenance={provenance}
            actions={
              <>
                <Badge tone="neutral" mono>
                  {encodedBytes} B
                </Badge>
                <CopyButton value={spaceHex(encoded)} label="Copy encoded hex" size="xs" variant="ghost" />
              </>
            }
          >
            <ReadonlyMono value={spaceHex(encoded)} emptyText="Nothing built yet." />
          </ResultBlock>
        </div>
      ) : null}

      {mode === 'xml' ? (
        <div className="flex min-h-0 flex-col gap-group">
          <Section title="Source">
            <FieldBridge
              fieldId={fieldId}
              onFieldIdChange={setFieldId}
              onLoad={(value, isHex) => {
                setPayload(value)
                setInputHex(isHex)
                markStale()
              }}
              applyValue={encoded}
              applyEmptyReason="Nothing to apply — convert in either direction first."
            />
            <SegmentedControl
              aria-label="Payload input format"
              value={inputHex ? 'hex' : 'text'}
              onValueChange={(next) => changeInputHex(next === 'hex')}
              options={INPUT_OPTIONS}
              size="xs"
            />
          </Section>

          <div
            className={cn(
              'grid min-h-0 gap-group',
              promoted ? 'grid-cols-1 @min-[720px]:grid-cols-2 items-stretch' : 'grid-cols-1',
            )}
          >
            <div className="flex min-h-0 min-w-0 flex-col gap-field">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-2xs tracking-wide text-text-secondary uppercase">TLV hex</h3>
                <div className="flex items-center gap-1">
                  <Badge tone="neutral" mono>
                    {inputBytes} B
                  </Badge>
                  <CopyButton value={payload} label="Copy TLV payload" size="xs" variant="ghost" />
                </div>
              </div>
              <Textarea
                value={payload}
                onValueChange={changePayload}
                mono
                rows={promoted ? 16 : 6}
                spellCheck={false}
                aria-label="TLV payload"
                placeholder={inputHex ? '9F02 06 000000001000' : 'TLV payload as text'}
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-field">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-2xs tracking-wide text-text-secondary uppercase">XML</h3>
                <div className="flex items-center gap-1">
                  <Badge tone="neutral" mono>
                    {xmlText.length} ch
                  </Badge>
                  <CopyButton value={xmlText} label="Copy XML" size="xs" variant="ghost" />
                </div>
              </div>
              <div className={cn('flex min-h-0 flex-col', promoted ? 'h-96' : 'h-48')}>
                <XmlEditor
                  value={xmlText}
                  onValueChange={setXmlText}
                  ariaLabel="TLV as XML"
                  placeholder={XML_PLACEHOLDER}
                />
              </div>
            </div>
          </div>

          <p className="text-2xs text-text-tertiary">
            Both panes are kept. Neither is rewritten until you press a direction in the action bar:{' '}
            <span className="text-text-secondary">Convert to XML</span> fills the XML pane from the hex
            pane, <span className="text-text-secondary">Convert to TLV</span> fills the hex pane from the
            XML pane.
          </p>

          <ResultBlock
            title="Encoded"
            stale={stale}
            provenance={provenance}
            actions={
              <>
                <Badge tone="neutral" mono>
                  {encodedBytes} B
                </Badge>
                <CopyButton value={spaceHex(encoded)} label="Copy encoded hex" size="xs" variant="ghost" />
              </>
            }
          >
            <ReadonlyMono value={spaceHex(encoded)} emptyText="Nothing converted yet." />
          </ResultBlock>
        </div>
      ) : null}

      {error !== null ? (
        <InlineAlert tone="error" title={error.title} onDismiss={() => setError(null)}>
          <p className="break-words">{error.message}</p>
          {error.detail !== undefined ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-2xs text-text-secondary">Details</summary>
              <p className="mt-1 font-mono text-mono-xs text-text-tertiary break-all">{error.detail}</p>
            </details>
          ) : null}
          <div className="mt-1">
            <CopyButton
              value={error.detail === undefined ? error.message : `${error.message} (${error.detail})`}
              label="Copy error"
              size="xs"
              variant="ghost"
              showLabel
            />
          </div>
        </InlineAlert>
      ) : null}

      <ActionBar>
        {mode === 'parse' ? (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Play}
              disabled={busy !== null}
              loading={showProgress && busy === 'parse'}
              onClick={() => void runParse()}
            >
              Parse
            </Button>
            <Button
              size="sm"
              variant="default"
              icon={ShieldCheck}
              disabled={busy !== null}
              loading={showProgress && busy === 'validate'}
              onClick={() => void runValidate()}
            >
              Validate
            </Button>
          </>
        ) : null}

        {mode === 'build' ? (
          <Button
            size="sm"
            variant="primary"
            icon={Play}
            disabled={busy !== null}
            loading={showProgress && busy === 'build'}
            onClick={() => void runBuild()}
          >
            Build
          </Button>
        ) : null}

        {mode === 'xml' ? (
          <>
            <Button
              size="sm"
              variant="primary"
              iconRight={ArrowRight}
              disabled={busy !== null}
              loading={showProgress && busy === 'toXml'}
              onClick={() => void runToXml()}
            >
              Convert to XML
            </Button>
            <Button
              size="sm"
              variant="default"
              icon={ArrowLeft}
              disabled={busy !== null}
              loading={showProgress && busy === 'fromXml'}
              onClick={() => void runFromXml()}
            >
              Convert to TLV
            </Button>
          </>
        ) : null}

        <Button size="sm" variant="ghost" icon={Eraser} className="ml-auto" onClick={clearCurrentMode}>
          Clear
        </Button>
      </ActionBar>
    </div>
  )
}

/* ── Local helpers ────────────────────────────────────────────────────────── */

function HelpDisclosure() {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-2 p-2 text-xs text-text-secondary">
      <p>
        <strong className="text-text">Parse</strong> reads BER-TLV bytes into a tree you can edit and
        re-encode. <strong className="text-text">Build</strong> wraps one tag around a value.{' '}
        <strong className="text-text">To XML ⇄ From XML</strong> converts between the payload and a{' '}
        <code className="font-mono text-mono-xs">&lt;Tlv&gt;</code> document in either direction.
      </p>
      <p>
        Tag names come from, in order:
      </p>
      <ul className="list-disc pl-4">
        {DICTIONARY_SOURCES.map((source) => (
          <li key={source}>{source}</li>
        ))}
      </ul>
      <p>A tag matched by none of them is labelled “unknown tag” rather than guessed.</p>
    </div>
  )
}
