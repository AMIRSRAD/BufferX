/**
 * The Problems drawer (UX_SPEC 5.1 tier 2).
 *
 * The old app's only error channel was a single elided, right-aligned status
 * label where each new error silently overwrote the last. This is the
 * replacement: a durable, timestamped, filterable, copyable log that
 * accumulates instead of replacing, and whose rows navigate to the origin.
 *
 * ```
 * PROBLEMS  2 errors · 1 warning · 4 info   [Errors│Warnings│All] [⧉ copy all] [clear]
 * ✕ 11:42:07  Build   F52 binary length mismatch: declared 8 bytes, value is 6.   [→]
 * ```
 *
 * Severity is never colour alone: every row carries a glyph and the severity
 * word in its accessible name (UX_SPEC 6.2).
 */

import { useMemo } from 'react'
import { ChevronDown, ChevronUp, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cn } from '@/lib/cn'
import { useProblems, type Problem, type ProblemSeverity } from '@/store/problems'
import { formatShortcut } from './useShortcuts'

export type ProblemFilter = 'errors' | 'warnings' | 'all'

const SEVERITY_ICON: Record<ProblemSeverity, LucideIcon> = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
}

const SEVERITY_INK: Record<ProblemSeverity, string> = {
  error: 'text-error',
  warning: 'text-warn',
  info: 'text-info',
}

const SEVERITY_WORD: Record<ProblemSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
}

/** `11:42:07`, locale-independent so a screenshot is comparable across hosts. */
function formatTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function asText(problem: Problem): string {
  const field = problem.fieldId === undefined ? '' : ` (F${problem.fieldId})`
  return `${SEVERITY_WORD[problem.severity]} ${formatTime(problem.at)} ${problem.source}${field}: ${problem.message}`
}

export interface ProblemsDrawerProps {
  expanded: boolean
  onExpandedChange(expanded: boolean): void
  filter: ProblemFilter
  onFilterChange(filter: ProblemFilter): void
  /** Height of the expanded body, in px. Derived from the shell's own box. */
  bodyHeight: number
  /** Navigates to a problem's origin — the offending field, or its tool. */
  onJump(problem: Problem): void
  className?: string
}

export function ProblemsDrawer({
  expanded,
  onExpandedChange,
  filter,
  onFilterChange,
  bodyHeight,
  onJump,
  className,
}: ProblemsDrawerProps) {
  const items = useProblems((state) => state.items)
  const clear = useProblems((state) => state.clear)

  const counts = useMemo(() => {
    let error = 0
    let warning = 0
    let info = 0
    for (const item of items) {
      if (item.severity === 'error') error += 1
      else if (item.severity === 'warning') warning += 1
      else info += 1
    }
    return { error, warning, info }
  }, [items])

  const visible = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'errors') return items.filter((item) => item.severity === 'error')
    return items.filter((item) => item.severity === 'warning')
  }, [items, filter])

  const summary = [
    `${counts.error} ${counts.error === 1 ? 'error' : 'errors'}`,
    `${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`,
    `${counts.info} info`,
  ].join(' · ')

  return (
    <aside
      role="log"
      aria-label="Problems"
      className={cn('flex shrink-0 flex-col border-t border-border bg-surface-1', className)}
    >
      {/* Collapsed strip — always visible, 24px. */}
      <div className="flex h-6 shrink-0 items-center gap-2 px-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="problems-body"
          onClick={() => onExpandedChange(!expanded)}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-2xs tracking-wide text-text-secondary uppercase hover:text-text"
        >
          {expanded ? (
            <ChevronDown size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          ) : (
            <ChevronUp size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          )}
          Problems
        </button>

        <span aria-live="polite" className="min-w-0 truncate text-2xs text-text-secondary">
          {items.length === 0 ? 'No problems.' : summary}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <SegmentedControl
            size="xs"
            value={filter}
            onValueChange={(value) => onFilterChange(value as ProblemFilter)}
            options={[
              { value: 'errors', label: 'Errors' },
              { value: 'warnings', label: 'Warnings' },
              { value: 'all', label: 'All' },
            ]}
          />
          <CopyButton
            value={items.map(asText).join('\n')}
            label="Copy all problems"
            size="xs"
            variant="ghost"
          />
          <Button size="xs" variant="ghost" onClick={() => clear()} disabled={items.length === 0}>
            Clear
          </Button>
          <IconButton
            icon={expanded ? ChevronDown : ChevronUp}
            label={`${expanded ? 'Collapse' : 'Expand'} the Problems drawer (${formatShortcut('Ctrl+`')})`}
            size="xs"
            variant="ghost"
            onClick={() => onExpandedChange(!expanded)}
          />
        </span>
      </div>

      {/* Body. */}
      <div
        id="problems-body"
        hidden={!expanded}
        style={expanded ? { height: `${bodyHeight}px` } : undefined}
        className={cn('min-h-0 overflow-y-auto border-t border-border-subtle', !expanded && 'hidden')}
      >
        {visible.length === 0 ? (
          <p className="p-panel text-sm text-text-tertiary">
            {items.length === 0 ? 'No problems.' : 'No entries match this filter.'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {visible.map((problem) => {
              const Icon = SEVERITY_ICON[problem.severity]
              return (
                <li key={problem.id}>
                  <div
                    className={cn(
                      'group flex items-start gap-2 border-b border-border-subtle px-2 py-cell-y',
                      'hover:bg-surface-raised',
                    )}
                  >
                    <Icon
                      size={14}
                      strokeWidth={1.5}
                      absoluteStrokeWidth
                      aria-hidden="true"
                      className={cn('mt-0.5 shrink-0', SEVERITY_INK[problem.severity])}
                    />
                    <span className="shrink-0 font-mono text-mono-xs text-text-tertiary" data-tnum>
                      {formatTime(problem.at)}
                    </span>
                    <span className="w-16 shrink-0 truncate text-xs text-text-secondary">
                      {problem.source}
                    </span>
                    <button
                      type="button"
                      onClick={() => onJump(problem)}
                      aria-label={`${SEVERITY_WORD[problem.severity]} from ${problem.source}: ${problem.message}${
                        problem.fieldId === undefined ? '' : `. Go to field ${problem.fieldId}.`
                      }`}
                      className="min-w-0 flex-1 text-left text-xs break-words text-text hover:underline"
                    >
                      {problem.fieldId === undefined ? null : (
                        <span className="mr-1 font-mono text-mono-xs text-text-tertiary">
                          F{problem.fieldId}
                        </span>
                      )}
                      {problem.message}
                    </button>
                    <CopyButton
                      value={asText(problem)}
                      label="Copy this problem"
                      size="xs"
                      variant="ghost"
                      className="shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
