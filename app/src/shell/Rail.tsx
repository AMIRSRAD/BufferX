/**
 * The left rail (UX_SPEC 1.2).
 *
 * Twelve destinations in five groups. Two properties matter more than the
 * pixels:
 *
 * 1. Activating a destination selects its workspace. Open tools retain their
 *    drafts until explicitly closed from the workspace tab strip.
 * 2. **State dots.** A tool that holds live state says so from the rail: teal =
 *    has a result, amber = the result is stale, red = last run failed, grey ring
 *    = a secret is resident in memory. The grey ring is how an operator knows a
 *    key is still loaded (UX_SPEC 5.5 rule 5).
 *
 * Dots are never the only signal: each is mirrored in the tooltip text and in
 * the button's accessible description, per UX_SPEC 6.2 ("no information by
 * colour alone").
 */

import { useMemo } from 'react'
import {
  FileCode2,
  History as HistoryIcon,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import { hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useTools } from '@/store/tools'
import { TOOLS, type ToolCapability, type ToolDefinition, type ToolGroup } from '@/tools/registry'
import { EMPTY_TOOL_STATUS, useToolStatuses, type ToolStatus } from './toolStatus'
import { formatShortcut } from './useShortcuts'

/** A rail row. `tool` entries come from the registry; the rest are shell-owned. */
interface RailEntry {
  id: string
  title: string
  icon: LucideIcon
  group: ToolGroup
  shortcut?: string
  requires?: ToolCapability
  kind: 'workspace' | 'tool' | 'unavailable'
  /** Shown instead of the tooltip's shortcut line when `kind` is `unavailable`. */
  note?: string
}

const GROUP_ORDER: ToolGroup[] = ['workspace', 'analyze', 'security', 'utilities', 'system']

const GROUP_LABEL: Record<ToolGroup, string> = {
  workspace: 'Workspace',
  analyze: 'Analyze',
  security: 'Security',
  utilities: 'Utilities',
  system: 'System',
}

/**
 * The `Buffer` destination returns to the active buffer tab; `History` is the
 * undo timeline of UX_SPEC 2.6/5.3, which has no panel in this build and is
 * therefore shown gated rather than silently dropped (tenet 8).
 */
const SHELL_ENTRIES: RailEntry[] = [
  { id: 'buffer', title: 'Buffer', icon: FileCode2, group: 'workspace', shortcut: 'Alt+1', kind: 'workspace' },
  {
    id: 'history',
    title: 'History',
    icon: HistoryIcon,
    group: 'system',
    shortcut: 'Alt+0',
    kind: 'unavailable',
    note: 'The undo timeline is not available in this build. Undo and redo still work with Ctrl+Z and Ctrl+Shift+Z.',
  },
]

function entryForTool(tool: ToolDefinition): RailEntry {
  const entry: RailEntry = {
    id: tool.id,
    title: tool.title,
    icon: tool.icon,
    group: tool.group,
    kind: 'tool',
  }
  if (tool.shortcut !== undefined) entry.shortcut = tool.shortcut
  if (tool.requires !== undefined) entry.requires = tool.requires
  return entry
}

/**
 * Every destination, in rail order. `History` sorts before Settings and About
 * inside the bottom group, matching the spec's listing.
 */
export const RAIL_ENTRIES: RailEntry[] = (() => {
  const buffer = SHELL_ENTRIES[0]
  const history = SHELL_ENTRIES[1]
  const entries: RailEntry[] = []
  if (buffer) entries.push(buffer)
  for (const tool of TOOLS) {
    if (tool.group === 'system') continue
    entries.push(entryForTool(tool))
  }
  if (history) entries.push(history)
  for (const tool of TOOLS) {
    if (tool.group !== 'system') continue
    entries.push(entryForTool(tool))
  }
  return entries
})()

/**
 * `Alt+1…Alt+9`, `Alt+0` in rail order. Exported so `AppShell` can bind a slot
 * to a destination without duplicating the ordering rule.
 */
export const RAIL_SLOTS: readonly string[] = [
  'buffer',
  'tlv',
  'iransystem',
  'mac',
  'pin',
  'crypto',
  'rsa',
  'toolbox',
  'network',
  'history',
]

export interface RailProps {
  /** Show text labels (208px) rather than icons only (52px). */
  labeled: boolean
  /** Returns to the buffer document in the workspace. */
  onSelectWorkspace(): void
  /** Toggles between labelled and icon-only. Omit to hide the control. */
  onToggleLabels?: () => void
  /** Fired after any activation, so an overlay rail can dismiss itself. */
  onNavigate?: () => void
  className?: string
}

type DotTone = 'error' | 'stale' | 'result' | null

function toneFor(status: ToolStatus, hasProblem: boolean): DotTone {
  if (status.error || hasProblem) return 'error'
  if (status.stale) return 'stale'
  if (status.result) return 'result'
  return null
}

const DOT_CLASS: Record<'error' | 'stale' | 'result', string> = {
  error: 'bg-error',
  stale: 'bg-warn',
  result: 'bg-accent',
}

const DOT_WORD: Record<'error' | 'stale' | 'result', string> = {
  error: 'has an error',
  stale: 'result is stale',
  result: 'has a result',
}

export function Rail({ labeled, onSelectWorkspace, onToggleLabels, onNavigate, className }: RailProps) {
  const open = useTools((state) => state.open)
  const toggleTool = useTools((state) => state.toggleTool)
  const unpromote = useTools((state) => state.unpromote)
  const promoted = useTools((state) => state.promoted)
  const problems = useProblems((state) => state.items)
  const statuses = useToolStatuses()
  const activeId = useBuffers((state) => state.activeId)

  const capabilities = hostCapabilities()

  /** Tool titles that currently own at least one error entry (UX_SPEC 5.1). */
  const erroredSources = useMemo(() => {
    const set = new Set<string>()
    for (const problem of problems) {
      if (problem.severity !== 'error') continue
      set.add(problem.source.toLowerCase())
    }
    return set
  }, [problems])

  const grouped = useMemo(() => {
    return GROUP_ORDER.map((group) => ({
      group,
      entries: RAIL_ENTRIES.filter((entry) => entry.group === group),
    })).filter((block) => block.entries.length > 0)
  }, [])

  function activate(entry: RailEntry) {
    if (entry.kind === 'unavailable') return
    if (entry.kind === 'workspace') {
      unpromote()
      onSelectWorkspace()
    } else {
      toggleTool(entry.id)
    }
    onNavigate?.()
  }

  return (
    <nav
      aria-label="Destinations"
      data-labeled={labeled ? 'true' : 'false'}
      className={cn(
        'flex h-full shrink-0 flex-col gap-1 overflow-y-auto overflow-x-hidden',
        'border-r border-border bg-surface-1 py-1.5',
        labeled ? 'w-52 px-1.5' : 'w-13 px-1.5',
        className,
      )}
    >
      {grouped.map((block, index) => (
        <div
          key={block.group}
          role="group"
          aria-label={GROUP_LABEL[block.group]}
          className={cn(
            'flex flex-col gap-0.5',
            index > 0 && 'border-t border-border-subtle pt-1.5',
            // The system group is pushed to the bottom of the rail.
            block.group === 'system' && 'mt-auto',
          )}
        >
          {labeled ? (
            <span className="px-1.5 pb-0.5 text-2xs tracking-wide text-text-tertiary uppercase">
              {GROUP_LABEL[block.group]}
            </span>
          ) : null}

          {block.entries.map((entry) => {
            const isOpen = entry.kind === 'tool' && open.includes(entry.id)
            const isCurrent =
              entry.kind === 'workspace'
                ? promoted === null
                : entry.kind === 'tool' && promoted === entry.id

            const status = statuses[entry.id] ?? EMPTY_TOOL_STATUS
            const tone = entry.kind === 'tool' ? toneFor(status, erroredSources.has(entry.title.toLowerCase())) : null
            const holdsSecret = entry.kind === 'tool' && status.secret

            const gated = entry.requires !== undefined && capabilities[entry.requires] !== true
            const Icon = entry.icon

            const stateWords: string[] = []
            if (isOpen) stateWords.push('open')
            if (tone) stateWords.push(DOT_WORD[tone])
            if (holdsSecret) stateWords.push('holds a secret in memory')
            if (gated) stateWords.push('limited in this host')

            const tooltip = (
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="font-medium">{entry.title}</span>
                  {entry.shortcut ? (
                    <span className="font-mono text-mono-xs text-text-tertiary">
                      {formatShortcut(entry.shortcut)}
                    </span>
                  ) : null}
                </span>
                {entry.note ? <span className="text-text-secondary">{entry.note}</span> : null}
                {gated && entry.requires ? (
                  <span className="text-text-secondary">{capabilityHint(entry.requires)}</span>
                ) : null}
                {stateWords.length > 0 && !entry.note ? (
                  <span className="text-text-secondary">{stateWords.join(' · ')}</span>
                ) : null}
              </span>
            )

            const description =
              stateWords.length > 0 ? `${entry.title}. ${stateWords.join('. ')}.` : entry.title

            return (
              <Tooltip key={entry.id} content={tooltip} side="right" align="center">
                <button
                  type="button"
                  disabled={entry.kind === 'unavailable'}
                  aria-disabled={entry.kind === 'unavailable' || undefined}
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={description}
                  data-tool-id={entry.id}
                  data-buffer-scope={activeId ?? undefined}
                  onClick={() => activate(entry)}
                  className={cn(
                    'group relative flex h-control-md items-center rounded-sm text-sm',
                    'transition-colors duration-fast ease-standard',
                    labeled ? 'w-full gap-2 px-2' : 'w-full justify-center px-0',
                    isCurrent
                      ? 'bg-accent-muted text-text'
                      : 'text-text-secondary hover:bg-surface-raised hover:text-text',
                    entry.kind === 'unavailable' && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  )}
                >
                  <span className="relative flex shrink-0 items-center justify-center">
                    <Icon size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                    {tone ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -top-0.5 -right-1 size-1.5 rounded-full',
                          'ring-1 ring-surface-1',
                          DOT_CLASS[tone],
                        )}
                      />
                    ) : null}
                    {holdsSecret ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -bottom-0.5 -right-1 size-2 rounded-full',
                          'border border-border-strong bg-transparent',
                        )}
                      />
                    ) : null}
                  </span>

                  {labeled ? (
                    <>
                      <span className="min-w-0 flex-1 truncate text-left">{entry.title}</span>
                      {entry.shortcut ? (
                        <span
                          aria-hidden="true"
                          className="shrink-0 font-mono text-mono-xs text-text-tertiary"
                        >
                          {formatShortcut(entry.shortcut)}
                        </span>
                      ) : null}
                    </>
                  ) : null}

                  {!labeled && isOpen ? (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-accent"
                    />
                  ) : null}
                </button>
              </Tooltip>
            )
          })}
        </div>
      ))}

      {/* Collapse control.
          The labelled/icon-only choice used to live only in Settings and on a
          shortcut, so an operator who wanted the space back — or who could not
          place an icon — had to go looking for it. It belongs on the thing it
          resizes. */}
      {onToggleLabels ? (
        <Tooltip content={<span>{labeled ? 'Collapse to icons' : 'Show names'}</span>} side="right">
          <button
            type="button"
            onClick={onToggleLabels}
            aria-label={labeled ? 'Collapse the sidebar to icons' : 'Show sidebar names'}
            className={cn(
              'mt-0.5 flex h-control-sm shrink-0 items-center rounded-sm',
              'border-t border-border-subtle pt-1.5',
              'text-text-tertiary transition-colors duration-fast ease-standard',
              'hover:bg-surface-raised hover:text-text',
              labeled ? 'w-full gap-2 px-2' : 'w-full justify-center px-0',
            )}
          >
            {labeled ? (
              <PanelLeftClose size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            ) : (
              <PanelLeftOpen size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            )}
            {labeled ? <span className="truncate text-xs">Collapse</span> : null}
          </button>
        </Tooltip>
      ) : null}
    </nav>
  )
}
