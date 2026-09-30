/** Stable panel host: changing workspaces or split mode never remounts a tool. */
import { Suspense, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Skeleton } from '@/components/ui/Skeleton'
import { hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers } from '@/store/buffers'
import { useTools } from '@/store/tools'
import { getTool, type ToolDefinition } from '@/tools/registry'
import { PanelErrorBoundary } from './ErrorBoundary'
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH } from './layout'

const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 64

export interface ToolDockProps {
  width: number
  split: boolean
  onWidthChange(width: number): void
}

export function ToolDock({ width, split, onWidthChange }: ToolDockProps) {
  const open = useTools((state) => state.open)
  const active = useTools((state) => state.promoted)
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const bufferName = tabs.find((tab) => tab.id === activeId)?.name
  const tools = open.map(getTool).filter((tool): tool is ToolDefinition => tool !== undefined)
  return (
    <aside aria-label="Tool workspace" style={split ? { width } : undefined}
      className={cn('relative flex h-full min-h-0 min-w-0 flex-col bg-surface-1', split ? 'shrink-0 border-l border-border' : 'flex-1')}>
      {split && <DockResizer width={width} onWidthChange={onWidthChange} />}
      {tools.map((tool) => {
        const gated = tool.requires && !hostCapabilities()[tool.requires]
        return (
          <section key={tool.id} id={`workspace-${tool.id}`} role="tabpanel" aria-labelledby={`workspace-tab-${tool.id}`}
            hidden={active !== tool.id} data-tool-id={tool.id}
            className={cn('@container min-h-0 min-w-0 flex-1 flex-col', active === tool.id ? 'flex' : 'hidden')}>
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border-subtle px-3 text-text-secondary">
              <tool.icon size={14} aria-hidden="true" />
              <span className="text-sm font-medium text-text">{tool.title}</span>
              <span className="ml-auto truncate text-2xs">Buffer: <span className="font-mono">{bufferName ?? 'None'}</span></span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {gated && tool.requires && <div className="p-panel pb-0"><InlineAlert tone="info" title={`${tool.title} is limited in this host`}>{capabilityHint(tool.requires)}</InlineAlert></div>}
              <PanelErrorBoundary title={tool.title}><Suspense fallback={<PanelSkeleton />}><tool.Panel /></Suspense></PanelErrorBoundary>
            </div>
          </section>
        )
      })}
    </aside>
  )
}

/** Shape-matching placeholder so a lazily loaded panel does not shift layout. */
export function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-group p-panel" aria-hidden="true">
      <Skeleton height={14} width="35%" />
      <Skeleton height={26} />
      <Skeleton height={26} />
      <Skeleton height={14} width="25%" />
      <Skeleton height={26} />
      <Skeleton height={64} />
    </div>
  )
}

/* ── Resizer ─────────────────────────────────────────────────────────────── */

function clampWidth(value: number): number {
  return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, Math.round(value)))
}

/**
 * 1px divider with an 8px hit area. Dragging left widens the dock, because the
 * divider is on its left edge. Keyboard-resizable per WAI-ARIA `separator`.
 */
function DockResizer({ width, onWidthChange }: { width: number; onWidthChange(width: number): void }) {
  const dragging = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const [active, setActive] = useState(false)

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      dragging.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
      setActive(true)
    },
    [width],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragging.current
      if (!state || state.pointerId !== event.pointerId) return
      onWidthChange(clampWidth(state.startWidth - (event.clientX - state.startX)))
    },
    [onWidthChange],
  )

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId !== event.pointerId) return
    dragging.current = null
    setActive(false)
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the tool dock"
      aria-valuenow={width}
      aria-valuemin={DOCK_MIN_WIDTH}
      aria-valuemax={DOCK_MAX_WIDTH}
      aria-valuetext={`${width} pixels`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={(event) => {
        const step = event.shiftKey ? RESIZE_STEP_LARGE : RESIZE_STEP
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onWidthChange(clampWidth(width + step))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onWidthChange(clampWidth(width - step))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onWidthChange(DOCK_MAX_WIDTH)
        } else if (event.key === 'End') {
          event.preventDefault()
          onWidthChange(DOCK_MIN_WIDTH)
        }
      }}
      className={cn(
        'absolute inset-y-0 left-0 z-10 w-2 -translate-x-1 cursor-col-resize',
        'after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent',
        'hover:after:bg-border-strong',
        active && 'after:bg-accent',
      )}
    />
  )
}
