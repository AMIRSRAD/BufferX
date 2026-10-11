import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Download,
  Eraser,
  Lock,
  LockOpen,
  Radio,
  Save,
  Send,
  SquareArrowOutUpRight,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { Kbd } from '@/components/ui/Kbd'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from '@/components/ui/toast'
import { hostCapabilities, tryCall } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { useBuffers, type FieldRow } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { HistoryList } from './HistoryList'
import { ResultRow } from './ResultRow'
import { SavedEndpoints } from './SavedEndpoints'
import { Section } from './Section'
import { tcpSend, transportMessage } from './tcp'
import { useNetwork, type HistoryEntry } from './networkStore'
import {
  asFraming,
  byteLength,
  classifyTransportError,
  digitsOnly,
  formatBytes,
  formatClock,
  formatElapsed,
  frameRequest,
  framingLabel,
  groupWireHex,
  hasNonHex,
  headerLimit,
  hexToText,
  normalizeHex,
  parseCount,
  splitWire,
  textToHex,
  validateHeaderSize,
  validateHost,
  validatePort,
  validateTimeout,
  type Framing,
} from './wire'

// ---------------------------------------------------------------------------
// Engine shapes
// ---------------------------------------------------------------------------

interface EngineField {
  id: number
  value: string
  hex?: string
  desc?: string
  type?: string
  length?: number
  variable?: boolean
}

interface IsoDecodeResult {
  fields: EngineField[]
  headerDetected: boolean
  headerFormat: string
  headerSize: number
  messageLength: number
  byteLength: number
}

// ---------------------------------------------------------------------------
// Local pieces
// ---------------------------------------------------------------------------

/**
 * Label + non-focusable-container control, for widgets a `<label for>` cannot
 * address (a segmented control is a toolbar of buttons, not one input).
 */
function LabeledGroup({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span id={id} className="text-xs text-text-secondary">
        {label}
      </span>
      {children}
      {hint ? <p className="text-2xs text-text-tertiary">{hint}</p> : null}
    </div>
  )
}

/** A scrollable read-only monospace block: wire hex, response body, previews. */
function Readout({
  value,
  empty = 'Nothing yet.',
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  empty?: string
  className?: string
  'aria-label': string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        'max-h-64 min-h-16 overflow-auto rounded-sm border border-border-subtle bg-surface-inset',
        'px-cell-x py-cell-y font-mono text-mono-xs break-all whitespace-pre-wrap',
        value === '' ? 'text-text-disabled' : 'text-text',
        className,
      )}
    >
      {value === '' ? empty : value}
    </div>
  )
}

interface SendConfig {
  host: string
  port: number
  timeoutMs: number
  framing: Framing
  headerSize: number
  /** The body, hex, header excluded. */
  bodyHex: string
  /** Echoed into the history row so `Load` restores the same representation. */
  request: string
  inputHex: boolean
  outputHex: boolean
}

interface PanelAlert {
  tone: 'error' | 'warn'
  title: string
  message: string
}

const DESKTOP_URL = 'https://amirsrad.ir'

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Network — the ISO TCP tester (UX_SPEC 3.8).
 *
 * Desktop-only in the sense that only the desktop host can open the socket;
 * everything else — composing a request, framing it, inspecting the wire bytes,
 * pasting a captured response and decoding it into a buffer — works in the
 * browser too, which is what "gated, never hidden" (5.7) is for.
 *
 * Secrets discipline: the request body is live message content (PAN, track,
 * PIN block). It is never persisted, never logged, and never written into a
 * saved endpoint profile — only host, port, timeout and framing are (5.5).
 */
export default function NetworkPanel() {
  const capabilities = hostCapabilities()
  const tcpEnabled = capabilities.tcp
  const gateReason = capabilityHint('tcp')

  const net = useNetwork()
  const buffers = useBuffers()
  const activeBuffer = buffers.active()
  const legacyEngine = useSettings((state) => state.legacyEngine)
  const addProblem = useProblems((state) => state.add)

  const [sending, setSending] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [alert, setAlert] = useState<PanelAlert | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [sizeNote, setSizeNote] = useState<string | null>(null)
  const [responseView, setResponseView] = useState<'body' | 'wire'>('body')
  const [decodeTarget, setDecodeTarget] = useState<'new' | 'active'>('new')
  const [decoding, setDecoding] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [endpointName, setEndpointName] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const [pasteHasHeader, setPasteHasHeader] = useState(true)
  const [pasteError, setPasteError] = useState<string | null>(null)

  const tokenRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const noteTimerRef = useRef<number | null>(null)

  function stopTimer() {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current)
    },
    [],
  )

  // -- derived: validation ---------------------------------------------------

  const hostTouched = net.host.trim() !== '' || attempted
  const hostError = hostTouched ? validateHost(net.host) : undefined
  const portError = validatePort(net.port)
  const timeoutError = validateTimeout(net.timeoutMs)
  const headerSizeError = validateHeaderSize(net.headerSize, net.framing)
  const headerSizeNum = parseCount(net.headerSize) ?? 0

  const requestBodyHex = net.inputHex ? normalizeHex(net.request) : textToHex(net.request)
  const requestBytes = requestBodyHex.length / 2
  const frame = frameRequest(net.framing, headerSizeNum, requestBodyHex)

  let requestError: string | undefined
  if (net.inputHex && hasNonHex(net.request)) {
    requestError = 'Remove the characters that are not hex digits.'
  } else if (net.inputHex && normalizeHex(net.request).length % 2 !== 0) {
    requestError = `Hex needs an even number of digits (${normalizeHex(net.request).length} now).`
  } else if (net.request === '' && attempted) {
    requestError = 'The request body is empty.'
  } else if (!frame.ok && net.request !== '' && headerSizeError === undefined) {
    requestError = frame.message
  }

  const blocked =
    hostError !== undefined ||
    portError !== undefined ||
    timeoutError !== undefined ||
    headerSizeError !== undefined ||
    requestBodyHex === '' ||
    !frame.ok
  const canSend = tcpEnabled && !sending && !blocked

  const wireHex = frame.ok ? frame.wireHex : ''
  const wireHeaderHex = frame.ok ? frame.headerHex : ''

  // -- derived: response -----------------------------------------------------

  const result = net.result
  const responseSplit = result ? splitWire(result.framing, result.headerSize, result.responseHex) : null
  const responseBodyHex = responseSplit?.bodyHex ?? ''
  const responseBodyText = responseBodyHex === '' ? '' : hexToText(responseBodyHex)
  const responseBodyCopy = net.outputHex ? responseBodyHex : responseBodyText
  const responseBodyDisplay = net.outputHex ? groupWireHex(responseBodyHex) : responseBodyText
  const responseWireDisplay = result ? groupWireHex(result.responseHex) : ''

  // -- helpers ---------------------------------------------------------------

  function showSizeNote(note: string | null) {
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current)
    setSizeNote(note)
    if (note !== null) {
      noteTimerRef.current = window.setTimeout(() => setSizeNote(null), 2000)
    }
  }

  function changeFraming(value: string) {
    showSizeNote(net.setFraming(asFraming(value, net.framing)))
  }

  // -- send ------------------------------------------------------------------

  async function runSend(config: SendConfig) {
    const token = tokenRef.current + 1
    tokenRef.current = token

    const store = useNetwork.getState()
    setSending(true)
    setAlert(null)
    setDecodeError(null)
    setElapsed(0)
    setResponseView('body')

    const startedAt = Date.now()
    stopTimer()
    timerRef.current = window.setInterval(() => setElapsed(Date.now() - startedAt), 100)

    const base = {
      at: startedAt,
      host: config.host,
      port: String(config.port),
      framing: config.framing,
      headerSize: String(config.headerSize),
      request: config.request,
      inputHex: config.inputHex,
      outputHex: config.outputHex,
      timeoutMs: String(config.timeoutMs),
    }

    try {
      const exchange = await tcpSend({
        host: config.host,
        port: config.port,
        payloadHex: config.bodyHex,
        framing: config.framing,
        headerSize: config.framing === 'none' ? null : config.headerSize,
        timeoutMs: config.timeoutMs,
      })
      if (token !== tokenRef.current) return

      store.setResult({
        requestHex: exchange.requestHex,
        responseHex: exchange.responseHex,
        elapsedMs: exchange.elapsedMs,
        bytesSent: exchange.bytesSent,
        bytesReceived: exchange.bytesReceived,
        framing: config.framing,
        headerSize: config.headerSize,
        source: 'tcp',
        at: Date.now(),
      })
      store.addHistory({
        ...base,
        bytesSent: exchange.bytesSent,
        bytesReceived: exchange.bytesReceived,
        elapsedMs: exchange.elapsedMs,
        status: 'ok',
      })
      toast.success(
        `${formatBytes(exchange.bytesReceived)} back from ${config.host}:${config.port} in ${exchange.elapsedMs} ms.`,
      )
    } catch (error) {
      if (token !== tokenRef.current) return
      const message = transportMessage(error)
      const title = classifyTransportError(message, config.timeoutMs)
      setAlert({ tone: 'error', title, message })
      store.addHistory({
        ...base,
        bytesSent: 0,
        bytesReceived: 0,
        elapsedMs: Date.now() - startedAt,
        status: 'error',
        message: `${title}: ${message}`,
      })
      addProblem({
        severity: 'error',
        source: 'Network',
        message: `${config.host}:${config.port} — ${title}: ${message}`,
      })
    } finally {
      if (token === tokenRef.current) {
        stopTimer()
        setSending(false)
      }
    }
  }

  function handleSend() {
    setAttempted(true)
    if (!tcpEnabled || sending) return
    const port = parseCount(net.port)
    const timeoutMs = parseCount(net.timeoutMs)
    if (
      hostError !== undefined ||
      port === null ||
      timeoutMs === null ||
      portError !== undefined ||
      timeoutError !== undefined ||
      headerSizeError !== undefined ||
      requestBodyHex === '' ||
      !frame.ok
    ) {
      return
    }
    void runSend({
      host: net.host.trim(),
      port,
      timeoutMs,
      framing: net.framing,
      headerSize: headerSizeNum,
      bodyHex: requestBodyHex,
      request: net.request,
      inputHex: net.inputHex,
      outputHex: net.outputHex,
    })
  }

  function handleCancel() {
    if (!sending) return
    const waited = elapsed
    tokenRef.current += 1
    stopTimer()
    setSending(false)
    setAlert({
      tone: 'warn',
      title: 'Request cancelled',
      message: `Stopped waiting after ${waited} ms. The socket is released when the host's ${net.timeoutMs} ms budget expires, so a late reply from this attempt is discarded rather than shown.`,
    })
    useNetwork.getState().addHistory({
      at: Date.now() - waited,
      host: net.host.trim(),
      port: net.port,
      framing: net.framing,
      headerSize: net.headerSize,
      request: net.request,
      inputHex: net.inputHex,
      outputHex: net.outputHex,
      timeoutMs: net.timeoutMs,
      bytesSent: byteLength(wireHex),
      bytesReceived: 0,
      elapsedMs: waited,
      status: 'cancelled',
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return
    event.preventDefault()
    if (event.shiftKey) handleCancel()
    else handleSend()
  }

  // -- history ---------------------------------------------------------------

  function loadHistory(entry: HistoryEntry) {
    const store = useNetwork.getState()
    store.setHost(entry.host)
    store.setPort(entry.port)
    store.setTimeoutMs(entry.timeoutMs)
    store.setFraming(entry.framing)
    store.setHeaderSize(entry.headerSize)
    store.setInputHex(entry.inputHex)
    store.setOutputHex(entry.outputHex)
    store.setRequest(entry.request)
    setAttempted(false)
    setAlert(null)
    toast.info(`Loaded the ${formatClock(entry.at)} request.`)
  }

  function resendHistory(entry: HistoryEntry) {
    loadHistory(entry)
    const port = parseCount(entry.port)
    const timeoutMs = parseCount(entry.timeoutMs)
    const headerSize = parseCount(entry.headerSize) ?? 0
    const bodyHex = entry.inputHex ? normalizeHex(entry.request) : textToHex(entry.request)
    if (port === null || timeoutMs === null || bodyHex === '') {
      setAlert({
        tone: 'error',
        title: 'Cannot resend',
        message: 'That history row no longer holds a complete request. Load it and correct the form.',
      })
      return
    }
    void runSend({
      host: entry.host,
      port,
      timeoutMs,
      framing: entry.framing,
      headerSize,
      bodyHex,
      request: entry.request,
      inputHex: entry.inputHex,
      outputHex: entry.outputHex,
    })
  }

  // -- buffer bridges --------------------------------------------------------

  function loadBuffer() {
    if (!activeBuffer) {
      toast.error('No buffer is open to load.')
      return
    }
    if (activeBuffer.raw.trim() === '') {
      toast.error(`${activeBuffer.name} is empty.`)
      return
    }
    const store = useNetwork.getState()
    store.setInputHex(activeBuffer.inputHex)
    store.setRequest(activeBuffer.raw)
    setAttempted(false)
    toast.success(`Loaded ${activeBuffer.name} into the request.`)
  }

  async function decodeInWorkspace() {
    if (!result) return
    const bodyHex = responseBodyHex
    if (bodyHex === '') {
      setDecodeError('The response has no body to decode.')
      return
    }

    setDecoding(true)
    setDecodeError(null)

    const header = {
      enabled: result.framing !== 'none',
      mode: result.framing,
      size: result.headerSize > 0 ? result.headerSize : 4,
    }

    const bufferStore = useBuffers.getState()
    const targetId =
      decodeTarget === 'active' && activeBuffer
        ? activeBuffer.id
        : bufferStore.newTab({ name: `response-${formatClock(result.at).replace(/:/g, '')}` })

    const target = useBuffers.getState().tabs.find((tab) => tab.id === targetId)
    if (!target) {
      setDecodeError('The target buffer is no longer open.')
      setDecoding(false)
      return
    }

    // The whole wire goes into the buffer, header included, so the buffer holds
    // exactly what came back and the engine does the un-framing.
    useBuffers.getState().setActive(targetId)
    useBuffers.getState().update(targetId, {
      raw: result.responseHex,
      inputHex: true,
      header,
    })

    const decoded = await tryCall<IsoDecodeResult>('iso.decode', {
      packager: target.packager,
      payload: result.responseHex,
      inputHex: true,
      legacyEngine,
      header,
      autoDetect: target.autoDetect,
    })

    setDecoding(false)

    if (!decoded.ok) {
      const message = decoded.error.message
      setDecodeError(message)
      useBuffers.getState().update(targetId, { lastError: message })
      addProblem({ severity: 'error', source: 'Network', message: `Decode response: ${message}` })
      return
    }

    const fields: FieldRow[] = decoded.data.fields.map((field) => ({
      id: field.id,
      value: field.value,
      desc: field.desc,
      type: field.type,
      length: field.length,
      variable: field.variable,
    }))

    useBuffers.getState().update(targetId, {
      fields,
      decoded: true,
      stale: false,
      lastError: undefined,
    })
    toast.success(`Decoded ${fields.length} fields into ${target.name}.`)
  }

  // -- endpoints -------------------------------------------------------------

  function openSaveDialog() {
    const suggestion = net.host.trim() === '' ? '' : `${net.host.trim()}:${net.port}`
    setEndpointName(suggestion)
    setSaveOpen(true)
  }

  function confirmSaveEndpoint() {
    const name = endpointName.trim()
    if (name === '') return
    useNetwork.getState().saveEndpoint(name)
    setSaveOpen(false)
    toast.success(`Saved endpoint "${name}".`)
  }

  // -- pasted response -------------------------------------------------------

  function confirmPaste() {
    const hex = normalizeHex(pasteValue)
    if (hex === '') {
      setPasteError('Paste the response bytes as hex.')
      return
    }
    if (hex.length % 2 !== 0) {
      setPasteError(`Hex needs an even number of digits (${hex.length} now).`)
      return
    }

    let wire = hex
    if (net.framing !== 'none' && !pasteHasHeader) {
      const framed = frameRequest(net.framing, headerSizeNum, hex)
      if (!framed.ok) {
        setPasteError(framed.message)
        return
      }
      wire = framed.wireHex
    }

    useNetwork.getState().setResult({
      requestHex: wireHex,
      responseHex: wire,
      elapsedMs: 0,
      bytesSent: byteLength(wireHex),
      bytesReceived: byteLength(wire),
      framing: net.framing,
      headerSize: headerSizeNum,
      source: 'pasted',
      at: Date.now(),
    })
    setPasteError(null)
    setPasteOpen(false)
    setPasteValue('')
    setResponseView('body')
    setAlert(null)
  }

  // -- render ----------------------------------------------------------------

  const headerDisabled = net.framing === 'none'
  const limit = headerLimit(net.framing)

  return (
    <div className="flex min-w-0 flex-col gap-group p-panel" onKeyDown={handleKeyDown}>
      {!tcpEnabled && (
        <InlineAlert
          tone="info"
          title="Sending needs the desktop app"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={DESKTOP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-control-xs items-center gap-1 rounded-xs border border-border bg-surface-2 px-2 text-xs text-text hover:bg-surface-3"
              >
                <Download size={14} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
                Download desktop app
              </a>
              <Button size="xs" icon={Upload} onClick={() => setPasteOpen(true)}>
                Paste a response
              </Button>
            </div>
          }
        >
          The TCP tester needs raw socket access, which browsers do not provide. Use the desktop app,
          or paste a captured response and decode it into a buffer. {gateReason} Everything else on
          this panel still works: compose the request, check the framed wire bytes, and copy them.
        </InlineAlert>
      )}

      {/* ------------------------------------------------------------ ENDPOINT */}
      <Section
        title="Endpoint"
        actions={
          <>
            <SavedEndpoints
              endpoints={net.endpoints}
              onApply={(id) => {
                useNetwork.getState().applyEndpoint(id)
                setAttempted(false)
              }}
              onRemove={(id) => useNetwork.getState().removeEndpoint(id)}
            />
            <Button size="xs" icon={Save} onClick={openSaveDialog}>
              Save endpoint
            </Button>
          </>
        }
      >
        <Field label="Host" error={hostError} hint="Host name or IP address. No scheme, no path.">
          <Input
            value={net.host}
            onValueChange={(value) => useNetwork.getState().setHost(value)}
            mono
            placeholder="10.20.30.40"
            invalid={hostError !== undefined}
            disabled={!tcpEnabled}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <div className="grid grid-cols-2 gap-field">
          <Field label="Port" error={portError}>
            <Input
              value={net.port}
              onValueChange={(value) => useNetwork.getState().setPort(digitsOnly(value, 5))}
              mono
              inputMode="numeric"
              invalid={portError !== undefined}
              disabled={!tcpEnabled}
              autoComplete="off"
            />
          </Field>
          <Field label="Timeout" error={timeoutError} hint="100–120000 ms for the whole exchange.">
            <Input
              value={net.timeoutMs}
              onValueChange={(value) => useNetwork.getState().setTimeoutMs(digitsOnly(value, 6))}
              mono
              inputMode="numeric"
              suffix={<span className="text-2xs text-text-tertiary">ms</span>}
              invalid={timeoutError !== undefined}
              disabled={!tcpEnabled}
              autoComplete="off"
            />
          </Field>
        </div>
      </Section>

      {/* ------------------------------------------------------------- FRAMING */}
      <Section title="Framing">
        <div className="grid grid-cols-2 items-start gap-field">
          <LabeledGroup id="net-framing-mode" label="Mode">
            <SegmentedControl
              aria-labelledby="net-framing-mode"
              value={net.framing}
              onValueChange={changeFraming}
              options={[
                { value: 'none', label: 'None' },
                { value: 'ascii', label: 'ASCII' },
                { value: 'binary', label: 'Binary' },
              ]}
            />
          </LabeledGroup>

          <Field
            label="Header size"
            error={headerSizeError}
            hint={
              headerDisabled
                ? 'No header is sent with None framing.'
                : `1–${limit} bytes for ${framingLabel(net.framing)}.`
            }
          >
            <Input
              value={net.headerSize}
              onValueChange={(value) => useNetwork.getState().setHeaderSize(digitsOnly(value, 1))}
              mono
              inputMode="numeric"
              suffix={
                <span className="flex items-center gap-1">
                  <span className="text-2xs text-text-tertiary">bytes</span>
                  {/* The lock pins a hand-entered width against a framing change
                      (UX_SPEC 3.8). It sits in the suffix rather than the label
                      so it is never nested inside a `<label for>`. */}
                  <IconButton
                    icon={net.headerLocked ? Lock : LockOpen}
                    label={
                      net.headerLocked
                        ? 'Header size is pinned against framing changes'
                        : 'Pin the header size against framing changes'
                    }
                    size="xs"
                    variant="ghost"
                    disabled={headerDisabled}
                    aria-pressed={net.headerLocked}
                    onClick={() => useNetwork.getState().setHeaderLocked(!net.headerLocked)}
                  />
                </span>
              }
              invalid={headerSizeError !== undefined}
              disabled={headerDisabled}
              autoComplete="off"
            />
          </Field>
        </div>

        {sizeNote ? (
          <p role="status" className="text-2xs text-warn">
            {sizeNote}
          </p>
        ) : null}

        <div className="grid grid-cols-2 items-start gap-field">
          <LabeledGroup id="net-input-mode" label="Input">
            <SegmentedControl
              aria-labelledby="net-input-mode"
              value={net.inputHex ? 'hex' : 'text'}
              onValueChange={(value) => useNetwork.getState().setInputHex(value === 'hex')}
              options={[
                { value: 'hex', label: 'Hex' },
                { value: 'text', label: 'Text' },
              ]}
            />
          </LabeledGroup>
          <LabeledGroup id="net-output-mode" label="Output">
            <SegmentedControl
              aria-labelledby="net-output-mode"
              value={net.outputHex ? 'hex' : 'text'}
              onValueChange={(value) => useNetwork.getState().setOutputHex(value === 'hex')}
              options={[
                { value: 'hex', label: 'Hex Out' },
                { value: 'text', label: 'Text Out' },
              ]}
            />
          </LabeledGroup>
        </div>
      </Section>

      {/* ------------------------------------------------------------- REQUEST */}
      <Section
        title="Request"
        actions={
          <>
            <Button size="xs" icon={Upload} onClick={loadBuffer} disabled={!activeBuffer}>
              Load buffer
              {activeBuffer ? ` · ${activeBuffer.name}` : ''}
            </Button>
            {net.request === '' ? null : (
              <CopyButton value={net.request} label="Copy request body" size="xs" />
            )}
          </>
        }
      >
        <Field
          label={net.inputHex ? 'Body (hex)' : 'Body (text)'}
          error={requestError}
          hint={
            net.inputHex
              ? `${formatBytes(requestBytes)} · header excluded, the host prepends it`
              : `${formatBytes(requestBytes)} UTF-8 · header excluded`
          }
        >
          <Textarea
            value={net.request}
            onValueChange={(value) => useNetwork.getState().setRequest(value)}
            mono
            rows={4}
            autoResize
            invalid={requestError !== undefined}
            spellCheck={false}
            placeholder={net.inputHex ? '30 32 30 30 …' : '0200…'}
          />
        </Field>

        <LabeledGroup
          id="net-request-wire"
          label="Wire"
          hint={
            frame.ok
              ? net.framing === 'none'
                ? `${formatBytes(byteLength(wireHex))} · no framing header`
                : `${formatBytes(byteLength(wireHex))} · ${headerSizeNum}-byte ${framingLabel(net.framing)} header ${wireHeaderHex || '—'}`
              : frame.message
          }
        >
          <div className="flex items-start gap-2">
            <Readout
              aria-label="Framed request bytes"
              className="min-h-10 flex-1"
              value={frame.ok ? groupWireHex(wireHex) : ''}
              empty={frame.ok ? 'Nothing to send yet.' : 'The request cannot be framed.'}
            />
            <div className="w-7 shrink-0">
              {frame.ok && wireHex !== '' ? (
                <CopyButton value={wireHex} label="Copy request wire hex" size="xs" />
              ) : null}
            </div>
          </div>
        </LabeledGroup>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="primary"
            icon={Send}
            loading={sending}
            disabled={!canSend}
            title={tcpEnabled ? undefined : gateReason}
            onClick={handleSend}
          >
            Send
          </Button>
          <Button variant="default" icon={X} disabled={!sending} onClick={handleCancel}>
            Cancel
          </Button>
          <span className="flex items-center gap-1 text-2xs text-text-tertiary">
            <Kbd>Ctrl</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          <span aria-live="polite" className="ml-auto text-xs">
            {sending ? (
              <Badge tone="info" dot>
                connecting… {(elapsed / 1000).toFixed(1)}s
              </Badge>
            ) : null}
          </span>
        </div>

        {alert ? (
          <InlineAlert
            tone={alert.tone}
            title={alert.title}
            onDismiss={() => setAlert(null)}
            action={
              alert.tone === 'error' && tcpEnabled ? (
                <Button size="xs" icon={Send} disabled={!canSend} onClick={handleSend}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {alert.message}
          </InlineAlert>
        ) : null}
      </Section>

      {/* ------------------------------------------------------------ RESPONSE */}
      <Section
        title="Response"
        actions={
          result ? (
            <>
              {result.source === 'pasted' ? <Badge tone="warn">pasted</Badge> : null}
              <SegmentedControl
                aria-label="Response view"
                size="xs"
                value={responseView}
                onValueChange={(value) => setResponseView(value === 'wire' ? 'wire' : 'body')}
                options={[
                  { value: 'body', label: 'Body' },
                  { value: 'wire', label: 'Wire' },
                ]}
              />
              <CopyButton
                value={responseView === 'wire' ? result.responseHex : responseBodyCopy}
                label={responseView === 'wire' ? 'Copy response wire hex' : 'Copy response body'}
                size="xs"
              />
            </>
          ) : null
        }
      >
        {result ? (
          <>
            <Readout
              aria-label={responseView === 'wire' ? 'Response wire bytes' : 'Response body'}
              value={responseView === 'wire' ? responseWireDisplay : responseBodyDisplay}
              empty="The host answered with a header and no body."
            />

            <div className="flex flex-col gap-1 pt-1">
              <ResultRow
                label="Bytes"
                value={String(result.bytesReceived)}
                display={
                  <span className="tabular-nums">
                    {result.bytesReceived}{' '}
                    <span className="text-text-tertiary">
                      ({byteLength(responseBodyHex)} body, {result.headerSize} header)
                    </span>
                  </span>
                }
                copyLabel="Copy byte count"
              />
              <ResultRow
                label="Elapsed"
                value={String(result.elapsedMs)}
                display={
                  <span className="tabular-nums">
                    {result.source === 'pasted' ? 'not measured (pasted)' : formatElapsed(result.elapsedMs)}
                  </span>
                }
                copyLabel="Copy elapsed time"
              />
              <ResultRow
                label="Wire hex"
                value={result.responseHex}
                display={groupWireHex(result.responseHex)}
                copyLabel="Copy response wire hex"
              />
              <ResultRow
                label="Sent"
                value={result.requestHex}
                display={groupWireHex(result.requestHex)}
                copyLabel="Copy sent wire hex"
              />
            </div>

            <div className="flex flex-wrap items-end justify-end gap-2 pt-1">
              <div className="w-56">
                <Field label="Decode into">
                  <Select
                    value={decodeTarget}
                    onValueChange={(value) => setDecodeTarget(value === 'active' ? 'active' : 'new')}
                    options={[
                      { value: 'new', label: 'A new buffer tab' },
                      {
                        value: 'active',
                        label: activeBuffer ? `Active buffer · ${activeBuffer.name}` : 'Active buffer',
                        disabled: !activeBuffer,
                      },
                    ]}
                  />
                </Field>
              </div>
              <Button
                icon={SquareArrowOutUpRight}
                loading={decoding}
                disabled={responseBodyHex === '' || decoding}
                onClick={() => void decodeInWorkspace()}
              >
                Decode response in workspace
              </Button>
            </div>

            {decodeError ? (
              <InlineAlert tone="error" title="Decode failed" onDismiss={() => setDecodeError(null)}>
                {decodeError}
              </InlineAlert>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={Radio}
            title="No response yet"
            description={
              tcpEnabled
                ? 'Send the composed request, or paste a response captured elsewhere.'
                : 'This host cannot open sockets. Paste a response captured elsewhere to decode it here.'
            }
            action={
              <Button size="sm" icon={Upload} onClick={() => setPasteOpen(true)}>
                Paste a response
              </Button>
            }
            hint={tcpEnabled ? 'Ctrl+Enter to send' : undefined}
          />
        )}
      </Section>

      {/* ------------------------------------------------------------- HISTORY */}
      <Section
        title="History"
        actions={
          net.history.length > 0 ? (
            <Button
              size="xs"
              variant="ghost"
              icon={Eraser}
              onClick={() => useNetwork.getState().clearHistory()}
            >
              Clear
            </Button>
          ) : null
        }
      >
        <HistoryList
          entries={net.history}
          onLoad={loadHistory}
          onResend={resendHistory}
          resendDisabled={!tcpEnabled || sending}
          resendReason={tcpEnabled ? 'A request is already in flight.' : gateReason}
        />
      </Section>

      {/* -------------------------------------------------------------- DIALOGS */}
      <Dialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Save endpoint"
        description="Host, port, timeout and framing only. The request body is never saved."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={endpointName.trim() === ''} onClick={confirmSaveEndpoint}>
              Save endpoint
            </Button>
          </>
        }
      >
        <Field
          label="Name"
          hint="An existing profile with the same name is overwritten."
          error={endpointName.trim() === '' ? 'Give the endpoint a name.' : undefined}
        >
          <Input
            value={endpointName}
            onValueChange={setEndpointName}
            placeholder="Acquirer test host"
            autoFocus
            invalid={endpointName.trim() === ''}
          />
        </Field>
      </Dialog>

      <Dialog
        open={pasteOpen}
        onOpenChange={(open) => {
          setPasteOpen(open)
          if (!open) setPasteError(null)
        }}
        title="Paste a captured response"
        description="Bytes captured from a sniffer or another tool, so they can be inspected and decoded here."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmPaste}>
              Use response
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-field">
          <Field label="Response bytes (hex)" error={pasteError ?? undefined}>
            <Textarea
              value={pasteValue}
              onValueChange={(value) => {
                setPasteValue(value)
                setPasteError(null)
              }}
              mono
              rows={5}
              spellCheck={false}
              invalid={pasteError !== null}
              placeholder="30 31 33 32 F2 3C 44 91 …"
            />
          </Field>
          <Checkbox
            checked={pasteHasHeader}
            onCheckedChange={setPasteHasHeader}
            disabled={net.framing === 'none'}
            label="These bytes include the framing header"
            description={
              net.framing === 'none'
                ? 'None framing carries no header, so the bytes are taken as the body.'
                : `Unchecked, a ${headerSizeNum}-byte ${framingLabel(net.framing)} header is computed and prepended.`
            }
          />
        </div>
      </Dialog>
    </div>
  )
}
