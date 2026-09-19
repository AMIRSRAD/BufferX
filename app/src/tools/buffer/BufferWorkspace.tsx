/**
 * The buffer workspace (UX_SPEC 2) — the primary surface of BufferX.
 *
 * ```
 * ┌────────────────────────────────────────────────────────────┐
 * │ RAW PANE   [Text│Hex│Bytes]  [Decode] [Build] [Auto] …     │
 * │ ── structure ribbon ──────────────────────────────────────  │
 * │ Framing  [Auto-detect] [Include on build] [ASCII│Binary] …  │
 * ├──────────────── splitter (Alt+Shift+↑↓) ───────────────────┤
 * │ FIELDS  ⌕ filter  [Present only] [Errors only]  [Columns] … │
 * │ ┌────┬──────────┬──────┬─────┬───────────────┬─────┬─────┐ │
 * └────────────────────────────────────────────────────────────┘
 * ```
 *
 * This file owns orchestration only: engine calls, the staleness model, undo,
 * the shell command surface, and buffer file I/O. Layout lives in `RawPane`,
 * `FieldTable`, `StructureRibbon`, `PackagerControls`, `ResolutionCard` and
 * `ValueSheet`; arithmetic lives in `model.ts`.
 *
 * Secrets: a buffer holds message content — PAN in F2, track data in F35, a PIN
 * block in F52. Nothing here writes buffer content to storage, to a URL, or to
 * the console. The only persisted state is the layout allowlist in `prefs.ts`,
 * and the only serialisation is a buffer file the operator explicitly saves.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { ClipboardPaste, FileUp, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Kbd } from '@/components/ui/Kbd'
import { SplitPane } from '@/components/ui/SplitPane'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import { hostCapabilities, tryCall } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers, type FieldRow, type HeaderConfig } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { useTools } from '@/store/tools'
import { setShellStatus } from '@/shell/StatusStrip'
import {
  SHELL_ACTION_EVENT,
  SHELL_COMMAND_EVENT,
  type ShellActionDetail,
  type ShellCommandDetail,
} from '@/shell/useShortcuts'
import { FieldTable, type FieldRowView, type SendTarget } from './FieldTable'
import {
  PackagerCandidates,
  PackagerPicker,
  type PackagerCandidate,
  type PackagerRemapSummary,
} from './PackagerControls'
import { RawPane, nextRawView, type CopyFormat } from './RawPane'
import { ResolutionCard, type ResolutionItem } from './ResolutionCard'
import { ValueSheet } from './ValueSheet'
import { openBuffer, readFile, saveBuffer, canUseNativeFiles, downloadText } from './files'
import { loadPrefs, savePrefs, type WorkspacePrefs } from './prefs'
import {
  BUFFER_FILE_FORMAT,
  BUFFER_FILE_VERSION,
  DEFAULT_FIELD_SET,
  TEMPLATES,
  applyFix,
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  bytesToHex,
  bytesToText,
  bufferFileToTabInit,
  clampHeaderSize,
  decodeHeaderArgs,
  computeRegions,
  encodeBufferFile,
  fieldColorIndex,
  fieldsSignature,
  fieldsToJson,
  fieldsToTsv,
  hexToBytes,
  isBinaryType,
  isNumericType,
  normalizeFieldDefs,
  normalizeHex,
  normalizePackagerList,
  rawToBytes,
  sensitiveFieldNote,
  sniffEncoding,
  toCArray,
  toHexDump,
  validateFieldValue,
  worstSeverity,
  writeClipboard,
  type ExportField,
  type FieldDef,
  type PackagerInfo,
  type Region,
  type RegionField,
} from './model'

/* ────────────────────────────────────────────────────────────────────────────
   Engine response shapes
   ──────────────────────────────────────────────────────────────────────────── */

interface DecodedField {
  id: number
  value: string
  hex?: string
  desc?: string
  type?: string
  length?: number
  variable?: boolean
}

interface DecodeOutcome {
  fields: DecodedField[]
  headerDetected: boolean
  headerFormat: 'none' | 'ascii' | 'binary' | null
  headerSize: number | null
  byteLength: number | null
}

function normalizeDecode(data: unknown): DecodeOutcome {
  const record = asRecord(data)
  const fields: DecodedField[] = []

  for (const entry of asArray(record?.fields)) {
    const item = asRecord(entry)
    if (!item) continue
    const id = asNumber(item.id) ?? asNumber(item.bit)
    if (id === undefined) continue
    const field: DecodedField = { id, value: asString(item.value) ?? '' }
    const hex = asString(item.hex)
    if (hex) field.hex = hex
    const desc = asString(item.desc) ?? asString(item.name)
    if (desc) field.desc = desc
    const type = asString(item.type)
    if (type) field.type = type
    const length = asNumber(item.length)
    if (length !== undefined) field.length = length
    const variable = asBoolean(item.variable)
    if (variable !== undefined) field.variable = variable
    fields.push(field)
  }
  fields.sort((a, b) => a.id - b.id)

  const formatRaw = (asString(record?.headerFormat) ?? '').toLowerCase()
  const headerFormat =
    formatRaw === 'ascii' || formatRaw === 'binary' || formatRaw === 'none' ? formatRaw : null

  return {
    fields,
    headerDetected: asBoolean(record?.headerDetected) ?? false,
    headerFormat,
    headerSize: asNumber(record?.headerSize) ?? null,
    byteLength: asNumber(record?.byteLength) ?? asNumber(record?.messageLength) ?? null,
  }
}

interface EncodeOutcome {
  hex: string
  text: string
  byteLength: number
}

function normalizeEncode(data: unknown): EncodeOutcome {
  const record = asRecord(data)
  return {
    hex: asString(record?.hex) ?? '',
    text: asString(record?.text) ?? '',
    byteLength: asNumber(record?.byteLength) ?? 0,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Undo
   ──────────────────────────────────────────────────────────────────────────── */

interface Snapshot {
  label: string
  raw: string
  inputHex: boolean
  packager: string
  header: HeaderConfig
  autoDetect: boolean
  fields: FieldRow[]
}

const UNDO_DEPTH = 100

/* ────────────────────────────────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────────────────────────────────── */

export default function BufferWorkspace() {
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const update = useBuffers((state) => state.update)
  const newTab = useBuffers((state) => state.newTab)
  const removeField = useBuffers((state) => state.removeField)
  const addFieldToStore = useBuffers((state) => state.addField)

  const legacyEngine = useSettings((state) => state.legacyEngine)
  const density = useSettings((state) => state.density)
  const setDensity = useSettings((state) => state.setDensity)

  const addProblem = useProblems((state) => state.add)
  const clearProblems = useProblems((state) => state.clear)
  const clearFieldProblems = useProblems((state) => state.clearField)

  const openTool = useTools((state) => state.openTool)

  const tab = tabs.find((candidate) => candidate.id === activeId)
  const tabId = tab?.id ?? null

  /* ── Preferences ─────────────────────────────────────────────────────── */

  const [prefs, setPrefsState] = useState<WorkspacePrefs>(() => loadPrefs())
  const setPrefs = useCallback((patch: Partial<WorkspacePrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch }
      savePrefs(next)
      return next
    })
  }, [])

  /* ── Local state ─────────────────────────────────────────────────────── */

  const [packagers, setPackagers] = useState<PackagerInfo[] | null>(null)
  const [packagerError, setPackagerError] = useState<string | null>(null)
  const [packagerSource, setPackagerSource] = useState('data/packagers.xml')

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])

  const [decoding, setDecoding] = useState(false)
  const [building, setBuilding] = useState(false)
  const [decodeError, setDecodeError] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)

  const [candidates, setCandidates] = useState<PackagerCandidate[] | null>(null)
  const [sweep, setSweep] = useState<{ done: number; total: number } | null>(null)
  const sweepCancelled = useRef(false)

  const [remap, setRemap] = useState<PackagerRemapSummary | null>(null)
  const [resolution, setResolution] = useState<ResolutionItem[]>([])

  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null)
  const [hoveredFieldId, setHoveredFieldId] = useState<number | null>(null)
  const [sheetFieldId, setSheetFieldId] = useState<number | null>(null)

  const [encodingGuess, setEncodingGuess] = useState<'hex' | 'text' | null>(null)
  const [encodingLocked, setEncodingLocked] = useState(false)
  const [headerOrigin, setHeaderOrigin] = useState('manual')
  const [detectedFlash, setDetectedFlash] = useState(false)

  const [filterText, setFilterText] = useState('')
  const [addFieldFocus, setAddFieldFocus] = useState<number | null>(null)
  const [splitEpoch, setSplitEpoch] = useState(0)
  const [dragging, setDragging] = useState(false)

  /** Per-field wire hex from the last decode. Never written to the store. */
  const [wireHex, setWireHex] = useState<Map<number, string>>(() => new Map())

  /** Real filesystem paths, per tab. Desktop only; never persisted. */
  const filePaths = useRef<Map<string, string>>(new Map())

  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])

  /** Raw and field state as of the last successful decode or build. */
  const syncedRaw = useRef<string>('')
  const syncedFields = useRef<string>('')

  const rootRef = useRef<HTMLDivElement>(null)

  /* ── Derived ─────────────────────────────────────────────────────────── */

  const defsById = useMemo(() => new Map(fieldDefs.map((def) => [def.id, def])), [fieldDefs])

  const bytes = useMemo(
    () => (tab ? rawToBytes(tab.raw, tab.inputHex) : new Uint8Array(0)),
    [tab],
  )

  const regionFields = useMemo<RegionField[]>(() => {
    if (!tab) return []
    return tab.fields.map((field) => {
      const def = defsById.get(field.id)
      const entry: RegionField = {
        id: field.id,
        value: field.value,
        hexMode: field.hex ?? false,
      }
      const hex = wireHex.get(field.id)
      if (hex) entry.hex = hex
      const desc = field.desc ?? def?.name
      if (desc) entry.desc = desc
      const type = field.type ?? def?.type
      if (type) entry.type = type
      return entry
    })
  }, [tab, wireHex, defsById])

  const headerBytes =
    tab && tab.header.mode !== 'none' && (tab.header.enabled || tab.autoDetect) ? tab.header.size : 0

  const regionMap = useMemo(
    () => computeRegions(bytes, regionFields, headerBytes),
    [bytes, regionFields, headerBytes],
  )

  const highlights = useMemo(
    () =>
      regionMap.regions.map((region) => ({
        start: region.start,
        end: region.end,
        colorIndex: region.colorIndex,
        label: region.label,
      })),
    [regionMap],
  )

  const rows = useMemo<FieldRowView[]>(() => {
    if (!tab) return []
    const ids = tab.fields.map((field) => field.id)
    return tab.fields.map((field) => {
      const def = defsById.get(field.id)
      const type = field.type ?? def?.type
      const declaredLength = field.length ?? def?.length
      const hexMode = (field.hex ?? false) || isBinaryType(type)
      const diagnostics = validateFieldValue({
        value: field.value,
        hexMode,
        def: def ?? { id: field.id, type, length: declaredLength, variable: field.variable },
        bufferIsText: !tab.inputHex,
      })
      if (field.invalid) {
        diagnostics.unshift({
          code: 'badHex',
          severity: 'error',
          glyph: '!',
          message: field.invalid,
          fix: null,
        })
      }
      return {
        id: field.id,
        value: field.value,
        hexMode,
        desc: field.desc ?? def?.name ?? (def ? `Field ${field.id}` : 'Custom field'),
        type,
        declaredLength,
        variable: field.variable ?? def?.variable ?? false,
        custom: def === undefined,
        diagnostics,
        severity: worstSeverity(diagnostics),
        colorIndex: fieldColorIndex(ids, field.id),
        region: regionMap.byField.get(field.id),
      }
    })
  }, [tab, defsById, regionMap])

  const fieldsStale = tab ? tab.raw !== syncedRaw.current : false
  const rawStale = tab ? fieldsSignature(tab.fields) !== syncedFields.current : false

  /* ── Store helpers ───────────────────────────────────────────────────── */

  const snapshot = useCallback(
    (label: string): Snapshot | null => {
      if (!tab) return null
      return {
        label,
        raw: tab.raw,
        inputHex: tab.inputHex,
        packager: tab.packager,
        header: { ...tab.header },
        autoDetect: tab.autoDetect,
        fields: tab.fields.map((field) => ({ ...field })),
      }
    },
    [tab],
  )

  const pushUndo = useCallback(
    (label: string) => {
      const entry = snapshot(label)
      if (!entry) return
      undoStack.current = [...undoStack.current, entry].slice(-UNDO_DEPTH)
      redoStack.current = []
    },
    [snapshot],
  )

  const applySnapshot = useCallback(
    (entry: Snapshot) => {
      if (!tabId) return
      update(tabId, {
        raw: entry.raw,
        inputHex: entry.inputHex,
        packager: entry.packager,
        header: entry.header,
        autoDetect: entry.autoDetect,
        fields: entry.fields,
      })
    },
    [tabId, update],
  )

  const patchFields = useCallback(
    (mutate: (fields: FieldRow[]) => FieldRow[]) => {
      if (!tab || !tabId) return
      update(tabId, { fields: mutate(tab.fields.map((field) => ({ ...field }))) })
    },
    [tab, tabId, update],
  )

  const patchField = useCallback(
    (fieldId: number, patch: Partial<FieldRow>) => {
      patchFields((fields) =>
        fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
      )
    },
    [patchFields],
  )

  /* ── Packager catalogue ──────────────────────────────────────────────── */

  const loadPackagers = useCallback(async () => {
    const result = await tryCall('packager.list', {})
    if (result.ok) {
      setPackagers(normalizePackagerList(result.data))
      setPackagerError(null)
    } else {
      setPackagers([])
      setPackagerError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void loadPackagers()
  }, [loadPackagers])

  useEffect(() => {
    if (!tab?.packager) {
      setFieldDefs([])
      return
    }
    let cancelled = false
    void tryCall('packager.fields', { packager: tab.packager }).then((result) => {
      if (cancelled) return
      setFieldDefs(result.ok ? normalizeFieldDefs(result.data) : [])
    })
    return () => {
      cancelled = true
    }
  }, [tab?.packager])

  /* ── Framing adoption from the packager (UX_SPEC 2.2 step 4) ─────────── */

  // Keyed by tab so that switching buffer tabs — which also changes the active
  // packager name — never looks like a packager switch.
  const previousPackager = useRef<{ tabId: string; packager: string } | null>(null)
  useEffect(() => {
    if (!tab || !tabId) return
    const previous = previousPackager.current
    previousPackager.current = { tabId, packager: tab.packager }
    if (previous === null || previous.tabId !== tabId) return
    const from = previous.packager
    if (from === tab.packager) return
    if (packagers === null) return

    const info = packagers.find((entry) => entry.name === tab.packager)
    const changes: string[] = []

    if (info?.lenLen !== undefined && !prefs.headerSizeLocked) {
      const next = clampHeaderSize(info.lenLen)
      if (next !== tab.header.size) {
        changes.push(`Header size ${tab.header.size} → ${next} (LenLen)`)
        update(tabId, { header: { size: next } })
        setHeaderOrigin(`${next} · from packager LenLen`)
      }
    }
    if (info?.macMethod) {
      changes.push(
        `MAC ${info.macMethod}${info.macSize ? `/${info.macSize}` : ''}${
          info.macFieldIds?.length ? ` on F${info.macFieldIds.join(', F')}` : ''
        }`,
      )
    }

    // Field values survive the switch; the remap card states exactly what the
    // new packager does and does not define (UX_SPEC 2.2).
    setRemap({ from, to: tab.packager, mapped: 0, custom: [], changes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, tab?.packager, packagers])

  /**
   * Once the new definitions land, report the switch — as a toast, not as a
   * block in the document.
   *
   * This used to render an inline card between the raw pane and the field
   * table, which shoved the whole workspace down to announce something that is
   * usually a non-event ("SLM defines 23 of your 23 fields"). Switching a
   * packager is transient and undoable, and DESIGN_SYSTEM 5.1 puts exactly
   * that in a toast. Anything the operator may need to act on *later* — fields
   * the new packager does not define — goes to the Problems drawer instead,
   * because a toast is not re-readable.
   */
  useEffect(() => {
    if (!remap || !tab) return
    if (fieldDefs.length === 0 && tab.fields.length > 0) return

    const custom = tab.fields.filter((field) => !defsById.has(field.id)).map((field) => field.id)
    const mapped = tab.fields.length - custom.length
    const total = mapped + custom.length

    const detail = [
      total > 0 ? `${remap.to} defines ${mapped} of ${total} fields.` : null,
      ...remap.changes,
    ]
      .filter(Boolean)
      .join(' · ')

    toast.info(`Switched packager ${remap.from} → ${remap.to}`, {
      ...(detail ? { description: detail } : {}),
      action: {
        label: 'Undo',
        onClick: () => undo(),
      },
    })

    setRemap(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remap, fieldDefs, defsById])

  /**
   * Fields the byte view cannot locate are reported in the Problems drawer.
   *
   * This was an inline warning sitting directly on top of the field table, so
   * it pushed the table down every time a field was edited — during the exact
   * interaction it was describing, and for a condition its own text calls
   * expected. Persistent advisory state belongs somewhere re-readable and out
   * of the way, which is what the drawer is for.
   */
  /**
   * Fields the active packager does not define, recomputed rather than logged.
   *
   * This started as a one-shot entry written when the packager changed, which
   * meant it survived every later switch and edit that resolved it. Deriving it
   * from current state instead makes it self-retracting: it is present exactly
   * while it is true.
   */
  const customFieldKey = tab?.fields
    .filter((field) => !defsById.has(field.id))
    .map((field) => field.id)
    .join(',')
  useEffect(() => {
    clearProblems('Packager')
    if (!customFieldKey || fieldDefs.length === 0) return
    const custom = customFieldKey.split(',')
    addProblem({
      severity: 'warning',
      source: 'Packager',
      message: `${tab?.packager ?? 'This packager'} does not define F${custom.join(', F')} — ${
        custom.length === 1 ? 'it is' : 'they are'
      } kept as custom. Remove ${custom.length === 1 ? 'it' : 'them'} in the field table if unwanted.`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFieldKey, fieldDefs.length])

  const unmappedKey = regionMap.unmapped.join(',')
  useEffect(() => {
    clearProblems('Byte view')
    if (!tab?.decoded || regionMap.unmapped.length === 0) return
    addProblem({
      severity: 'info',
      source: 'Byte view',
      message: `F${regionMap.unmapped.join(', F')} could not be located in the current raw bytes. Expected after editing fields — build, or decode again.`,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmappedKey, tab?.decoded])

  // Descriptions, types and lengths refresh from the new definitions.
  useEffect(() => {
    if (!tab || !tabId || tab.fields.length === 0 || fieldDefs.length === 0) return
    let changed = false
    const next = tab.fields.map((field) => {
      const def = defsById.get(field.id)
      if (!def) return field
      const desc = def.name ?? field.desc
      const type = def.type ?? field.type
      const length = def.length ?? field.length
      if (desc === field.desc && type === field.type && length === field.length) return field
      changed = true
      return { ...field, desc, type, length, variable: def.variable ?? field.variable }
    })
    if (changed) update(tabId, { fields: next, dirty: tab.dirty, stale: tab.stale })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defsById])

  /* ── Decode ──────────────────────────────────────────────────────────── */

  const decode = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!tab || !tabId) return
      if (tab.raw.trim() === '') {
        setDecodeError(null)
        return
      }

      // A decode replaces the whole field set, so anything said about the
      // previous one is stale. Retract it up front rather than only on success:
      // if this attempt also fails, the drawer should show *this* failure, not
      // a pile of every failure since the tab was opened.
      clearProblems('Decode')
      clearProblems('Fields')

      setDecoding(true)
      const result = await tryCall('iso.decode', {
        packager: tab.packager,
        payload: tab.raw,
        inputHex: tab.inputHex,
        legacyEngine,
        header: decodeHeaderArgs(tab.header, tab.autoDetect),
        autoDetect: tab.autoDetect,
      })
      setDecoding(false)

      if (!result.ok) {
        setDecodeError(result.error.message)
        addProblem({
          severity: 'error',
          source: 'Decode',
          message: `${tab.packager} could not decode ${tab.name}: ${result.error.message}`,
        })

        // A failed decode still carries everything the codec read before it
        // stopped. Showing those fields is the difference between "it broke"
        // and "it read 23 fields and died on the MAC" -- and a truncated or
        // malformed buffer is precisely when that matters. The rows are marked
        // partial so nothing downstream mistakes them for a clean decode.
        // The engine reports these under `partialFields` so a caller can never
        // confuse a partial read with a successful one; normalizeDecode reads
        // `fields`, so rename on the way in.
        const detail = asRecord(result.error.detail) ?? {}
        const partial = normalizeDecode({ fields: detail.partialFields })
        if (partial.fields.length > 0) {
          const partialHex = new Map<number, string>()
          const partialFields: FieldRow[] = partial.fields.map((field) => {
            if (field.hex) partialHex.set(field.id, field.hex)
            const def = defsById.get(field.id)
            return {
              id: field.id,
              value: field.value,
              desc: field.desc ?? def?.name,
              type: field.type ?? def?.type,
              length: field.length ?? def?.length,
              variable: field.variable ?? def?.variable,
              hex: isBinaryType(field.type ?? def?.type),
            }
          })
          setWireHex(partialHex)
          update(tabId, { fields: partialFields, decoded: false, stale: true })
          addProblem({
            severity: 'warning',
            source: 'Decode',
            message: `Recovered ${partialFields.length} field${
              partialFields.length === 1 ? '' : 's'
            } before the error. They are shown for inspection but the message is incomplete.`,
          })
        }

        if (!options?.silent) void identifyPackager()
        return
      }

      const outcome = normalizeDecode(result.data)
      setDecodeError(null)
      setCandidates(null)
      clearProblems('Decode')

      const nextHex = new Map<number, string>()
      const fields: FieldRow[] = outcome.fields.map((field) => {
        if (field.hex) nextHex.set(field.id, field.hex)
        const def = defsById.get(field.id)
        return {
          id: field.id,
          value: field.value,
          desc: field.desc ?? def?.name,
          type: field.type ?? def?.type,
          length: field.length ?? def?.length,
          variable: field.variable ?? def?.variable,
          hex: isBinaryType(field.type ?? def?.type),
        }
      })
      setWireHex(nextHex)

      const headerPatch: Partial<HeaderConfig> = {}
      if (tab.autoDetect && outcome.headerDetected) {
        if (outcome.headerFormat) headerPatch.mode = outcome.headerFormat
        if (outcome.headerSize !== null && !prefs.headerSizeLocked) {
          headerPatch.size = clampHeaderSize(outcome.headerSize)
        }
        setHeaderOrigin(
          `${headerPatch.size ?? tab.header.size} · detected by auto-detect on decode`,
        )
        setDetectedFlash(true)
        window.setTimeout(() => setDetectedFlash(false), 600)
      }

      update(tabId, {
        fields,
        decoded: true,
        stale: false,
        ...(Object.keys(headerPatch).length > 0 ? { header: headerPatch } : {}),
      })

      syncedRaw.current = tab.raw
      syncedFields.current = fieldsSignature(fields)
      setVerified(null)

      if (fields.length === 0) {
        addProblem({
          severity: 'warning',
          source: 'Decode',
          message: `Decoded 0 fields from ${bytes.length} bytes with ${tab.packager}. The packager may be wrong.`,
        })
      }
    },
    // `identifyPackager` is declared below and read through a ref-free closure
    // at call time; listing it here would create a cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, tabId, legacyEngine, addProblem, clearProblems, update, defsById, prefs.headerSizeLocked, bytes.length],
  )

  /* ── Identify packager (UX_SPEC 2.1) ─────────────────────────────────── */

  const identifyPackager = useCallback(async () => {
    if (!tab) return
    const list = packagers ?? []
    if (list.length === 0) {
      setCandidates([])
      return
    }

    sweepCancelled.current = false
    setCandidates([])
    setSweep({ done: 0, total: list.length })

    const found: PackagerCandidate[] = []
    for (let index = 0; index < list.length; index += 1) {
      if (sweepCancelled.current) break
      const info = list[index]
      if (!info) continue

      const result = await tryCall('iso.decode', {
        packager: info.name,
        payload: tab.raw,
        inputHex: tab.inputHex,
        legacyEngine,
        header: decodeHeaderArgs(tab.header, tab.autoDetect),
        autoDetect: tab.autoDetect,
      })

      if (result.ok) {
        const outcome = normalizeDecode(result.data)
        if (outcome.fields.length > 0) {
          const consumed = outcome.fields.reduce(
            (sum, field) =>
              sum + (field.hex ? Math.floor(normalizeHex(field.hex).length / 2) : field.value.length),
            0,
          )
          found.push({
            name: info.name,
            fields: outcome.fields.length,
            errors: 0,
            consumed: Math.min(consumed, bytes.length),
            total: bytes.length,
          })
        }
      }
      setSweep({ done: index + 1, total: list.length })
    }

    found.sort(
      (a, b) => b.fields - a.fields || b.consumed - a.consumed || a.errors - b.errors,
    )
    setCandidates(found)
    setSweep(null)
  }, [tab, packagers, legacyEngine, bytes.length])

  /* ── Auto-decode (350ms debounce, immediate on paste) ────────────────── */

  /**
   * A decode requested by paste, drop, or a packager switch runs on the *next*
   * render, so it sees the store update that caused it. Scheduling it with a
   * `setTimeout` from the calling handler would capture the pre-update tab and
   * decode the previous buffer — the bug this indirection exists to prevent.
   */
  const decodeRequested = useRef(false)
  const [decodeTick, setDecodeTick] = useState(0)

  const requestDecode = useCallback(() => {
    decodeRequested.current = true
    setDecodeTick((tick) => tick + 1)
  }, [])

  const rawForDebounce = tab?.raw ?? ''
  useEffect(() => {
    const immediate = decodeRequested.current
    decodeRequested.current = false
    if (rawForDebounce.trim() === '') return
    if (immediate) {
      void decode({ silent: true })
      return
    }
    if (!prefs.autoDecode) return
    if (rawForDebounce === syncedRaw.current) return
    const timer = window.setTimeout(() => {
      void decode({ silent: true })
    }, 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawForDebounce, decodeTick, prefs.autoDecode])

  /* ── Build (UX_SPEC 2.6) ─────────────────────────────────────────────── */

  const buildResolutionItems = useCallback((): ResolutionItem[] => {
    const items: ResolutionItem[] = []
    for (const row of rows) {
      for (const diagnostic of row.diagnostics) {
        if (diagnostic.severity !== 'error') continue
        if (diagnostic.fix === null) continue
        const after = applyFix(row.value, diagnostic.fix, row.hexMode, row.declaredLength)
        if (after === row.value) continue
        items.push({
          fieldId: row.id,
          title:
            diagnostic.code === 'nonNumeric'
              ? 'Numeric field contains non-digits'
              : diagnostic.code === 'length'
                ? 'Binary length mismatch'
                : 'Invalid hex value',
          detail: diagnostic.message,
          before: row.value,
          after,
          actionLabel: diagnostic.fixLabel ?? 'Apply suggestion',
        })
      }
    }
    return items
  }, [rows])

  const runEncode = useCallback(
    async (options: { allowBinaryPadding: boolean; allowNumericSanitize: boolean }) => {
      if (!tab || !tabId) return
      setBuilding(true)
      const result = await tryCall('iso.encode', {
        packager: tab.packager,
        fields: tab.fields.map((field) => ({ id: field.id, value: field.value })),
        outputHex: tab.inputHex,
        allowBinaryPadding: options.allowBinaryPadding,
        allowNumericSanitize: options.allowNumericSanitize,
        legacyEngine,
        header: { enabled: tab.header.enabled, mode: tab.header.mode, size: tab.header.size },
      })
      setBuilding(false)

      if (!result.ok) {
        const detail = result.error.detail ?? {}
        const fieldId = asNumber(detail.fieldId)
        const expected = asNumber(detail.expectedLength)
        const actual = asNumber(detail.actualLength)

        if (fieldId !== undefined && expected !== undefined && actual !== undefined) {
          const row = rows.find((candidate) => candidate.id === fieldId)
          const before = row?.value ?? ''
          setResolution([
            {
              fieldId,
              title: 'Binary length mismatch',
              detail: `declared ${expected} bytes · value is ${actual} bytes`,
              before,
              after: applyFix(before, 'pad', row?.hexMode ?? true, expected),
              actionLabel: 'Pad with zeros',
            },
          ])
        } else {
          setBuildError(result.error.message)
        }

        addProblem({
          severity: 'error',
          source: 'Build',
          message: result.error.message,
          ...(fieldId !== undefined ? { fieldId } : {}),
        })
        return
      }

      const outcome = normalizeEncode(result.data)
      const nextRaw = tab.inputHex ? outcome.hex : outcome.text
      const previousBytes = bytes.length

      pushUndo(`Build · replaced ${previousBytes} bytes`)
      // Build writes the raw pane and stops. It deliberately does *not*
      // re-decode: the table is the source of this encoding, so a round trip
      // could only lose information (UX_SPEC 2.6).
      update(tabId, { raw: nextRaw, stale: false })
      syncedRaw.current = nextRaw
      syncedFields.current = fieldsSignature(tab.fields)
      setBuildError(null)
      setResolution([])
      clearProblems('Build')
      toast.success(`Built ${outcome.byteLength} bytes.`)

      // Round-trip check, computed silently in the background. It never
      // mutates the table.
      const check = await tryCall('iso.decode', {
        packager: tab.packager,
        payload: nextRaw,
        inputHex: tab.inputHex,
        legacyEngine,
        header: decodeHeaderArgs(tab.header, tab.autoDetect),
        autoDetect: tab.autoDetect,
      })
      if (!check.ok) {
        setVerified(false)
        return
      }
      const roundTrip = normalizeDecode(check.data)
      const same =
        roundTrip.fields.length === tab.fields.length &&
        roundTrip.fields.every((field) => {
          const original = tab.fields.find((candidate) => candidate.id === field.id)
          return original !== undefined && original.value === field.value
        })
      setVerified(same)
    },
    [tab, tabId, legacyEngine, rows, bytes.length, pushUndo, update, addProblem, clearProblems],
  )

  const build = useCallback(async () => {
    const blocking = buildResolutionItems()
    if (blocking.length > 0) {
      setResolution(blocking)
      setBuildError(null)
      return
    }
    await runEncode({ allowBinaryPadding: false, allowNumericSanitize: false })
  }, [buildResolutionItems, runEncode])

  /* ── Raw pane callbacks ──────────────────────────────────────────────── */

  const setRaw = useCallback(
    (raw: string) => {
      if (!tabId) return
      update(tabId, { raw })
      setVerified(null)
    },
    [tabId, update],
  )

  const handleEncodingChange = useCallback(
    (inputHex: boolean, converted: string) => {
      if (!tabId) return
      pushUndo(`Encoding → ${inputHex ? 'Hex' : 'Text'}`)
      update(tabId, { inputHex, raw: converted })
      setEncodingLocked(true)
      setEncodingGuess(inputHex ? 'hex' : 'text')
    },
    [tabId, pushUndo, update],
  )

  const applyRaw = useCallback(
    (text: string, label: string) => {
      if (!tabId) return
      const guess = sniffEncoding(text)
      pushUndo(label)
      if (!encodingLocked) {
        setEncodingGuess(guess)
        update(tabId, { raw: text, inputHex: guess === 'hex' })
      } else {
        update(tabId, { raw: text })
      }
      // Immediate decode on paste or drop — the debounce is for typing only.
      requestDecode()
    },
    [tabId, encodingLocked, pushUndo, update, requestDecode],
  )

  const addLengthPrefix = useCallback(
    (prefixHex: string) => {
      if (!tab || !tabId) return
      pushUndo('Add length header')
      const combined = new Uint8Array([...hexToBytes(prefixHex), ...bytes])
      update(tabId, {
        raw: tab.inputHex ? bytesToHex(combined) : bytesToText(combined),
        header: { enabled: true },
      })
      toast.success(`Prefixed a ${prefixHex.length / 2}-byte length header.`)
    },
    [tab, tabId, bytes, pushUndo, update],
  )

  /* ── Field callbacks ─────────────────────────────────────────────────── */

  const commitValue = useCallback(
    (fieldId: number, value: string) => {
      const row = rows.find((candidate) => candidate.id === fieldId)
      if (!row || row.value === value) return
      pushUndo(`F${fieldId} value`)
      patchField(fieldId, { value, invalid: undefined })
      setVerified(null)

      // The field's problems describe its previous value, so retract them
      // before re-validating. Otherwise fixing a value leaves the old error in
      // the drawer permanently and the error count never comes back down.
      clearFieldProblems(fieldId, 'Fields')

      if (isNumericType(row.type) && !row.hexMode && /\D/.test(value)) {
        addProblem({
          severity: 'error',
          source: 'Fields',
          message: `F${fieldId} is a numeric field but contains non-digits.`,
          fieldId,
        })
      }
    },
    [rows, pushUndo, patchField, addProblem, clearFieldProblems],
  )

  const toggleHex = useCallback(
    async (fieldId: number, next: boolean) => {
      const row = rows.find((candidate) => candidate.id === fieldId)
      if (!row) return
      if (isBinaryType(row.type)) {
        toast.info('Binary fields are always shown in hex.')
        return
      }
      if (row.value === '') {
        pushUndo(`F${fieldId} format`)
        patchField(fieldId, { hex: next })
        return
      }

      const result = next
        ? await tryCall<{ hex?: string }>('text.utf8ToHex', { text: row.value })
        : await tryCall<{ text?: string }>('text.hexToUtf8', { hex: normalizeHex(row.value) })

      clearFieldProblems(fieldId, 'Fields')

      if (!result.ok) {
        patchField(fieldId, { invalid: next ? result.error.message : 'Invalid hex input.' })
        addProblem({
          severity: 'error',
          source: 'Fields',
          message: `F${fieldId}: ${result.error.message}`,
          fieldId,
        })
        return
      }

      const converted = next
        ? (asString(asRecord(result.data)?.hex) ?? '')
        : (asString(asRecord(result.data)?.text) ?? '')

      pushUndo(`F${fieldId} format`)
      patchField(fieldId, { value: converted, hex: next, invalid: undefined })
    },
    [rows, pushUndo, patchField, addProblem],
  )

  const applyFieldFix = useCallback(
    (fieldId: number, fix: Parameters<typeof applyFix>[1]) => {
      const row = rows.find((candidate) => candidate.id === fieldId)
      if (!row || fix === null) return
      if (fix === 'toHex') {
        void toggleHex(fieldId, true)
        return
      }
      const next = applyFix(row.value, fix, row.hexMode, row.declaredLength)
      if (next === row.value) return
      pushUndo(`F${fieldId} fix`)
      patchField(fieldId, { value: next, invalid: undefined })
    },
    [rows, pushUndo, patchField, toggleHex],
  )

  const addField = useCallback(
    (fieldId: number) => {
      if (!tabId) return
      pushUndo(`Add F${fieldId}`)
      const created = addFieldToStore(tabId, fieldId)
      if (!created) {
        toast.info(`F${fieldId} is already present.`)
        return
      }
      const def = defsById.get(fieldId)
      if (def) {
        patchField(fieldId, {
          desc: def.name,
          type: def.type,
          length: def.length,
          variable: def.variable,
          hex: isBinaryType(def.type),
        })
      }
      setSelectedFieldId(fieldId)
    },
    [tabId, pushUndo, addFieldToStore, defsById, patchField],
  )

  const deleteField = useCallback(
    (fieldId: number) => {
      if (!tabId) return
      pushUndo(`Remove F${fieldId}`)
      // Removing a field never triggers an encode; the raw goes stale instead.
      removeField(tabId, fieldId)
      if (selectedFieldId === fieldId) setSelectedFieldId(null)
      toast.success(`Removed F${fieldId}. Undo with Ctrl+Z.`)
    },
    [tabId, pushUndo, removeField, selectedFieldId],
  )

  const resetToDefaults = useCallback(() => {
    if (!tabId) return
    pushUndo('Reset to packager defaults')
    const allowed = fieldDefs.length > 0 ? new Set(fieldDefs.map((def) => def.id)) : null
    const fields: FieldRow[] = DEFAULT_FIELD_SET.filter(
      (id) => allowed === null || allowed.has(id),
    ).map((id) => {
      const def = defsById.get(id)
      return {
        id,
        value: '',
        desc: def?.name,
        type: def?.type,
        length: def?.length,
        variable: def?.variable,
        hex: isBinaryType(def?.type),
      }
    })
    update(tabId, { fields })
    toast.success(`Reset to ${fields.length} packager defaults. Undo with Ctrl+Z.`)
  }, [tabId, fieldDefs, defsById, pushUndo, update])

  const clearAllFields = useCallback(() => {
    if (!tab || !tabId) return
    const count = tab.fields.length
    pushUndo('Clear all fields')
    update(tabId, { fields: [] })
    toast.success(`Cleared ${count} field${count === 1 ? '' : 's'}. Undo with Ctrl+Z.`)
  }, [tab, tabId, pushUndo, update])

  const exportFields = useMemo<ExportField[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        value: row.value,
        hex: row.hexMode,
        desc: row.desc,
        type: row.type,
        length: row.declaredLength,
      })),
    [rows],
  )

  /* ── File I/O ────────────────────────────────────────────────────────── */

  const nativeFiles = canUseNativeFiles()

  const bufferFileText = useCallback((): string => {
    if (!tab) return ''
    return encodeBufferFile({
      format: BUFFER_FILE_FORMAT,
      version: BUFFER_FILE_VERSION,
      name: tab.name,
      packager: tab.packager,
      raw: tab.raw,
      rawFormat: tab.inputHex ? 'hex' : 'text',
      header: { ...tab.header },
      autoDetect: tab.autoDetect,
      fields: tab.fields.map((field) => ({
        id: field.id,
        value: field.value,
        hex: field.hex ?? false,
      })),
    })
  }, [tab])

  const loadBufferPayload = useCallback(
    (name: string, text: string, path?: string) => {
      const { init, parsed } = bufferFileToTabInit(name, text)
      const created = newTab(init)
      if (path) filePaths.current.set(created, path)
      toast.success(parsed ? `Opened ${name}.` : `Opened ${name} as a raw capture.`)
    },
    [newTab],
  )

  const doOpen = useCallback(async () => {
    // A previous open/save failure describes a file this attempt replaces.
    clearProblems('Buffer')
    const result = await openBuffer()
    if (result.status === 'cancelled') return
    if (result.status === 'error') {
      toast.error(result.message)
      addProblem({ severity: 'error', source: 'Buffer', message: result.message })
      return
    }
    loadBufferPayload(result.file.name, result.file.text, result.file.path)
  }, [loadBufferPayload, addProblem, clearProblems])

  const doSave = useCallback(
    async (saveAs: boolean) => {
      if (!tab || !tabId) return
      const note = sensitiveFieldNote(tab.fields.map((field) => field.id))
      const suggested = tab.name.endsWith('.bxb') ? tab.name : `${tab.name}.bxb`
      const existing = saveAs ? undefined : filePaths.current.get(tabId)

      clearProblems('Buffer')
      const result = await saveBuffer(suggested, bufferFileText(), existing)
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        toast.error(result.message)
        addProblem({ severity: 'error', source: 'Buffer', message: result.message })
        return
      }
      if (result.path) filePaths.current.set(tabId, result.path)
      update(tabId, { dirty: false, name: result.path ? basename(result.path) : suggested })
      toast.success(
        result.downloaded
          ? `Downloaded ${suggested}. On the web, Save behaves as Save As.`
          : `Saved ${suggested}.`,
      )
      if (note) toast.info(note)
    },
    [tab, tabId, bufferFileText, update, addProblem],
  )

  const exportFieldsFile = useCallback(() => {
    if (!tab) return
    const name = `${tab.name.replace(/\.[^.]+$/, '')}-fields.json`
    const result = nativeFiles
      ? undefined
      : downloadText(name, fieldsToJson(exportFields))
    if (result && result.status === 'error') {
      toast.error(result.message)
      return
    }
    if (nativeFiles) {
      void saveBuffer(name, fieldsToJson(exportFields)).then((outcome) => {
        if (outcome.status === 'error') toast.error(outcome.message)
        else if (outcome.status === 'ok') toast.success(`Exported ${name}.`)
      })
      return
    }
    toast.success(`Exported ${name}.`)
  }, [tab, exportFields, nativeFiles])

  const importFieldsFile = useCallback(async () => {
    const result = await openBuffer()
    if (result.status !== 'ok') {
      if (result.status === 'error') toast.error(result.message)
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(result.file.text)
    } catch {
      toast.error('That file is not valid JSON.')
      return
    }
    const list = asArray(asRecord(parsed)?.fields ?? parsed)
    const fields: FieldRow[] = []
    for (const entry of list) {
      const item = asRecord(entry)
      if (!item) continue
      const id = asNumber(item.bit) ?? asNumber(item.id)
      if (id === undefined) continue
      fields.push({
        id,
        value: asString(item.value) ?? '',
        hex: asString(item.format) === 'hex' || asBoolean(item.hex) === true,
      })
    }
    if (fields.length === 0) {
      toast.error('No fields found in that file.')
      return
    }
    if (!tabId) return
    fields.sort((a, b) => a.id - b.id)
    pushUndo('Import fields')
    update(tabId, { fields })
    toast.success(`Imported ${fields.length} fields. Undo with Ctrl+Z.`)
  }, [tabId, pushUndo, update])

  /* ── Clipboard ───────────────────────────────────────────────────────── */

  const copyFormats = useMemo<CopyFormat[]>(
    () => [
      { id: 'raw', label: 'Copy raw', build: () => tab?.raw ?? '' },
      { id: 'hex', label: 'Copy as hex', build: () => bytesToHex(bytes) },
      { id: 'text', label: 'Copy as text', build: () => bytesToText(bytes) },
      { id: 'carray', label: 'Copy as byte array (C)', build: () => toCArray(bytes) },
      { id: 'dump', label: 'Copy dump (offsets and ASCII)', build: () => toHexDump(bytes) },
      { id: 'fields', label: 'Copy fields as JSON', build: () => fieldsToJson(exportFields) },
    ],
    [tab?.raw, bytes, exportFields],
  )

  const copyText = useCallback(async (text: string, what: string) => {
    const ok = await writeClipboard(text)
    if (ok) toast.success(`Copied ${what}.`)
    else toast.error('The clipboard is not available in this context.')
  }, [])

  /* ── Cross-tool hand-off (UX_SPEC 5.6) ───────────────────────────────── */

  const sendTo = useCallback(
    async (fieldId: number, target: SendTarget) => {
      const row = rows.find((candidate) => candidate.id === fieldId)
      if (!row) return
      setSelectedFieldId(fieldId)
      openTool(target)
      await writeClipboard(row.value)
      toast.info(
        `F${fieldId} copied to the clipboard. Use Load Field ${fieldId} in the ${target.toUpperCase()} tool, or paste it.`,
      )
      document.dispatchEvent(
        new CustomEvent('bufferx:send-to-tool', {
          detail: { tool: target, fieldId, value: row.value, hex: row.hexMode },
        }),
      )
    },
    [rows, openTool],
  )

  /* ── Undo / redo ─────────────────────────────────────────────────────── */

  const undo = useCallback(() => {
    const entry = undoStack.current[undoStack.current.length - 1]
    if (!entry) {
      toast.info('Nothing to undo.')
      return
    }
    const current = snapshot(entry.label)
    undoStack.current = undoStack.current.slice(0, -1)
    if (current) redoStack.current = [...redoStack.current, current].slice(-UNDO_DEPTH)
    applySnapshot(entry)
    toast.success(`Undid ${entry.label}.`)
  }, [snapshot, applySnapshot])

  const redo = useCallback(() => {
    const entry = redoStack.current[redoStack.current.length - 1]
    if (!entry) {
      toast.info('Nothing to redo.')
      return
    }
    const current = snapshot(entry.label)
    redoStack.current = redoStack.current.slice(0, -1)
    if (current) undoStack.current = [...undoStack.current, current].slice(-UNDO_DEPTH)
    applySnapshot(entry)
  }, [snapshot, applySnapshot])

  /* ── Splitter ────────────────────────────────────────────────────────── */

  const nudgeSplit = useCallback(
    (delta: number) => {
      let current = prefs.splitRatio
      try {
        const stored = window.localStorage.getItem('bx:split:buffer-workspace')
        const parsed = stored === null ? Number.NaN : Number.parseFloat(stored)
        if (Number.isFinite(parsed)) current = parsed
      } catch {
        // Fall back to the persisted preference.
      }
      const next = Math.max(12, Math.min(80, current + delta))
      setPrefs({ splitRatio: next })
      setSplitEpoch((epoch) => epoch + 1)
    },
    [prefs.splitRatio, setPrefs],
  )

  /* ── Shell commands ──────────────────────────────────────────────────── */

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (!detail || detail.region !== 'workspace') return
      if (detail.kind === 'primary') void decode()
      else void build()
    }

    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<ShellCommandDetail>).detail
      if (!detail) return
      const { command } = detail

      if (command.startsWith('jump-to-field:')) {
        const id = Number.parseInt(command.slice('jump-to-field:'.length), 10)
        if (Number.isFinite(id)) setSelectedFieldId(id)
        return
      }

      switch (command) {
        case 'cycle-raw-view':
          setPrefs({ rawView: nextRawView(prefs.rawView) })
          return
        case 'identify-packager':
          void identifyPackager()
          return
        case 'undo':
          undo()
          return
        case 'redo':
          redo()
          return
        case 'save-buffer':
          void doSave(false)
          return
        case 'save-buffer-as':
          void doSave(true)
          return
        case 'open-buffer':
          void doOpen()
          return
        case 'filter-fields':
          document.querySelector<HTMLInputElement>('input[aria-label^="Filter fields"]')?.focus()
          return
        case 'add-field':
          setAddFieldFocus(Date.now())
          return
        case 'toggle-field-hex': {
          if (selectedFieldId === null) {
            toast.info('Select a field row first.')
            return
          }
          const row = rows.find((candidate) => candidate.id === selectedFieldId)
          if (row) void toggleHex(row.id, !row.hexMode)
          return
        }
        case 'expand-value':
          if (selectedFieldId !== null) setSheetFieldId(selectedFieldId)
          return
        case 'splitter-up':
          nudgeSplit(-5)
          return
        case 'splitter-down':
          nudgeSplit(5)
          return
        case 'copy-focused-value': {
          const row = rows.find((candidate) => candidate.id === selectedFieldId)
          void copyText(row ? row.value : (tab?.raw ?? ''), row ? `F${row.id}` : 'the raw buffer')
          return
        }
        default:
      }
    }

    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    document.addEventListener(SHELL_COMMAND_EVENT, onCommand)
    return () => {
      document.removeEventListener(SHELL_ACTION_EVENT, onAction)
      document.removeEventListener(SHELL_COMMAND_EVENT, onCommand)
    }
  }, [
    decode,
    build,
    identifyPackager,
    undo,
    redo,
    doSave,
    doOpen,
    prefs.rawView,
    setPrefs,
    selectedFieldId,
    rows,
    toggleHex,
    nudgeSplit,
    copyText,
    tab?.raw,
  ])

  /* ── Paste anywhere, drop anywhere (UX_SPEC 2.1) ─────────────────────── */

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return
      event.preventDefault()
      applyRaw(text, 'Paste')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [applyRaw])

  const onDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file) {
        const result = await readFile(file)
        if (result.status === 'ok') loadBufferPayload(result.file.name, result.file.text)
        else if (result.status === 'error') toast.error(result.message)
        return
      }
      const text = event.dataTransfer?.getData('text/plain')
      if (text) applyRaw(text, 'Drop')
    },
    [applyRaw, loadBufferPayload],
  )

  /* ── Status strip ────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!tab) return
    const detail = regionMap.unmapped.length > 0
      ? `${regionMap.unmapped.length} field${regionMap.unmapped.length === 1 ? '' : 's'} unmapped`
      : regionMap.trailing > 0
        ? `${regionMap.trailing} bytes unparsed`
        : undefined
    setShellStatus({
      scope: 'Fields',
      caret: { line: 1, col: 1, pos: 0, sel: selectedFieldId === null ? 0 : 1 },
      ...(detail ? { detail } : { detail: undefined }),
    })
  }, [tab, regionMap, selectedFieldId])

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (!tab) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-panel">
        <EmptyState
          title="No buffer is open."
          description="Buffers are documents. Open one, or start a new tab."
          action={
            <Button size="md" variant="primary" onClick={() => newTab()}>
              New buffer
            </Button>
          }
          hint="Alt+N"
        />
      </div>
    )
  }

  const isEmpty = tab.raw.trim() === '' && tab.fields.length === 0
  const sheetRow = sheetFieldId === null ? null : rows.find((row) => row.id === sheetFieldId)

  const packagerBar = (
    <div className="flex shrink-0 flex-wrap items-center gap-field border-b border-border bg-surface-1 px-panel py-1">
      <span className="text-2xs tracking-wide text-text-tertiary uppercase">Packager</span>
      <PackagerPicker
        value={tab.packager}
        packagers={packagers ?? []}
        loading={packagers === null}
        error={packagerError}
        source={packagerSource}
        canBrowse={hostCapabilities().files}
        onSelect={(name) => {
          if (name === tab.packager) return
          pushUndo(`Packager → ${name}`)
          update(tab.id, { packager: name })
        }}
        onReload={() => {
          setPackagers(null)
          void loadPackagers()
          toast.success('Reloaded the packager definitions.')
        }}
        onBrowse={async () => {
          const result = await openBuffer()
          if (result.status !== 'ok') {
            if (result.status === 'error') toast.error(result.message)
            return
          }
          const loaded = await tryCall('packager.loadXml', { xml: result.file.text })
          if (!loaded.ok) {
            toast.error(loaded.error.message)
            addProblem({ severity: 'error', source: 'Packager', message: loaded.error.message })
            return
          }
          setPackagerSource(result.file.path ?? result.file.name)
          setPackagers(normalizePackagerList(loaded.data))
          toast.success(`Loaded packagers from ${result.file.name}.`)
        }}
      />

      <Tooltip content="Try every loaded packager against this buffer and rank them by fit (Ctrl+Shift+D).">
        <span>
          <Button
            size="xs"
            icon={Sparkles}
            onClick={() => void identifyPackager()}
            disabled={bytes.length === 0}
          >
            Identify
          </Button>
        </span>
      </Tooltip>

      {fieldsStale ? (
        <Badge tone="warn" dot>
          Fields are stale · raw edited
        </Badge>
      ) : null}
      {fieldsStale ? (
        <Button size="xs" variant="primary" onClick={() => void decode()}>
          Decode
        </Button>
      ) : null}

      {!nativeFiles ? (
        <Tooltip content={capabilityHint('files')}>
          <span className="ml-auto">
            <Badge tone="info">Save downloads a file</Badge>
          </span>
        </Tooltip>
      ) : null}
    </div>
  )

  if (isEmpty) {
    return (
      <div
        ref={rootRef}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {packagerBar}
        <div
          className={cn(
            'flex min-h-0 flex-1 items-center justify-center p-panel',
            dragging && 'bg-accent-muted',
          )}
        >
          <div className="flex max-w-xl flex-col items-center gap-group rounded-md border border-dashed border-border-strong p-8 text-center">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl text-text">Paste an ISO 8583 buffer</h2>
              <p className="text-base text-text-secondary">
                <Kbd>Ctrl+V</Kbd> anywhere, or drop a <span className="font-mono text-mono-sm">.bxb</span>{' '}
                / <span className="font-mono text-mono-sm">.hex</span> file.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-field">
              <Button
                size="md"
                variant="primary"
                icon={ClipboardPaste}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText()
                    if (text.trim() === '') {
                      toast.info('The clipboard is empty.')
                      return
                    }
                    applyRaw(text, 'Paste from clipboard')
                  } catch {
                    toast.error('The browser blocked clipboard access. Press Ctrl+V instead.')
                  }
                }}
              >
                Paste from clipboard
              </Button>
              <Button size="md" icon={FileUp} onClick={() => void doOpen()}>
                Open file…
              </Button>
            </div>

            <div className="flex flex-col items-center gap-field">
              <p className="text-sm text-text-tertiary">Or start from a template:</p>
              <ul className="flex flex-wrap items-center justify-center gap-field">
                {TEMPLATES.map((template) => (
                  <li key={template.id}>
                    <Tooltip content={template.description}>
                      <span>
                        <Button
                          size="sm"
                          onClick={() => {
                            pushUndo(`Template ${template.label}`)
                            update(tab.id, {
                              fields: template.fields.map((field) => {
                                const def = defsById.get(field.id)
                                return {
                                  id: field.id,
                                  value: field.value,
                                  desc: def?.name,
                                  type: def?.type,
                                  length: def?.length,
                                  variable: def?.variable,
                                  hex: isBinaryType(def?.type),
                                }
                              }),
                            })
                            toast.success(`${template.label} loaded. Build to produce the raw buffer.`)
                          }}
                        >
                          {template.label}
                        </Button>
                      </span>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        dragging && 'inset-ring-2 inset-ring-accent',
      )}
    >
      {packagerBar}

      <SplitPane
        key={splitEpoch}
        orientation="horizontal"
        initial={prefs.splitRatio}
        min={12}
        max={80}
        storageKey="buffer-workspace"
        className="min-h-0 flex-1"
        aria-label="Raw and fields splitter"
      >
        <RawPane
          raw={tab.raw}
          inputHex={tab.inputHex}
          bytes={bytes}
          regions={regionMap.regions}
          highlights={highlights}
          bufferName={tab.name}
          view={prefs.rawView}
          onViewChange={(view) => setPrefs({ rawView: view })}
          encodingGuess={encodingGuess}
          encodingLocked={encodingLocked}
          autoDecode={prefs.autoDecode}
          onAutoDecodeChange={(value) => setPrefs({ autoDecode: value })}
          follow={prefs.follow}
          onFollowChange={(value) => setPrefs({ follow: value })}
          decoding={decoding}
          building={building}
          verified={verified}
          rawStale={rawStale}
          onRawChange={setRaw}
          onEncodingChange={handleEncodingChange}
          onDecode={() => void decode()}
          onBuild={() => void build()}
          header={tab.header}
          autoDetect={tab.autoDetect}
          headerLocked={prefs.headerSizeLocked}
          headerOrigin={headerOrigin}
          detectedFlash={detectedFlash}
          onHeaderChange={(patch) => {
            update(tab.id, { header: patch })
            if (patch.size !== undefined) setHeaderOrigin(`${patch.size} · manual`)
          }}
          onAutoDetectChange={(value) => update(tab.id, { autoDetect: value })}
          onHeaderLockChange={(value) => setPrefs({ headerSizeLocked: value })}
          onAddLength={addLengthPrefix}
          selectedFieldId={selectedFieldId}
          hoveredFieldId={hoveredFieldId}
          onHoverRegion={(region: Region | null) =>
            setHoveredFieldId(region?.fieldId ?? null)
          }
          onSelectRegion={(region: Region) => {
            if (region.fieldId !== undefined) setSelectedFieldId(region.fieldId)
          }}
          onSelectBytes={(range) => {
            if (!range) return
            setShellStatus({
              scope: 'Bytes',
              caret: { line: 1, col: range.start + 1, pos: range.start, sel: range.end - range.start },
              detail: spanningFields(regionMap.regions, range),
            })
          }}
          copyFormats={copyFormats}
          error={decodeError}
          onDismissError={() => setDecodeError(null)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
          {candidates !== null || sweep !== null ? (
            <div className="px-panel pt-panel">
              <PackagerCandidates
                current={tab.packager}
                candidates={candidates ?? []}
                progress={sweep}
                onUse={(name) => {
                  pushUndo(`Packager → ${name}`)
                  update(tab.id, { packager: name })
                  setCandidates(null)
                  requestDecode()
                }}
                onIdentifyAgain={() => void identifyPackager()}
                onCancel={() => {
                  sweepCancelled.current = true
                }}
                onDismiss={() => {
                  sweepCancelled.current = true
                  setCandidates(null)
                  setSweep(null)
                }}
              />
            </div>
          ) : null}

          {resolution.length > 0 ? (
            <div className="px-panel pt-panel">
              <ResolutionCard
                items={resolution}
                onApply={(item) => {
                  pushUndo(`Fix F${item.fieldId}`)
                  patchField(item.fieldId, { value: item.after, invalid: undefined })
                  setResolution((current) =>
                    current.filter((entry) => entry.fieldId !== item.fieldId),
                  )
                }}
                onApplyAll={() => {
                  pushUndo('Apply all suggested fixes')
                  patchFields((fields) =>
                    fields.map((field) => {
                      const item = resolution.find((entry) => entry.fieldId === field.id)
                      return item ? { ...field, value: item.after, invalid: undefined } : field
                    }),
                  )
                  setResolution([])
                }}
                onEdit={(fieldId) => {
                  setSelectedFieldId(fieldId)
                  setSheetFieldId(fieldId)
                }}
                onSkip={(fieldId) =>
                  setResolution((current) => current.filter((entry) => entry.fieldId !== fieldId))
                }
                onBuildAnyway={() => {
                  setResolution([])
                  void runEncode({ allowBinaryPadding: true, allowNumericSanitize: true })
                }}
                onDismiss={() => setResolution([])}
              />
            </div>
          ) : null}

          {buildError ? (
            <div className="px-panel pt-panel">
              <InlineAlert
                tone="error"
                title="Build failed"
                onDismiss={() => setBuildError(null)}
                action={
                  <Button size="xs" onClick={() => void build()}>
                    Try again
                  </Button>
                }
              >
                {buildError}
              </InlineAlert>
            </div>
          ) : null}

          <FieldTable
            rows={rows}
            fieldDefs={fieldDefs}
            bufferName={tab.name}
            packagerName={tab.packager}
            decoded={tab.decoded}
            decoding={decoding}
            filter={filterText}
            onFilterChange={setFilterText}
            presentOnly={prefs.presentOnly}
            onPresentOnlyChange={(value) => setPrefs({ presentOnly: value })}
            errorsOnly={prefs.errorsOnly}
            onErrorsOnlyChange={(value) => setPrefs({ errorsOnly: value })}
            showOffsetColumn={prefs.showOffsetColumn}
            showTypeColumn={prefs.showTypeColumn}
            showLenColumn={prefs.showLenColumn}
            showFmtColumn={prefs.showFmtColumn}
            onColumnChange={(column, value) => {
              if (column === 'offset') setPrefs({ showOffsetColumn: value })
              else if (column === 'type') setPrefs({ showTypeColumn: value })
              else if (column === 'len') setPrefs({ showLenColumn: value })
              else setPrefs({ showFmtColumn: value })
            }}
            density={density}
            onDensityChange={setDensity}
            selectedId={selectedFieldId}
            onSelect={setSelectedFieldId}
            onHover={setHoveredFieldId}
            onValueCommit={commitValue}
            onToggleHex={(id, next) => void toggleHex(id, next)}
            onAddField={addField}
            onRemoveField={deleteField}
            onClearValue={(id) => commitValue(id, '')}
            onApplyFix={applyFieldFix}
            onExpand={(id) => setSheetFieldId(id)}
            onShowBytes={(id) => {
              setPrefs({ rawView: 'bytes' })
              setSelectedFieldId(id)
            }}
            onSendTo={(id, target) => void sendTo(id, target)}
            onDecode={() => void decode()}
            onReset={resetToDefaults}
            onClearAll={clearAllFields}
            onSortByBit={() =>
              patchFields((fields) => [...fields].sort((a, b) => a.id - b.id))
            }
            onCopyJson={() => void copyText(fieldsToJson(exportFields), 'all fields as JSON')}
            onCopyTsv={() => void copyText(fieldsToTsv(exportFields), 'all fields as TSV')}
            onExport={exportFieldsFile}
            onImport={() => void importFieldsFile()}
            onIdentifyPackager={() => void identifyPackager()}
            focusRequest={addFieldFocus}
          />
        </div>
      </SplitPane>

      {sheetRow ? (
        <ValueSheet
          open={sheetFieldId !== null}
          onOpenChange={(open) => {
            if (!open) setSheetFieldId(null)
          }}
          fieldId={sheetRow.id}
          desc={sheetRow.desc}
          type={sheetRow.type}
          value={sheetRow.value}
          hexMode={sheetRow.hexMode}
          onValueChange={(value) => commitValue(sheetRow.id, value)}
          onToggleHex={(next) => void toggleHex(sheetRow.id, next)}
          onOpenInTlv={(payload) => {
            openTool('tlv')
            void writeClipboard(payload)
            toast.info(`F${sheetRow.id} copied. Use Load Field ${sheetRow.id} in the TLV tool.`)
          }}
        />
      ) : null}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────────────── */

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

/** `spans F35, F37` for the status strip's selection readout (UX_SPEC 2.3). */
function spanningFields(
  regions: readonly Region[],
  range: { start: number; end: number },
): string {
  const ids = regions
    .filter(
      (region) =>
        region.fieldId !== undefined && region.start < range.end && region.end > range.start,
    )
    .map((region) => `F${region.fieldId}`)
  const size = range.end - range.start
  return ids.length > 0
    ? `Sel ${size} bytes · spans ${ids.join(', ')}`
    : `Sel ${size} bytes`
}
