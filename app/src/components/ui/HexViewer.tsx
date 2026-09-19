import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { cn } from '@/lib/cn'

export interface HexHighlight {
  /** First byte of the run. */
  start: number
  /** One past the last byte of the run — `bytes[start .. end - 1]`. */
  end: number
  /** 0-based palette index; wraps modulo 8 onto `hl-1 … hl-8`. */
  colorIndex: number
  /** Field id or region name, shown in the FIELD ribbon and the byte tooltip. */
  label?: string
}

export interface ByteRange {
  start: number
  end: number
}

export interface HexViewerProps {
  bytes: Uint8Array
  highlights?: HexHighlight[]
  /** Fires with the run under the cursor, or null when the cursor leaves it. */
  onHoverRange?: (range: HexHighlight | null) => void
  /** Fires with the run that owns the clicked byte, or null for unmapped bytes. */
  onSelectRange?: (range: HexHighlight | null) => void
  /** Byte-level companion to `onHoverRange`. */
  onHoverByte?: (offset: number | null) => void
  /** Drag-selection, in bytes. `end` is exclusive. */
  onSelectBytes?: (selection: ByteRange | null) => void
  bytesPerRow?: number
  showAscii?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Palette classes are written out in full so Tailwind's source scanner sees
 * them; a template literal like `bg-hl-${n}-bg` would never be generated.
 */
const HL_BG = [
  'bg-hl-1-bg',
  'bg-hl-2-bg',
  'bg-hl-3-bg',
  'bg-hl-4-bg',
  'bg-hl-5-bg',
  'bg-hl-6-bg',
  'bg-hl-7-bg',
  'bg-hl-8-bg',
] as const

const HL_INK = [
  'text-hl-1',
  'text-hl-2',
  'text-hl-3',
  'text-hl-4',
  'text-hl-5',
  'text-hl-6',
  'text-hl-7',
  'text-hl-8',
] as const

const HL_BORDER = [
  'border-hl-1',
  'border-hl-2',
  'border-hl-3',
  'border-hl-4',
  'border-hl-5',
  'border-hl-6',
  'border-hl-7',
  'border-hl-8',
] as const

export function highlightSlot(colorIndex: number): number {
  return ((Math.trunc(colorIndex) % 8) + 8) % 8
}

const HEX = '0123456789ABCDEF'

function byteHex(value: number): string {
  return `${HEX[(value >> 4) & 0xf] ?? '0'}${HEX[value & 0xf] ?? '0'}`
}

function offsetHex(value: number, digits: number): string {
  let out = ''
  for (let shift = (digits - 1) * 4; shift >= 0; shift -= 4) out += HEX[(value >> shift) & 0xf] ?? '0'
  return out
}

function printable(value: number): boolean {
  return value >= 0x20 && value <= 0x7e
}

const DEFAULT_ROW_HEIGHT = 22
const OVERSCAN = 8

/** Row height comes from the mono line box, never from density (§3.5). */
function useMonoRowHeight(): number {
  const [height, setHeight] = useState(DEFAULT_ROW_HEIGHT)
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement)
    const raw = styles.getPropertyValue('--text-mono-base--line-height').trim()
    const rootSize = Number.parseFloat(styles.fontSize) || 16
    const value = Number.parseFloat(raw)
    const px = raw.endsWith('rem') ? value * rootSize : value
    if (Number.isFinite(px) && px > 0) setHeight(px)
  }, [])
  return height
}

/**
 * DESIGN_SYSTEM.md §4.13 — the centrepiece of the buffer workspace.
 *
 * Fixed-width offset gutter, 16 bytes per row split 8|8, an ASCII column, a
 * FIELD ribbon, and per-range colour coding from the `hl-1…8` tokens. Hovering
 * a byte reports its run so the field table can highlight the matching row —
 * that two-way link is the core diagnostic feature and is not optional.
 *
 * Rows are virtualized, so a multi-kilobyte buffer scrolls without jank. The
 * grid never animates and never smooth-scrolls (§5.3).
 */
export function HexViewer({
  bytes,
  highlights,
  onHoverRange,
  onSelectRange,
  onHoverByte,
  onSelectBytes,
  bytesPerRow = 16,
  showAscii = true,
  className,
  ...aria
}: HexViewerProps) {
  const rowHeight = useMonoRowHeight()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [cursor, setCursor] = useState(0)
  const [hovered, setHovered] = useState<number | null>(null)
  const [selection, setSelection] = useState<ByteRange | null>(null)
  const anchor = useRef<number | null>(null)

  const total = bytes.length
  const rowCount = Math.max(1, Math.ceil(total / bytesPerRow))
  const offsetDigits = total > 0xffff ? 8 : total > 0xff ? 4 : 4

  const runs = useMemo(() => highlights ?? [], [highlights])
  const hasLabels = runs.some((run) => run.label)

  /** Per-byte index into `runs`, or -1. Built once per decode. */
  const ownerOf = useMemo(() => {
    const map = new Int32Array(total).fill(-1)
    runs.forEach((run, index) => {
      const from = Math.max(0, Math.trunc(run.start))
      const to = Math.min(total, Math.max(from + 1, Math.trunc(run.end)))
      for (let offset = from; offset < to; offset += 1) map[offset] = index
    })
    return map
  }, [runs, total])

  const runAt = useCallback(
    (offset: number): HexHighlight | null => {
      if (offset < 0 || offset >= total) return null
      const index = ownerOf[offset]
      if (index === undefined || index < 0) return null
      return runs[index] ?? null
    },
    [ownerOf, runs, total],
  )

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  const setHover = useCallback(
    (offset: number | null) => {
      setHovered(offset)
      onHoverByte?.(offset)
      onHoverRange?.(offset === null ? null : runAt(offset))
    },
    [onHoverByte, onHoverRange, runAt],
  )

  const moveCursor = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next))
      setCursor(clamped)
      virtualizer.scrollToIndex(Math.floor(clamped / bytesPerRow), { align: 'auto' })
    },
    [total, bytesPerRow, virtualizer],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (total === 0) return
    const rowsPerPage = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 0) / rowHeight) - 1)
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        moveCursor(cursor + 1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        moveCursor(cursor - 1)
        return
      case 'ArrowDown':
        event.preventDefault()
        moveCursor(cursor + bytesPerRow)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveCursor(cursor - bytesPerRow)
        return
      case 'PageDown':
        event.preventDefault()
        moveCursor(cursor + bytesPerRow * rowsPerPage)
        return
      case 'PageUp':
        event.preventDefault()
        moveCursor(cursor - bytesPerRow * rowsPerPage)
        return
      case 'Home':
        event.preventDefault()
        moveCursor(event.ctrlKey ? 0 : cursor - (cursor % bytesPerRow))
        return
      case 'End':
        event.preventDefault()
        moveCursor(event.ctrlKey ? total - 1 : cursor - (cursor % bytesPerRow) + bytesPerRow - 1)
        return
      case 'Enter':
      case ' ': {
        event.preventDefault()
        const run = runAt(cursor)
        onSelectRange?.(run)
        const next = run ? { start: run.start, end: run.end } : { start: cursor, end: cursor + 1 }
        setSelection(next)
        onSelectBytes?.(next)
        return
      }
      default:
    }
  }

  const beginSelect = (event: PointerEvent<HTMLElement>, offset: number) => {
    if (event.button !== 0) return
    anchor.current = offset
    setCursor(offset)
    const next = { start: offset, end: offset + 1 }
    setSelection(next)
    onSelectBytes?.(next)
    onSelectRange?.(runAt(offset))
  }

  const extendSelect = (offset: number) => {
    const from = anchor.current
    if (from === null) return
    const next = { start: Math.min(from, offset), end: Math.max(from, offset) + 1 }
    setSelection(next)
    onSelectBytes?.(next)
  }

  useEffect(() => {
    const stop = () => {
      anchor.current = null
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [])

  // A new buffer invalidates every offset we were holding.
  useEffect(() => {
    setCursor(0)
    setSelection(null)
    setHovered(null)
  }, [bytes])

  const hoveredRun = hovered === null ? null : runAt(hovered)
  const columns = Array.from({ length: bytesPerRow }, (_, index) => index)

  const gutterStyle: CSSProperties = { width: `${offsetDigits + 1}ch` }
  const byteStyle: CSSProperties = { width: '2ch' }
  const asciiStyle: CSSProperties = { width: '1ch' }

  const renderRow = (rowIndex: number, style: CSSProperties) => {
    const base = rowIndex * bytesPerRow
    const runStartingHere = runs.find(
      (run) => run.label && run.start >= base && run.start < base + bytesPerRow,
    )

    return (
      <div
        key={rowIndex}
        role="row"
        aria-rowindex={rowIndex + 2}
        style={style}
        className="flex items-center whitespace-nowrap"
      >
        <span
          style={gutterStyle}
          className="shrink-0 border-r border-border-subtle pr-1 text-right text-mono-xs text-text-tertiary tabular-nums select-none"
        >
          {offsetHex(base, offsetDigits)}
        </span>

        <span className="flex shrink-0 items-center pl-2">
          {columns.map((column) => {
            const offset = base + column
            const present = offset < total
            const value = present ? (bytes[offset] ?? 0) : 0
            const run = present ? runAt(offset) : null
            const slot = run ? highlightSlot(run.colorIndex) : -1
            const isRunStart = run !== null && offset === run.start
            const isRunEnd = run !== null && offset === run.end - 1
            const inSelection =
              selection !== null && offset >= selection.start && offset < selection.end
            const isCursor = present && offset === cursor
            const isHovered = present && offset === hovered

            return (
              <span
                key={column}
                role="gridcell"
                aria-colindex={column + 1}
                data-offset={present ? offset : undefined}
                title={
                  present && run?.label
                    ? `${run.label} · byte ${offset - run.start + 1} of ${run.end - run.start} · 0x${offsetHex(offset, offsetDigits)}`
                    : present
                      ? `0x${offsetHex(offset, offsetDigits)}`
                      : undefined
                }
                onPointerDown={(event) => present && beginSelect(event, offset)}
                onPointerEnter={() => {
                  if (!present) return
                  setHover(offset)
                  extendSelect(offset)
                }}
                onPointerLeave={() => present && setHover(null)}
                style={{
                  ...byteStyle,
                  // 0.5ch between bytes, an extra 4px between the two 8-byte
                  // groups so the eye can count without a ruler.
                  marginRight: column === bytesPerRow - 1 ? 0 : column % 8 === 7 ? '1ch' : '0.5ch',
                }}
                className={cn(
                  'inline-block shrink-0 text-center text-mono-base tabular-nums select-none',
                  'border-x border-transparent',
                  present ? 'text-text-secondary' : 'text-transparent',
                  slot >= 0 && cn(HL_BG[slot], HL_INK[slot]),
                  slot >= 0 && isRunStart && cn('border-l', HL_BORDER[slot]),
                  slot >= 0 && isRunEnd && cn('border-r', HL_BORDER[slot]),
                  inSelection && 'bg-accent-muted text-text',
                  isHovered && 'text-text',
                  isCursor && 'inset-ring-1 inset-ring-accent',
                )}
              >
                {present ? byteHex(value) : '  '}
              </span>
            )
          })}
        </span>

        {showAscii && (
          <span className="flex shrink-0 items-center border-l border-border-subtle pr-2 pl-2">
            {columns.map((column) => {
              const offset = base + column
              const present = offset < total
              const value = present ? (bytes[offset] ?? 0) : 0
              const run = present ? runAt(offset) : null
              const slot = run ? highlightSlot(run.colorIndex) : -1
              const inSelection =
                selection !== null && offset >= selection.start && offset < selection.end

              return (
                <span
                  key={column}
                  aria-hidden="true"
                  data-offset={present ? offset : undefined}
                  onPointerEnter={() => present && setHover(offset)}
                  onPointerLeave={() => present && setHover(null)}
                  onPointerDown={(event) => present && beginSelect(event, offset)}
                  style={asciiStyle}
                  className={cn(
                    'inline-block shrink-0 text-center text-mono-base select-none',
                    !present && 'text-transparent',
                    present && (printable(value) ? 'text-text-secondary' : 'text-text-tertiary'),
                    slot >= 0 && cn(HL_BG[slot], HL_INK[slot]),
                    inSelection && 'bg-accent-muted text-text',
                  )}
                >
                  {present ? (printable(value) ? String.fromCharCode(value) : '·') : ' '}
                </span>
              )
            })}
          </span>
        )}

        {hasLabels && (
          <span className="flex min-w-0 shrink items-center gap-1 border-l border-border-subtle pl-2 text-mono-xs">
            {runStartingHere && (
              <span
                className={cn(
                  'truncate',
                  HL_INK[highlightSlot(runStartingHere.colorIndex)],
                )}
              >
                {`├ ${runStartingHere.label ?? ''}`}
              </span>
            )}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-inset',
        className,
      )}
    >
      {/* Column ruler — sticky, and it highlights the current byte's column. */}
      <div className="flex shrink-0 items-center border-b border-border-subtle bg-surface-inset px-0 py-0.5 whitespace-nowrap">
        <span
          style={gutterStyle}
          className="shrink-0 border-r border-border-subtle pr-1 text-right text-2xs text-text-tertiary select-none"
        >
          OFFSET
        </span>
        <span className="flex shrink-0 items-center pl-2">
          {columns.map((column) => (
            <span
              key={column}
              style={{
                ...byteStyle,
                marginRight: column === bytesPerRow - 1 ? 0 : column % 8 === 7 ? '1ch' : '0.5ch',
              }}
              className={cn(
                'inline-block shrink-0 text-center text-mono-xs tabular-nums select-none',
                total > 0 && cursor % bytesPerRow === column ? 'text-accent' : 'text-text-tertiary',
              )}
            >
              {byteHex(column)}
            </span>
          ))}
        </span>
        {showAscii && (
          <span
            className="shrink-0 border-l border-border-subtle pl-2 text-2xs text-text-tertiary select-none"
            style={{ width: `${bytesPerRow + 2}ch` }}
          >
            ASCII
          </span>
        )}
        {hasLabels && (
          <span className="shrink border-l border-border-subtle pl-2 text-2xs text-text-tertiary select-none">
            FIELD
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        role="grid"
        tabIndex={0}
        aria-label={aria['aria-label'] ?? 'Buffer bytes'}
        aria-rowcount={rowCount + 1}
        aria-colcount={bytesPerRow}
        onKeyDown={handleKeyDown}
        onPointerLeave={() => setHover(null)}
        className="min-h-0 flex-1 overflow-auto overscroll-contain px-2 py-1"
      >
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) =>
            renderRow(virtualRow.index, {
              position: 'absolute',
              top: 0,
              left: 0,
              height: rowHeight,
              transform: `translateY(${virtualRow.start}px)`,
            }),
          )}
        </div>
      </div>

      {/* Selection / cursor readout. Always visible, always mono (§4.13). */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border-subtle bg-surface-inset px-2 py-0.5 text-mono-xs text-text-tertiary tabular-nums">
        <span>{`${total} bytes`}</span>
        {total > 0 && (
          <span>{`cursor 0x${offsetHex(cursor, offsetDigits)} · ${bytes[cursor] ?? 0} · ${((bytes[cursor] ?? 0) >>> 0).toString(2).padStart(8, '0')}b`}</span>
        )}
        {selection && (
          <span>
            {`sel 0x${offsetHex(selection.start, offsetDigits)}–0x${offsetHex(Math.max(selection.start, selection.end - 1), offsetDigits)} · ${selection.end - selection.start} bytes`}
          </span>
        )}
        {hoveredRun?.label && (
          <span className={cn('ml-auto', HL_INK[highlightSlot(hoveredRun.colorIndex)])}>
            {hoveredRun.label}
          </span>
        )}
      </div>
    </div>
  )
}
