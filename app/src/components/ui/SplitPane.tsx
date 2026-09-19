import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'

export interface SplitPaneProps {
  /**
   * `vertical` = vertical divider, panes side by side (left | right).
   * `horizontal` = horizontal divider, panes stacked (top / bottom).
   */
  orientation?: 'vertical' | 'horizontal'
  /** Size of the first pane, in percent of the container. */
  initial?: number
  min?: number
  max?: number
  /**
   * Persists the ratio under `bx:split:<storageKey>`.
   *
   * The stored value is a single clamped number and nothing else — no buffer
   * content, no field values, no secrets. Anything unparseable is discarded.
   */
  storageKey?: string
  /** Re-layout continuously while dragging instead of on pointer-up. */
  live?: boolean
  children: [ReactNode, ReactNode]
  className?: string
  'aria-label'?: string
}

const KEY_STEP_PX = 16
const KEY_STEP_LARGE_PX = 64

function storageId(key: string): string {
  return `bx:split:${key}`
}

function readStored(key: string | undefined, min: number, max: number): number | null {
  if (!key) return null
  try {
    const raw = window.localStorage.getItem(storageId(key))
    if (raw === null) return null
    const parsed = Number.parseFloat(raw)
    if (!Number.isFinite(parsed)) return null
    return Math.min(max, Math.max(min, parsed))
  } catch {
    return null
  }
}

function writeStored(key: string | undefined, value: number): void {
  if (!key) return
  try {
    window.localStorage.setItem(storageId(key), String(Math.round(value * 100) / 100))
  } catch {
    // Private mode / quota. A lost layout preference is not worth an error.
  }
}

/**
 * DESIGN_SYSTEM.md §4.21.
 *
 * 1px divider with an 8px transparent hit area; hover strengthens it, drag
 * turns it accent and paints a live guideline. Keyboard-resizable via
 * `role="separator"` with arrows, `Shift+arrow`, and `Home`/`End`.
 */
export function SplitPane({
  orientation = 'vertical',
  initial = 30,
  min = 15,
  max = 85,
  storageKey,
  live = false,
  children,
  className,
  ...aria
}: SplitPaneProps) {
  const horizontal = orientation === 'vertical' // divider is vertical ⇒ flex-row
  const containerRef = useRef<HTMLDivElement | null>(null)

  const [ratio, setRatio] = useState<number>(() => {
    const stored = readStored(storageKey, min, max)
    return stored ?? Math.min(max, Math.max(min, initial))
  })
  /** Non-null while dragging: the uncommitted ratio behind the guideline. */
  const [dragRatio, setDragRatio] = useState<number | null>(null)

  const [first, second] = children

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [min, max])

  const ratioFromEvent = useCallback(
    (clientX: number, clientY: number): number | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      const span = horizontal ? rect.width : rect.height
      if (span <= 0) return null
      const offset = horizontal ? clientX - rect.left : clientY - rect.top
      return clamp((offset / span) * 100)
    },
    [horizontal, clamp],
  )

  const commit = useCallback(
    (next: number) => {
      setRatio(next)
      writeStored(storageKey, next)
    },
    [storageKey],
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragRatio(ratio)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    const next = ratioFromEvent(event.clientX, event.clientY)
    if (next === null) return
    if (live) commit(next)
    setDragRatio(next)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRatio === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    commit(dragRatio)
    setDragRatio(null)
  }

  const stepPercent = useCallback(
    (px: number): number => {
      const rect = containerRef.current?.getBoundingClientRect()
      const span = rect ? (horizontal ? rect.width : rect.height) : 0
      if (span <= 0) return 1
      return (px / span) * 100
    },
    [horizontal],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const increase = horizontal ? 'ArrowRight' : 'ArrowDown'
    const step = stepPercent(event.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX)

    if (event.key === decrease) {
      event.preventDefault()
      commit(clamp(ratio - step))
    } else if (event.key === increase) {
      event.preventDefault()
      commit(clamp(ratio + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      commit(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      commit(max)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commit(clamp(initial))
    }
  }

  // Drop a stale guideline if the pointer is lost (window blur, context menu).
  useEffect(() => {
    if (dragRatio === null) return
    const cancel = () => setDragRatio(null)
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [dragRatio])

  const dragging = dragRatio !== null
  const guideRatio = dragRatio ?? ratio

  return (
    <div
      ref={containerRef}
      className={cn('relative flex min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', className)}
    >
      <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flexBasis: `${ratio}%`, flexGrow: 0, flexShrink: 0 }}>
        {first}
      </div>

      <div
        role="separator"
        tabIndex={0}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuenow={Math.round(ratio)}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-label={aria['aria-label'] ?? 'Resize panes'}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        onDoubleClick={() => commit(clamp(initial))}
        className={cn(
          'relative shrink-0 touch-none bg-border',
          'transition-colors duration-fast ease-standard motion-reduce:transition-none',
          horizontal
            ? 'w-px cursor-col-resize hover:bg-border-strong'
            : 'h-px cursor-row-resize hover:bg-border-strong',
          dragging && 'bg-accent',
        )}
      >
        {/* 8px transparent hit area, centred on the 1px rule. */}
        <span
          aria-hidden="true"
          className={cn('absolute', horizontal ? 'inset-y-0 -inset-x-1' : 'inset-x-0 -inset-y-1')}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>

      {/* Live 1px guideline. Only the guideline moves during a drag — the panes
          commit on pointer-up unless `live` is set (§4.21, §5.3). */}
      {dragging && !live && (
        <div
          aria-hidden="true"
          className={cn('pointer-events-none absolute z-20 bg-accent', horizontal ? 'w-px' : 'h-px')}
          style={
            horizontal
              ? { left: `${guideRatio}%`, top: 0, bottom: 0 }
              : { top: `${guideRatio}%`, left: 0, right: 0 }
          }
        />
      )}
    </div>
  )
}
