/**
 * The tool dock (UX_SPEC 1.1, 1.5, 3.0).
 *
 * A right-hand column, 380–640px, holding a vertical accordion of open tools.
 * Its defining property is what it does *not* do: opening a tool never closes
 * another and never occludes the workspace, so an operator can read the field
 * table while running MAC and PIN at once (tenet 1).
 *
 * The dock supplies the frame — title, buffer scope, collapse, promote, close —
 * and nothing else. A panel renders only its own body (the tool-panel contract),
 * so muscle memory transfers between tools and no tool can invent its own
 * chrome.
 *
 * At `medium` and `compact` widths the column becomes an overlay sheet over the
 * right edge of the workspace, dismissed with `Esc` (UX_SPEC 1.5).
 */

import { Suspense, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, Maximize2, X } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Skeleton } from '@/components/ui/Skeleton'
import { hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers } from '@/store/buffers'
import { useTools } from '@/store/tools'
import { getTool, type ToolDefinition } from '@/tools/registry'
import { PanelErrorBoundary } from './ErrorBoundary'
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, dockIsOverlay, useLayout } from './layout'
import { clearToolStatus } from './toolStatus'
import { formatShortcut } from './useShortcuts'

const RESIZE_STEP = 16
const RESIZE_STEP_LARGE = 64

export interface ToolDockProps {
  width: number
  onWidthChange(width: number): void
  /** Dismisses the dock. Bound to `Esc` while the dock is an overlay. */
  onDismiss(): void
  className?: string
}

export function ToolDock({ width, onWidthChange, onDismiss, className }: ToolDockProps) {
  const { mode } = useLayout()
  const open = useTools((state) => state.open)
  const focused = useTools((state) => state.focused)
  const promoted = useTools((state) => state.promoted)

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const overlay = dockIsOverlay(mode)
  const fullBleed = mode === 'compact'

  useEffect(() => {
    if (!overlay) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlay, onDismiss])

  const tools = open
    .map((id) => getTool(id))
    .filter((tool): tool is ToolDefinition => tool !== undefined)
    // A promoted tool lives in the workspace, not in the accordion.
    .filter((tool) => tool.id !== promoted)

  return (
    <aside
      aria-label="Tools"
      data-overlay={overlay ? 'true' : 'false'}
      style={fullBleed ? undefined : { width: `${width}px` }}
      className={cn(
        // `relative` because the resizer is placed on the dock's left edge.
        // Overlay placement belongs to `AppShell`, which owns the stacking box.
        'relative flex h-full min-h-0 shrink-0 flex-col border-l border-border bg-surface-1',
        overlay && 'shadow-e3',
        fullBleed && 'w-full border-l-0',
        className,
      )}
    >
      {!fullBleed ? (
        <DockResizer width={width} onWidthChange={onWidthChange} />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {tools.length === 0 ? (
          <div className="p-panel">
            <EmptyState
              title="No tools open"
              description="Pick a destination from the rail, or search everything with the command palette."
              hint={<span className="font-mono text-mono-xs">{formatShortcut('Ctrl+K')}</span>}
            />
          </div>
        ) : (
          tools.map((tool) => (
            <DockSection
              key={tool.id}
              tool={tool}
              focused={focused === tool.id}
              collapsed={collapsed[tool.id] === true}
              onToggleCollapse={() =>
                setCollapsed((current) => ({ ...current, [tool.id]: !(current[tool.id] === true) }))
              }
            />
          ))
        )}
      </div>
    </aside>
  )
}

/* ── Section ─────────────────────────────────────────────────────────────── */

function DockSection({
  tool,
  focused,
  collapsed,
  onToggleCollapse,
}: {
  tool: ToolDefinition
  focused: boolean
  collapsed: boolean
  onToggleCollapse(): void
}) {
  const focusTool = useTools((state) => state.focusTool)
  const closeTool = useTools((state) => state.closeTool)
  const promote = useTools((state) => state.promote)
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const bufferName = tabs.find((tab) => tab.id === activeId)?.name

  const capabilities = hostCapabilities()
  const gated = tool.requires !== undefined && capabilities[tool.requires] !== true

  const bodyId = `dock-body-${tool.id}`
  const headerId = `dock-header-${tool.id}`
  const Icon = tool.icon

  return (
    <section
      aria-labelledby={headerId}
      data-tool-id={tool.id}
      onFocusCapture={() => focusTool(tool.id)}
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-b border-border',
        !collapsed && 'flex-1',
        focused && 'bg-surface-1',
      )}
    >
      <div
        className={cn(
          'flex h-8 shrink-0 items-center gap-1 bg-surface-2 px-1.5',
          focused && 'border-l-2 border-l-accent pl-1',
        )}
      >
        <button
          type="button"
          id={headerId}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggleCollapse}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm text-text"
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          )}
          <Icon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0" />
          <span className="shrink-0 font-medium">{tool.title}</span>
          {bufferName ? (
            <span className="min-w-0 truncate font-mono text-mono-xs text-text-tertiary">
              · {bufferName}
            </span>
          ) : null}
        </button>

        <IconButton
          icon={Maximize2}
          label={`Promote ${tool.title} to a workspace tab (${formatShortcut('Ctrl+Shift+\\')})`}
          size="xs"
          variant="ghost"
          onClick={() => promote(tool.id)}
        />
        <IconButton
          icon={X}
          label={`Close ${tool.title}`}
          size="xs"
          variant="ghost"
          onClick={() => {
            // Closing wipes the tool's reported state, including its secret
            // marker (UX_SPEC 3.0, 5.5 rule 5).
            clearToolStatus(tool.id)
            closeTool(tool.id)
          }}
        />
      </div>

      <div
        id={bodyId}
        role="region"
        aria-labelledby={headerId}
        hidden={collapsed}
        className={cn('min-h-0 flex-1 overflow-y-auto', collapsed && 'hidden')}
      >
        {gated && tool.requires ? (
          <div className="p-panel pb-0">
            <InlineAlert tone="info" title={`${tool.title} is limited in this host`}>
              {capabilityHint(tool.requires)}
            </InlineAlert>
          </div>
        ) : null}
        <PanelErrorBoundary title={tool.title}>
          <Suspense fallback={<PanelSkeleton />}>
            <tool.Panel />
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </section>
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
