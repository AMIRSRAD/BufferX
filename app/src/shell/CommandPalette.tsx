/**
 * The command palette (UX_SPEC 4.1).
 *
 * The rail is the discovery surface; this is the speed surface. It lists every
 * open buffer, every tool and every command, fuzzy-matched, with the bound
 * shortcut right-aligned.
 *
 * Two rules from the spec that are easy to get wrong:
 *
 * - **Disabled commands still appear**, greyed, with the reason as the subtitle
 *   (`requires desktop`). Discovery matters more than tidiness, and hiding a
 *   host-gated feature makes the web build feel broken rather than scoped.
 * - **`Ctrl+Enter` runs and keeps the palette open**, for chained runs.
 *
 * Prefixes narrow the scope: `>` commands, `/` tools, `!` problems, `#` fields,
 * `@` packagers. A typed prefix becomes a chip in front of the input so the
 * scope is visible rather than remembered.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command } from 'cmdk'
import { FileCode2, type LucideIcon } from 'lucide-react'
import { Kbd } from '@/components/ui/Kbd'
import { hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useTools } from '@/store/tools'
import { TOOLS, type ToolCapability } from '@/tools/registry'
import { formatShortcut, type ShortcutHandlers } from './useShortcuts'

/** Palette scopes, keyed by the character that selects them. */
const PREFIXES = {
  '>': 'Commands',
  '/': 'Tools',
  '!': 'Problems',
  '#': 'Fields',
  '@': 'Packagers',
} as const

type Prefix = keyof typeof PREFIXES

function isPrefix(value: string): value is Prefix {
  return value === '>' || value === '/' || value === '!' || value === '#' || value === '@'
}

/** One command row. `requires` gates it without hiding it (UX_SPEC 5.7). */
interface PaletteCommand {
  id: string
  label: string
  group: string
  shortcut?: string
  keywords?: string[]
  requires?: ToolCapability
  run(): void
}

export interface CommandPaletteProps {
  open: boolean
  onOpenChange(open: boolean): void
  /** The same handler object the global keymap uses, so bindings cannot drift. */
  handlers: ShortcutHandlers
}

export function CommandPalette({ open, onOpenChange, handlers }: CommandPaletteProps) {
  const [raw, setRaw] = useState('')
  const [prefix, setPrefix] = useState<Prefix | null>(null)

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const setActive = useBuffers((state) => state.setActive)
  const problems = useProblems((state) => state.items)
  const openTool = useTools((state) => state.openTool)
  const capabilities = hostCapabilities()

  // A fresh palette every time: a stale query is never what the operator meant.
  useEffect(() => {
    if (!open) {
      setRaw('')
      setPrefix(null)
    }
  }, [open])

  const commands = useMemo<PaletteCommand[]>(() => {
    const dispatch = (command: string) => () => handlers.dispatch(command)
    return [
      // Buffer
      { id: 'decode', label: 'Decode buffer', group: 'Buffer', shortcut: 'Ctrl+Enter', run: handlers.primaryAction },
      { id: 'build', label: 'Build buffer', group: 'Buffer', shortcut: 'Ctrl+Shift+Enter', run: handlers.secondaryAction },
      { id: 'identify-packager', label: 'Identify packager', group: 'Buffer', shortcut: 'Ctrl+Shift+D', run: dispatch('identify-packager') },
      { id: 'toggle-auto-decode', label: 'Toggle auto-decode', group: 'Buffer', run: dispatch('toggle-auto-decode') },
      { id: 'cycle-raw-view', label: 'Cycle raw view (Text / Hex / Bytes)', group: 'Buffer', shortcut: 'Ctrl+Shift+V', run: dispatch('cycle-raw-view') },
      { id: 'add-length-header', label: 'Add length header', group: 'Buffer', run: dispatch('add-length-header') },
      { id: 'convert-to-hex', label: 'Convert buffer to hex', group: 'Buffer', run: dispatch('convert-to-hex') },
      { id: 'convert-to-text', label: 'Convert buffer to text', group: 'Buffer', run: dispatch('convert-to-text') },
      { id: 'copy-raw', label: 'Copy raw buffer', group: 'Buffer', run: dispatch('copy-raw') },
      { id: 'copy-raw-hex', label: 'Copy raw as hex', group: 'Buffer', run: dispatch('copy-raw-hex') },
      { id: 'copy-dump', label: 'Copy hex dump', group: 'Buffer', run: dispatch('copy-dump') },
      { id: 'clear-buffer', label: 'Clear buffer', group: 'Buffer', run: dispatch('clear-buffer') },
      { id: 'undo', label: 'Undo', group: 'Buffer', shortcut: 'Ctrl+Z', run: dispatch('undo') },
      { id: 'redo', label: 'Redo', group: 'Buffer', shortcut: 'Ctrl+Shift+Z', run: dispatch('redo') },

      // Buffers
      { id: 'new-buffer', label: 'New buffer', group: 'Buffers', shortcut: 'Alt+N', run: handlers.newBuffer },
      { id: 'close-buffer', label: 'Close buffer', group: 'Buffers', shortcut: 'Alt+W', run: handlers.closeBuffer },
      { id: 'reopen-buffer', label: 'Reopen closed buffer', group: 'Buffers', shortcut: 'Alt+Shift+W', run: handlers.reopenBuffer },
      { id: 'next-buffer', label: 'Next buffer', group: 'Buffers', shortcut: 'Alt+]', run: () => handlers.stepBuffer(1) },
      { id: 'previous-buffer', label: 'Previous buffer', group: 'Buffers', shortcut: 'Alt+[', run: () => handlers.stepBuffer(-1) },
      { id: 'open-buffer', label: 'Open buffer file…', group: 'Buffers', shortcut: 'Ctrl+O', requires: 'files', run: dispatch('open-buffer') },
      { id: 'save-buffer', label: 'Save buffer', group: 'Buffers', shortcut: 'Ctrl+S', run: dispatch('save-buffer') },
      { id: 'save-buffer-as', label: 'Save buffer as…', group: 'Buffers', shortcut: 'Ctrl+Shift+S', run: dispatch('save-buffer-as') },

      // Fields
      { id: 'add-field', label: 'Add field…', group: 'Fields', shortcut: 'Alt+A', run: dispatch('add-field') },
      { id: 'remove-field', label: 'Remove selected field', group: 'Fields', shortcut: 'Delete', run: dispatch('remove-field') },
      { id: 'clear-fields', label: 'Clear all fields', group: 'Fields', run: dispatch('clear-fields') },
      { id: 'reset-fields', label: 'Reset to packager defaults', group: 'Fields', run: dispatch('reset-fields') },
      { id: 'filter-fields', label: 'Filter fields…', group: 'Fields', shortcut: 'Ctrl+F', run: dispatch('filter-fields') },
      { id: 'toggle-field-hex', label: 'Toggle hex on field', group: 'Fields', shortcut: 'Alt+H', run: dispatch('toggle-field-hex') },
      { id: 'expand-value', label: 'Expand value editor', group: 'Fields', shortcut: 'Alt+Enter', run: dispatch('expand-value') },
      { id: 'copy-fields-json', label: 'Copy all fields as JSON', group: 'Fields', run: dispatch('copy-fields-json') },
      { id: 'copy-fields-tsv', label: 'Copy all fields as TSV', group: 'Fields', run: dispatch('copy-fields-tsv') },
      { id: 'toggle-offset-column', label: 'Toggle offset column', group: 'Fields', run: dispatch('toggle-offset-column') },

      // Packager and framing
      { id: 'reload-packagers', label: 'Reload packager file', group: 'Packager', run: dispatch('reload-packagers') },
      { id: 'open-packager-file', label: 'Open packager file…', group: 'Packager', requires: 'files', run: dispatch('open-packager-file') },
      { id: 'toggle-legacy-engine', label: 'Toggle Legacy ATM Engine', group: 'Packager', run: dispatch('toggle-legacy-engine') },
      { id: 'toggle-auto-detect', label: 'Toggle auto-detect framing', group: 'Packager', run: dispatch('toggle-auto-detect') },
      { id: 'toggle-include-header', label: 'Toggle include header on build', group: 'Packager', run: dispatch('toggle-include-header') },

      // View and app
      { id: 'toggle-dock', label: 'Switch between buffer and tool', group: 'View', shortcut: 'Ctrl+B', run: handlers.toggleDock },
      { id: 'promote-tool', label: 'Toggle buffer and tool split view', group: 'View', shortcut: 'Ctrl+Shift+\\', run: handlers.promoteFocusedTool },
      { id: 'toggle-problems', label: 'Toggle Problems drawer', group: 'View', shortcut: 'Ctrl+`', run: handlers.toggleProblems },
      { id: 'toggle-rail-labels', label: 'Toggle rail labels', group: 'View', run: dispatch('toggle-rail-labels') },
      { id: 'toggle-theme', label: 'Toggle theme', group: 'View', run: dispatch('toggle-theme') },
      { id: 'toggle-density', label: 'Toggle density', group: 'View', run: dispatch('toggle-density') },
      { id: 'open-settings', label: 'Open Settings', group: 'App', shortcut: 'Ctrl+,', run: handlers.openSettings },
      { id: 'open-about', label: 'Open About', group: 'App', run: () => openTool('about') },
      { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'App', shortcut: 'Ctrl+/', run: handlers.openShortcutSheet },
      { id: 'clear-secrets', label: 'Clear all secrets', group: 'App', shortcut: 'Ctrl+Alt+L', run: handlers.clearSecrets },
      { id: 'copy-diagnostics', label: 'Copy diagnostics', group: 'App', run: dispatch('copy-diagnostics') },
    ]
  }, [handlers, openTool])

  // A ref, not state: cmdk fires `onSelect` from the same keydown that told us
  // whether the chord modifier was held, so a state update would arrive late.
  const keepOpen = useRef(false)

  function runAndClose(run: () => void) {
    run()
    if (!keepOpen.current) onOpenChange(false)
  }

  const showBuffers = prefix === null
  const showTools = prefix === null || prefix === '/'
  const showProblems = prefix === null || prefix === '!'
  const showCommands = prefix === null || prefix === '>'
  const showFields = prefix === '#'
  const showPackagers = prefix === '@'

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      shouldFilter
      loop
      overlayClassName="fixed inset-0 z-50 bg-scrim"
      // The trap spans the viewport and the sheet is centred inside it, so the
      // palette is never positioned at an absolute offset.
      contentClassName="fixed inset-0 z-50 flex justify-center px-4 pt-16 focus:outline-none"
      className={cn(
        'flex max-h-160 w-full max-w-160 flex-col self-start overflow-hidden',
        'rounded-lg border border-border bg-surface-3 shadow-e3',
      )}
      onKeyDown={(event) => {
        // Ctrl+Enter runs and keeps the palette open, for chained runs.
        keepOpen.current = event.ctrlKey || event.metaKey
        if (event.key === 'Backspace' && raw === '' && prefix !== null) {
          event.preventDefault()
          setPrefix(null)
        }
      }}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3">
        {prefix ? (
          <span className="shrink-0 rounded-sm bg-accent-muted px-1.5 py-0.5 text-xs text-accent">
            {PREFIXES[prefix]}
          </span>
        ) : null}
        <Command.Input
          value={raw}
          autoFocus
          placeholder={
            prefix ? `Search ${PREFIXES[prefix].toLowerCase()}…` : 'Search commands, buffers and tools…'
          }
          onValueChange={(value) => {
            const first = value.charAt(0)
            if (prefix === null && raw === '' && isPrefix(first)) {
              setPrefix(first)
              setRaw(value.slice(1))
              return
            }
            setRaw(value)
          }}
          className={cn(
            'h-control-lg w-full bg-transparent text-lg text-text placeholder:text-text-tertiary',
            'focus:outline-none',
          )}
        />
      </div>

      <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <Command.Empty className="px-2 py-6 text-center text-sm text-text-tertiary">
          Nothing matches.
        </Command.Empty>

        {showFields ? (
          <Command.Group heading={<GroupHeading>Fields</GroupHeading>}>
            <Command.Item
              value={`field ${raw}`}
              onSelect={() => runAndClose(() => handlers.dispatch(`jump-to-field:${raw}`))}
              className={ITEM_CLASS}
            >
              <span className="flex-1">
                Jump to field <span className="font-mono text-mono-sm">{raw || '…'}</span>
              </span>
              <span className="text-xs text-text-tertiary">by bit number or name</span>
            </Command.Item>
          </Command.Group>
        ) : null}

        {showPackagers ? (
          <Command.Group heading={<GroupHeading>Packagers</GroupHeading>}>
            <Command.Item
              value={`packager ${raw}`}
              onSelect={() => runAndClose(() => handlers.dispatch(`select-packager:${raw}`))}
              className={ITEM_CLASS}
            >
              <span className="flex-1">
                Select packager <span className="font-mono text-mono-sm">{raw || '…'}</span>
              </span>
            </Command.Item>
          </Command.Group>
        ) : null}

        {/* Open buffers. */}
        {showBuffers ? (
          <Command.Group heading={<GroupHeading>Buffers</GroupHeading>}>
            {tabs.map((tab) => (
              <Command.Item
                key={tab.id}
                value={`buffer ${tab.name}`}
                keywords={['buffer', tab.packager]}
                onSelect={() => runAndClose(() => setActive(tab.id))}
                className={ITEM_CLASS}
              >
                <Row
                  icon={FileCode2}
                  label={tab.name}
                  context={`${tab.packager}${tab.dirty ? ' · unsaved' : ''}${tab.id === activeId ? ' · active' : ''}`}
                />
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {/* Tools. */}
        {showTools ? (
          <Command.Group heading={<GroupHeading>Tools</GroupHeading>}>
            {TOOLS.map((tool) => {
              const gated = tool.requires !== undefined && capabilities[tool.requires] !== true
              return (
                <Command.Item
                  key={tool.id}
                  value={`tool ${tool.title}`}
                  keywords={['tool', 'open', tool.id]}
                  onSelect={() => runAndClose(() => openTool(tool.id))}
                  className={ITEM_CLASS}
                >
                  <Row
                    icon={tool.icon}
                    label={`Open ${tool.title}`}
                    context={gated && tool.requires ? capabilityHint(tool.requires) : undefined}
                    shortcut={tool.shortcut}
                  />
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}

        {/* Problems. */}
        {showProblems ? (
          <Command.Group heading={<GroupHeading>Problems</GroupHeading>}>
            {problems.slice(0, 20).map((problem) => (
              <Command.Item
                key={problem.id}
                value={`problem ${problem.source} ${problem.message}`}
                onSelect={() =>
                  runAndClose(() =>
                    handlers.dispatch(
                      problem.fieldId === undefined
                        ? 'open-problems'
                        : `jump-to-field:${problem.fieldId}`,
                    ),
                  )
                }
                className={ITEM_CLASS}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="mr-1.5 text-xs text-text-tertiary">{problem.source}</span>
                  {problem.message}
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}

        {/* Commands, grouped. */}
        {showCommands
          ? Array.from(new Set(commands.map((command) => command.group))).map((group) => (
              <Command.Group key={group} heading={<GroupHeading>{group}</GroupHeading>}>
                {commands
                  .filter((command) => command.group === group)
                  .map((command) => {
                    const gated = command.requires !== undefined && capabilities[command.requires] !== true
                    return (
                      <Command.Item
                        key={command.id}
                        value={`${group} ${command.label}`}
                        keywords={command.keywords ?? [command.id]}
                        disabled={gated}
                        onSelect={() => {
                          if (gated) return
                          runAndClose(command.run)
                        }}
                        className={ITEM_CLASS}
                      >
                        <Row
                          label={command.label}
                          context={gated && command.requires ? capabilityHint(command.requires) : undefined}
                          shortcut={command.shortcut}
                        />
                      </Command.Item>
                    )
                  })}
              </Command.Group>
            ))
          : null}
      </Command.List>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1.5 text-2xs text-text-tertiary">
        <span>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate
        </span>
        <span>
          <Kbd>↵</Kbd> run
        </span>
        <span>
          <Kbd>{formatShortcut('Ctrl+Enter')}</Kbd> run and keep open
        </span>
        <span className="ml-auto">
          <Kbd>esc</Kbd> close
        </span>
      </div>
    </Command.Dialog>
  )
}

const ITEM_CLASS = cn(
  'flex cursor-default items-center gap-2 rounded-sm px-2 text-sm text-text-secondary',
  'h-control-md data-[selected=true]:bg-accent-muted data-[selected=true]:text-text',
  'data-[disabled=true]:opacity-50',
)

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <span className="px-2 py-1 text-2xs tracking-wide text-text-tertiary uppercase">{children}</span>
  )
}

function Row({
  icon: Icon,
  label,
  context,
  shortcut,
}: {
  icon?: LucideIcon
  label: string
  context?: string
  shortcut?: string
}) {
  return (
    <>
      {Icon ? (
        <Icon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" className="shrink-0" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {context ? <span className="max-w-64 shrink-0 truncate text-xs text-text-tertiary">{context}</span> : null}
      {shortcut ? (
        <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">{formatShortcut(shortcut)}</span>
      ) : null}
    </>
  )
}
