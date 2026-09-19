import { useId, useMemo, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from '@/components/ui/IconButton'
import { Input } from '@/components/ui/Input'
import {
  TOOLBOX_GROUPS,
  TOOLBOX_OPERATIONS,
  type OperationDef,
  type ToolboxGroupId,
} from './operations'

export interface OperationListProps {
  selected: string
  onSelect: (id: string) => void
  query: string
  onQueryChange: (query: string) => void
  className?: string
}

interface RenderedGroup {
  id: ToolboxGroupId
  label: string
  operations: OperationDef[]
}

function matches(operation: OperationDef, needle: string, groupLabel: string): boolean {
  if (needle.length === 0) return true
  const haystack = [operation.label, operation.id, groupLabel, operation.summary, ...operation.keywords]
    .join(' ')
    .toLowerCase()
  return needle
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

/**
 * The searchable grouped operation list (UX_SPEC 3.7, 160px column).
 *
 * It is a real listbox: roving tab index, `↑`/`↓` to move the selection,
 * `Home`/`End` to jump. Group headers are `role="presentation"` so they are
 * announced as structure rather than as options.
 */
export function OperationList({
  selected,
  onSelect,
  query,
  onQueryChange,
  className,
}: OperationListProps) {
  const listId = useId()
  const listRef = useRef<HTMLDivElement | null>(null)

  const { groups, flat } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rendered: RenderedGroup[] = []
    const ordered: OperationDef[] = []

    for (const group of TOOLBOX_GROUPS) {
      const operations = TOOLBOX_OPERATIONS.filter(
        (operation) => operation.group === group.id && matches(operation, needle, group.label),
      )
      if (operations.length === 0) continue
      rendered.push({ id: group.id, label: group.label, operations })
      ordered.push(...operations)
    }

    return { groups: rendered, flat: ordered }
  }, [query])

  const move = (delta: number) => {
    if (flat.length === 0) return
    const current = flat.findIndex((operation) => operation.id === selected)
    const nextIndex = current === -1 ? 0 : (current + delta + flat.length) % flat.length
    const next = flat[nextIndex]
    if (!next) return
    onSelect(next.id)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-operation="${next.id}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const jump = (position: 'first' | 'last') => {
    const next = position === 'first' ? flat[0] : flat[flat.length - 1]
    if (!next) return
    onSelect(next.id)
    listRef.current
      ?.querySelector<HTMLElement>(`[data-operation="${next.id}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className={cn('flex min-h-0 w-40 shrink-0 flex-col border-r border-border-subtle', className)}>
      <div className="border-b border-border-subtle p-2">
        <Input
          value={query}
          onValueChange={onQueryChange}
          size="sm"
          placeholder="Search ops"
          aria-label="Search Toolbox operations"
          aria-controls={listId}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'Enter' && flat.length > 0) {
              event.preventDefault()
              const first = flat[0]
              if (first) onSelect(first.id)
            }
          }}
          prefix={
            <Search size={14} strokeWidth={1.25} absoluteStrokeWidth className="text-text-tertiary" aria-hidden />
          }
          suffix={
            query.length > 0 ? (
              <IconButton
                icon={X}
                size="xs"
                variant="ghost"
                label="Clear search"
                tabIndex={-1}
                onClick={() => onQueryChange('')}
              />
            ) : undefined
          }
        />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Toolbox operations"
        className="min-h-0 flex-1 overflow-y-auto py-1"
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            move(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            move(-1)
          } else if (event.key === 'Home') {
            event.preventDefault()
            jump('first')
          } else if (event.key === 'End') {
            event.preventDefault()
            jump('last')
          }
        }}
      >
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">
            No operation matches “{query.trim()}”.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} role="group" aria-label={group.label} className="pb-1">
              <p
                role="presentation"
                className="px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-text-tertiary uppercase"
              >
                {group.label}
              </p>
              {group.operations.map((operation) => {
                const active = operation.id === selected
                return (
                  <div
                    key={operation.id}
                    role="option"
                    aria-selected={active}
                    data-operation={operation.id}
                    tabIndex={active ? 0 : -1}
                    title={operation.label}
                    onClick={() => onSelect(operation.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(operation.id)
                      }
                    }}
                    className={cn(
                      'cursor-default truncate border-l-2 px-2 py-1 text-xs',
                      'transition-colors duration-fast ease-standard motion-reduce:transition-none',
                      'focus-visible:shadow-focus',
                      active
                        ? 'border-l-accent bg-accent-muted font-medium text-text'
                        : 'border-l-transparent text-text-secondary hover:bg-surface-raised hover:text-text',
                    )}
                  >
                    {operation.label}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
