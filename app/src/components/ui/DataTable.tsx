import { useVirtualizer } from '@tanstack/react-virtual'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'

export interface DataTableColumn<Row> {
  key: string
  header: ReactNode
  /** px number, or any CSS grid track (`12ch`, `minmax(0,2fr)`). Omit for `1fr`. */
  width?: number | string
  align?: 'left' | 'right' | 'center'
  mono?: boolean
  editable?: boolean
  render?: (row: Row) => ReactNode
  /** Raw text for the inline editor. Defaults to `row[key]`. */
  getEditValue?: (row: Row) => string
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  getRowId: (row: Row) => string
  onCellCommit?: (rowId: string, columnKey: string, value: string) => void
  selectedId?: string
  onSelect?: (rowId: string) => void
  virtualized?: boolean
  emptyState?: ReactNode
  className?: string
  /** Announced by screen readers as the grid's name. */
  'aria-label'?: string
}

const ALIGN: Record<'left' | 'right' | 'center', string> = {
  left: 'justify-start text-left',
  right: 'justify-end text-right',
  center: 'justify-center text-center',
}

const DEFAULT_ROW_HEIGHT = 24
const OVERSCAN = 8
const PAGE_ROWS = 10

/** Reads `--bx-row-h` so the grid tracks the density attribute exactly. */
function useRowHeight(): number {
  const [height, setHeight] = useState(DEFAULT_ROW_HEIGHT)

  useLayoutEffect(() => {
    const read = () => {
      const root = document.documentElement
      const styles = getComputedStyle(root)
      const raw = styles.getPropertyValue('--bx-row-h').trim()
      const rootSize = Number.parseFloat(styles.fontSize) || 16
      const value = Number.parseFloat(raw)
      const px = raw.endsWith('rem') ? value * rootSize : value
      setHeight(Number.isFinite(px) && px > 0 ? px : DEFAULT_ROW_HEIGHT)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
    return () => observer.disconnect()
  }, [])

  return height
}

function track(width: number | string | undefined): string {
  if (width === undefined) return 'minmax(0, 1fr)'
  return typeof width === 'number' ? `${width}px` : width
}

function cellText<Row>(row: Row, key: string): string {
  const value = (row as Record<string, unknown>)[key]
  return value === null || value === undefined ? '' : String(value)
}

interface EditState {
  rowIndex: number
  colIndex: number
  draft: string
}

/**
 * DESIGN_SYSTEM.md §4.11 — the most important component in the app.
 *
 * Fixed row height, `overscan: 8`, absolutely positioned rows inside a spacer,
 * and `aria-rowcount`/`aria-rowindex` that reflect the *full* set rather than
 * the window. Rows never animate: no enter/exit, no reorder, no height
 * transition — scrolling 128 fields has to be frame-perfect.
 *
 * Inline editing follows the spec exactly: the cell *is* the editor. `Enter`
 * commits and moves down, `Tab` commits and moves to the next editable cell,
 * `Escape` reverts, blur commits. Committing a cell never rebuilds the buffer;
 * encode stays an explicit action.
 */
export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  onCellCommit,
  selectedId,
  onSelect,
  virtualized = true,
  emptyState,
  className,
  ...aria
}: DataTableProps<Row>) {
  const rowHeight = useRowHeight()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const [headerHeight, setHeaderHeight] = useState(0)
  const [focus, setFocus] = useState<{ rowIndex: number; colIndex: number } | null>(null)
  const [edit, setEdit] = useState<EditState | null>(null)
  /**
   * Removing the focused editor from the DOM fires a blur. Every explicit
   * commit/revert path raises this first so the blur handler cannot commit a
   * second time — or, worse, commit the cell we just moved to.
   */
  const suppressBlur = useRef(false)

  const gridTemplate = useMemo(() => columns.map((column) => track(column.width)).join(' '), [columns])
  const editableCols = useMemo(
    () => columns.map((column, index) => (column.editable ? index : -1)).filter((index) => index >= 0),
    [columns],
  )

  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderHeight(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
    // The sticky header sits inside the scroll container: shift measurements
    // past it, and keep scrollToIndex from parking a row underneath it.
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  })

  // Keep the keyboard cursor painted and on screen (§6.2 rule 6).
  useEffect(() => {
    if (!focus || edit) return
    if (virtualized) virtualizer.scrollToIndex(focus.rowIndex, { align: 'auto' })
    const frame = requestAnimationFrame(() => {
      bodyRef.current
        ?.querySelector<HTMLElement>(
          `[data-row-index="${focus.rowIndex}"][data-col-index="${focus.colIndex}"]`,
        )
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focus, edit, virtualized, virtualizer])

  const makeEdit = useCallback(
    (rowIndex: number, colIndex: number, seed?: string): EditState | null => {
      const column = columns[colIndex]
      const row = rows[rowIndex]
      if (!column?.editable || !row) return null
      const current = column.getEditValue ? column.getEditValue(row) : cellText(row, column.key)
      return { rowIndex, colIndex, draft: seed ?? current }
    },
    [columns, rows],
  )

  const releaseBlurGuard = useCallback(() => {
    suppressBlur.current = true
    requestAnimationFrame(() => {
      suppressBlur.current = false
    })
  }, [])

  const finishEdit = useCallback(
    (state: EditState, mode: 'commit' | 'revert', next: EditState | null) => {
      releaseBlurGuard()
      if (mode === 'commit') {
        const column = columns[state.colIndex]
        const row = rows[state.rowIndex]
        if (column && row) onCellCommit?.(getRowId(row), column.key, state.draft)
      }
      setEdit(next)
    },
    [columns, rows, onCellCommit, getRowId, releaseBlurGuard],
  )

  const nextEditableCell = useCallback(
    (
      rowIndex: number,
      colIndex: number,
      direction: 1 | -1,
    ): { rowIndex: number; colIndex: number } | null => {
      const position = editableCols.indexOf(colIndex)
      const target = position + direction
      const sameRow = editableCols[target]
      if (target >= 0 && target < editableCols.length && sameRow !== undefined) {
        return { rowIndex, colIndex: sameRow }
      }
      const nextRow = rowIndex + direction
      if (nextRow < 0 || nextRow >= rows.length) return null
      const wrapped = direction === 1 ? editableCols[0] : editableCols[editableCols.length - 1]
      if (wrapped === undefined) return null
      return { rowIndex: nextRow, colIndex: wrapped }
    },
    [editableCols, rows.length],
  )

  const moveFocus = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (rows.length === 0 || columns.length === 0) return
      setFocus({
        rowIndex: Math.max(0, Math.min(rows.length - 1, rowIndex)),
        colIndex: Math.max(0, Math.min(columns.length - 1, colIndex)),
      })
    },
    [rows.length, columns.length],
  )

  const handleCellKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    rowIndex: number,
    colIndex: number,
  ) => {
    const openEditor = (seed?: string) => {
      const next = makeEdit(rowIndex, colIndex, seed)
      if (next) setEdit(next)
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(rowIndex + 1, colIndex)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(rowIndex - 1, colIndex)
        return
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(rowIndex, colIndex + 1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(rowIndex, colIndex - 1)
        return
      case 'Home':
        event.preventDefault()
        moveFocus(event.ctrlKey ? 0 : rowIndex, 0)
        return
      case 'End':
        event.preventDefault()
        moveFocus(event.ctrlKey ? rows.length - 1 : rowIndex, columns.length - 1)
        return
      case 'PageDown':
        event.preventDefault()
        moveFocus(rowIndex + PAGE_ROWS, colIndex)
        return
      case 'PageUp':
        event.preventDefault()
        moveFocus(rowIndex - PAGE_ROWS, colIndex)
        return
      case 'Enter':
      case 'F2':
        if (columns[colIndex]?.editable) {
          event.preventDefault()
          openEditor()
        }
        return
      case ' ': {
        const row = rows[rowIndex]
        if (row && onSelect) {
          event.preventDefault()
          onSelect(getRowId(row))
        }
        return
      }
      default:
        // Typing a printable character opens the editor seeded with it.
        if (
          columns[colIndex]?.editable &&
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault()
          openEditor(event.key)
        }
    }
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLInputElement>, state: EditState) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      finishEdit(state, 'revert', null)
      moveFocus(state.rowIndex, state.colIndex)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      finishEdit(state, 'commit', null)
      moveFocus(state.rowIndex + 1, state.colIndex)
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = nextEditableCell(state.rowIndex, state.colIndex, event.shiftKey ? -1 : 1)
      const next = target ? makeEdit(target.rowIndex, target.colIndex) : null
      finishEdit(state, 'commit', next)
      if (!next) moveFocus(state.rowIndex, state.colIndex)
    }
  }

  const renderRow = (rowIndex: number, style: CSSProperties) => {
    const row = rows[rowIndex]
    if (!row) return null
    const rowId = getRowId(row)
    const selected = selectedId !== undefined && selectedId === rowId

    return (
      <div
        key={rowId}
        role="row"
        aria-rowindex={rowIndex + 2}
        aria-selected={selected || undefined}
        data-row-id={rowId}
        style={style}
        onClick={() => onSelect?.(rowId)}
        className={cn('grid items-stretch', selected ? 'bg-accent-muted' : 'hover:bg-surface-raised')}
      >
        {columns.map((column, colIndex) => {
          const editing = edit !== null && edit.rowIndex === rowIndex && edit.colIndex === colIndex
          const focused = focus?.rowIndex === rowIndex && focus.colIndex === colIndex

          return (
            <div
              key={column.key}
              role="gridcell"
              aria-colindex={colIndex + 1}
              data-row-index={rowIndex}
              data-col-index={colIndex}
              tabIndex={focused ? 0 : -1}
              onFocus={() => setFocus({ rowIndex, colIndex })}
              onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex)}
              onDoubleClick={() => {
                const next = makeEdit(rowIndex, colIndex)
                if (next) setEdit(next)
              }}
              className={cn(
                'flex min-w-0 items-center overflow-hidden border-b border-border-subtle',
                'scroll-mx-2 scroll-my-2 px-cell-x py-cell-y text-xs text-text',
                column.mono && 'font-mono text-mono-sm tabular-nums',
                ALIGN[column.align ?? 'left'],
                // 2px accent left stripe on the selected row (§4.11). The
                // transparent twin keeps every row the same width.
                colIndex === 0 && (selected ? 'border-l-2 border-l-accent' : 'border-l-2 border-l-transparent'),
              )}
            >
              {editing && edit ? (
                <input
                  autoFocus
                  value={edit.draft}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setEdit({ ...edit, draft: event.target.value })}
                  onKeyDown={(event) => handleEditorKeyDown(event, edit)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={() => {
                    if (suppressBlur.current) return
                    finishEdit(edit, 'commit', null)
                  }}
                  className={cn(
                    'h-control-xs w-full min-w-0 rounded-xs bg-surface-2 px-1 text-text outline-none',
                    'inset-ring-1 inset-ring-accent',
                    column.mono ? 'font-mono text-mono-sm' : 'text-xs',
                  )}
                />
              ) : column.render ? (
                column.render(row)
              ) : (
                <span className="truncate">{cellText(row, column.key)}</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-surface-1',
        className,
      )}
    >
      <div
        ref={scrollRef}
        role="grid"
        aria-label={aria['aria-label']}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length}
        className="min-h-0 flex-1 overflow-auto overscroll-contain"
      >
        <div
          ref={headerRef}
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-10 grid border-b border-border bg-surface-2"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((column, colIndex) => (
            <div
              key={column.key}
              role="columnheader"
              aria-colindex={colIndex + 1}
              className={cn(
                'flex h-row min-w-0 items-center overflow-hidden px-cell-x py-cell-y',
                'text-2xs font-medium tracking-wide text-text-secondary uppercase',
                ALIGN[column.align ?? 'left'],
                colIndex === 0 && 'border-l-2 border-l-transparent',
              )}
            >
              <span className="truncate">{column.header}</span>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            {emptyState ?? <p className="text-sm text-text-tertiary">No rows.</p>}
          </div>
        ) : virtualized ? (
          <div ref={bodyRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) =>
              renderRow(virtualRow.index, {
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: rowHeight,
                gridTemplateColumns: gridTemplate,
                transform: `translateY(${virtualRow.start - headerHeight}px)`,
              }),
            )}
          </div>
        ) : (
          <div ref={bodyRef} className="w-full">
            {rows.map((_, rowIndex) =>
              renderRow(rowIndex, { height: rowHeight, gridTemplateColumns: gridTemplate }),
            )}
          </div>
        )}
      </div>
    </div>
  )
}
