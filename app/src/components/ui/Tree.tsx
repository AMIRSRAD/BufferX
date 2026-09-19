import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
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

export interface TreeNodeBase {
  id: string
}

export interface TreeNodeMeta {
  level: number
  expanded: boolean
  selected: boolean
  hasChildren: boolean
}

export interface TreeProps<Node extends TreeNodeBase> {
  /** Root nodes. */
  nodes: Node[]
  getChildren: (node: Node) => Node[] | undefined
  /** Renders everything to the right of the chevron. */
  renderNode: (node: Node, meta: TreeNodeMeta) => ReactNode
  expandedIds: ReadonlySet<string> | readonly string[]
  onToggle: (id: string) => void
  selectedId?: string
  onSelect?: (id: string) => void
  /** Defaults to `node.id`. */
  getNodeId?: (node: Node) => string
  /** Off for short trees where the container should size to content. */
  virtualized?: boolean
  emptyState?: ReactNode
  className?: string
  'aria-label'?: string
}

interface FlatNode<Node> {
  node: Node
  id: string
  level: number
  hasChildren: boolean
  expanded: boolean
  /** 1-based position among its siblings, for `aria-posinset`. */
  posInSet: number
  setSize: number
  parentId: string | null
}

const DEFAULT_ROW_HEIGHT = 24
const INDENT_PX = 16
const OVERSCAN = 8

/** Rows share the Table's geometry, so a TLV tree and a field table align. */
function useRowHeight(): number {
  const [height, setHeight] = useState(DEFAULT_ROW_HEIGHT)
  useLayoutEffect(() => {
    const read = () => {
      const styles = getComputedStyle(document.documentElement)
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

/**
 * DESIGN_SYSTEM.md §4.12 — TLV/EMV structure and packager field hierarchies.
 *
 * `role="tree"` with `aria-expanded`/`aria-level`/`aria-setsize`/
 * `aria-posinset`; `←` collapses or moves to the parent, `→` expands or moves
 * to the first child, `*` expands every sibling. Expansion is never animated.
 */
export function Tree<Node extends TreeNodeBase>({
  nodes,
  getChildren,
  renderNode,
  expandedIds,
  onToggle,
  selectedId,
  onSelect,
  getNodeId,
  virtualized = true,
  emptyState,
  className,
  ...aria
}: TreeProps<Node>) {
  const rowHeight = useRowHeight()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [cursor, setCursor] = useState(0)

  const idOf = useCallback((node: Node) => (getNodeId ? getNodeId(node) : node.id), [getNodeId])

  const expanded = useMemo(
    () => (expandedIds instanceof Set ? expandedIds : new Set(expandedIds as readonly string[])),
    [expandedIds],
  )

  const flat = useMemo(() => {
    const out: FlatNode<Node>[] = []
    const walk = (siblings: Node[], level: number, parentId: string | null) => {
      siblings.forEach((node, index) => {
        const id = idOf(node)
        const children = getChildren(node)
        const hasChildren = Array.isArray(children) && children.length > 0
        const isExpanded = hasChildren && expanded.has(id)
        out.push({
          node,
          id,
          level,
          hasChildren,
          expanded: isExpanded,
          posInSet: index + 1,
          setSize: siblings.length,
          parentId,
        })
        if (isExpanded && children) walk(children, level + 1, id)
      })
    }
    walk(nodes, 0, null)
    return out
  }, [nodes, getChildren, expanded, idOf])

  const virtualizer = useVirtualizer({
    count: flat.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: OVERSCAN,
  })

  // Clamp the cursor when the visible set shrinks (a collapse, a filter).
  useEffect(() => {
    if (cursor > flat.length - 1) setCursor(Math.max(0, flat.length - 1))
  }, [flat.length, cursor])

  const focusRow = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(flat.length - 1, index))
      setCursor(clamped)
      if (virtualized) virtualizer.scrollToIndex(clamped, { align: 'auto' })
      requestAnimationFrame(() => {
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-tree-index="${clamped}"]`)
          ?.focus()
      })
    },
    [flat.length, virtualized, virtualizer],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const item = flat[index]
    if (!item) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusRow(index + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        focusRow(index - 1)
        return
      case 'ArrowRight':
        event.preventDefault()
        if (item.hasChildren && !item.expanded) onToggle(item.id)
        else if (item.hasChildren && item.expanded) focusRow(index + 1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        if (item.hasChildren && item.expanded) {
          onToggle(item.id)
        } else if (item.parentId) {
          const parentIndex = flat.findIndex((candidate) => candidate.id === item.parentId)
          if (parentIndex >= 0) focusRow(parentIndex)
        }
        return
      case 'Home':
        event.preventDefault()
        focusRow(0)
        return
      case 'End':
        event.preventDefault()
        focusRow(flat.length - 1)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        onSelect?.(item.id)
        return
      case '*': {
        event.preventDefault()
        // Expand every sibling of the focused node.
        for (const candidate of flat) {
          if (candidate.parentId === item.parentId && candidate.hasChildren && !candidate.expanded) {
            onToggle(candidate.id)
          }
        }
        return
      }
      default:
    }
  }

  const renderRow = (index: number, style: CSSProperties) => {
    const item = flat[index]
    if (!item) return null
    const selected = selectedId !== undefined && selectedId === item.id

    return (
      <div
        key={item.id}
        role="treeitem"
        aria-level={item.level + 1}
        aria-setsize={item.setSize}
        aria-posinset={item.posInSet}
        aria-expanded={item.hasChildren ? item.expanded : undefined}
        aria-selected={selected || undefined}
        data-tree-index={index}
        tabIndex={index === cursor ? 0 : -1}
        style={style}
        onFocus={() => setCursor(index)}
        onKeyDown={(event) => handleKeyDown(event, index)}
        onClick={() => {
          setCursor(index)
          onSelect?.(item.id)
        }}
        className={cn(
          'flex w-full items-center gap-1 scroll-mx-2 scroll-my-2 pr-2 text-xs',
          selected ? 'bg-accent-muted text-text' : 'text-text hover:bg-surface-raised',
        )}
      >
        {/* 16px indent guides; the ancestor chain of the focused node is drawn
            one step stronger. */}
        {Array.from({ length: item.level }, (_, depth) => (
          <span
            key={depth}
            aria-hidden="true"
            className={cn(
              'h-full shrink-0 border-l',
              index === cursor ? 'border-border-strong' : 'border-border-subtle',
            )}
            style={{ width: INDENT_PX }}
          />
        ))}

        {item.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(item.id)
            }}
            className="flex size-3 shrink-0 items-center justify-center text-text-tertiary hover:text-text"
          >
            <ChevronRight
              size={12}
              strokeWidth={1.25}
              absoluteStrokeWidth
              className={cn('transition-transform duration-fast ease-standard motion-reduce:transition-none', item.expanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="size-3 shrink-0" />
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {renderNode(item.node, {
            level: item.level,
            expanded: item.expanded,
            selected,
            hasChildren: item.hasChildren,
          })}
        </div>
      </div>
    )
  }

  if (flat.length === 0) {
    return (
      <div className={cn('flex min-h-0 flex-col overflow-hidden', className)}>
        {emptyState ?? <p className="p-4 text-sm text-text-tertiary">Nothing to show.</p>}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={aria['aria-label']}
      className={cn('min-h-0 flex-1 overflow-auto overscroll-contain', className)}
    >
      {virtualized ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) =>
            renderRow(virtualRow.index, {
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: rowHeight,
              transform: `translateY(${virtualRow.start}px)`,
            }),
          )}
        </div>
      ) : (
        <div className="w-full">{flat.map((_, index) => renderRow(index, { height: rowHeight }))}</div>
      )}
    </div>
  )
}
