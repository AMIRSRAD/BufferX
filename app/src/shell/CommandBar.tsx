/**
 * The command bar (UX_SPEC 1.1, 1.3, 5.7).
 *
 * ```
 * ▣ BufferX │ ◆auth-req.bxb* │ reversal.bxb │ + │      [ENGINE: GENERIC] [NATIVE] ⌘K
 * ```
 *
 * Three things live here that the Qt app either hid or never had: the buffer tab
 * strip (which replaces a combobox that silently discarded edits on switch), the
 * `ENGINE:` pill that makes Legacy ATM mode visible and togglable from the main
 * view, and the transport pill that states honestly whether this is the native
 * or the WASM engine.
 *
 * Deliberately *not* here: the packager picker and a Settings button. Both used
 * to sit in this bar as well as in their real homes — the picker beside the
 * buffer it applies to, Settings as a rail destination — which meant two
 * controls for one piece of state and a moment's doubt about whether they were
 * the same thing. Status belongs in the bar; controls belong next to what they
 * act on.
 */

import { useMemo, type ReactNode } from 'react'
import { ChevronDown, Lock, Plus, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Kbd } from '@/components/ui/Kbd'
import { Popover } from '@/components/ui/Popover'
import { Tooltip } from '@/components/ui/Tooltip'
import { engineKind, hostCapabilities } from '@/engine/client'
import { cn } from '@/lib/cn'
import { useBuffers, type BufferTab } from '@/store/buffers'
import { useSettings } from '@/store/settings'
import { useLayout, type LayoutMode } from './layout'
import { secretHolders, useToolStatuses } from './toolStatus'
import { formatShortcut } from './useShortcuts'
import { getTool } from '@/tools/registry'


/** How many tabs stay in the strip before the rest fold into the overflow menu. */
function visibleTabCount(mode: LayoutMode): number {
  switch (mode) {
    case 'ultra':
      return 8
    case 'wide':
      return 5
    case 'medium':
      return 3
    case 'compact':
      return 1
  }
}

export interface CommandBarProps {
  onOpenPalette(): void
  /** Routed through `AppShell` so a dirty tab always raises the same prompt. */
  onRequestCloseBuffer(id: string): void
  /** Slot for the compact-layout rail menu button. */
  leading?: ReactNode
  className?: string
}

export function CommandBar({ onOpenPalette, onRequestCloseBuffer, leading, className }: CommandBarProps) {
  const { mode } = useLayout()
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const setActive = useBuffers((state) => state.setActive)
  const newTab = useBuffers((state) => state.newTab)

  const limit = visibleTabCount(mode)
  const activeIndex = tabs.findIndex((tab) => tab.id === activeId)

  // Keep the active tab in the visible window even when it sits past the limit.
  const visible = useMemo(() => {
    if (tabs.length <= limit) return tabs
    const head = tabs.slice(0, limit)
    if (activeIndex >= limit && activeIndex < tabs.length) {
      const active = tabs[activeIndex]
      if (active) head[limit - 1] = active
    }
    return head
  }, [tabs, limit, activeIndex])

  const overflow = tabs.filter((tab) => !visible.includes(tab))

  return (
    <header
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-surface-1 px-1.5',
        className,
      )}
    >
      {leading}

      <span className="flex shrink-0 items-center gap-1.5 pr-1.5 pl-0.5">
        <span aria-hidden="true" className="size-3 rounded-xs bg-accent" />
        <span className="text-sm font-medium tracking-tight text-text">BufferX</span>
      </span>

      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />

      {/* Buffer tabs (UX_SPEC 1.3). */}
      <div
        role="tablist"
        aria-label="Open buffers"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
      >
        {visible.map((tab) => (
          <BufferTabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onSelect={() => setActive(tab.id)}
            onClose={() => onRequestCloseBuffer(tab.id)}
          />
        ))}

        {overflow.length > 0 ? (
          <Popover
            align="start"
            trigger={
              <button
                type="button"
                className={cn(
                  'flex h-control-sm shrink-0 items-center gap-1 rounded-sm px-1.5',
                  'text-xs text-text-secondary hover:bg-surface-raised hover:text-text',
                )}
              >
                <ChevronDown size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                {overflow.length} more
              </button>
            }
          >
            <ul className="flex max-h-80 w-64 flex-col overflow-y-auto py-1">
              {overflow.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => setActive(tab.id)}
                    className={cn(
                      'flex w-full items-center gap-2 px-2 py-1 text-left text-sm',
                      'text-text-secondary hover:bg-surface-raised hover:text-text',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('size-1.5 shrink-0 rounded-full', tab.dirty ? 'bg-accent' : 'bg-transparent')}
                    />
                    <span className="min-w-0 flex-1 truncate">{tab.name}</span>
                    {tab.dirty ? <span className="shrink-0 text-2xs text-text-tertiary">unsaved</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </Popover>
        ) : null}

        <Tooltip content={<span>New buffer {formatShortcut('Alt+N')}</span>}>
          <IconButton
            icon={Plus}
            label="New buffer"
            size="xs"
            variant="ghost"
            tooltip={false}
            onClick={() => newTab()}
          />
        </Tooltip>
      </div>

      <span className="flex shrink-0 items-center gap-1.5">
        {/* The packager picker lives in the workspace, beside the buffer it
            applies to, and Settings is a rail destination. Duplicating either
            here gave two controls for one piece of state and cost the operator
            a moment working out whether they differed. */}
        <EnginePill />
        <TransportPill />
        <SecretsIndicator />

        <Tooltip content={<span>Command palette {formatShortcut('Ctrl+K')}</span>}>
          <Button
            variant="ghost"
            size="xs"
            icon={Search}
            onClick={onOpenPalette}
            aria-keyshortcuts="Control+K"
            className="gap-1.5"
          >
            <span className="sr-only">Command palette</span>
            <Kbd>{formatShortcut('Ctrl+K')}</Kbd>
          </Button>
        </Tooltip>
      </span>
    </header>
  )
}

/* ── Buffer tab ──────────────────────────────────────────────────────────── */

function BufferTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: BufferTab
  active: boolean
  onSelect(): void
  onClose(): void
}) {
  return (
    <span
      className={cn(
        'group flex h-control-sm min-w-0 shrink items-center rounded-sm',
        'transition-colors duration-fast ease-standard',
        active ? 'bg-surface-raised text-text' : 'text-text-secondary hover:bg-surface-2 hover:text-text',
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        onAuxClick={(event) => {
          // Middle-click closes, as in every tabbed editor (UX_SPEC 1.3).
          if (event.button === 1) {
            event.preventDefault()
            onClose()
          }
        }}
        className="flex min-w-0 items-center gap-1.5 py-0 pr-1 pl-2 text-sm"
      >
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', tab.dirty ? 'bg-accent' : 'bg-transparent')}
        />
        <span className="min-w-0 max-w-40 truncate">{tab.name}</span>
        {tab.dirty ? <span className="sr-only">(unsaved changes)</span> : null}
      </button>
      <IconButton
        icon={X}
        label={`Close ${tab.name}`}
        size="xs"
        variant="ghost"
        tooltip={false}
        onClick={onClose}
        className={cn('mr-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100', active && 'opacity-70')}
      />
    </span>
  )
}

/* ── Packager pill ───────────────────────────────────────────────────────── */




/* ── Engine and transport pills ──────────────────────────────────────────── */

function EnginePill() {
  const legacyEngine = useSettings((state) => state.legacyEngine)
  const setLegacyEngine = useSettings((state) => state.setLegacyEngine)

  return (
    <Tooltip
      content={
        legacyEngine
          ? 'Legacy ATM engine: AlmasPlus packed BCD, binary bitmap, length prefix and field flags. Click to return to the generic engine.'
          : 'Generic ISO 8583 engine. Click to switch to the legacy ATM engine.'
      }
    >
      <button
        type="button"
        aria-pressed={legacyEngine}
        onClick={() => setLegacyEngine(!legacyEngine)}
        className="shrink-0 rounded-sm"
      >
        <Badge tone={legacyEngine ? 'warn' : 'neutral'} mono dot>
          {legacyEngine ? 'ENGINE: LEGACY ATM' : 'ENGINE: GENERIC'}
        </Badge>
      </button>
    </Tooltip>
  )
}

function TransportPill() {
  const kind = engineKind()
  const capabilities = hostCapabilities()
  const native = kind === 'native'

  return (
    <Tooltip
      content={
        native
          ? 'Native IPC to the C++ core. Raw TCP, native file dialogs and key-file loading are available.'
          : 'The engine runs as WebAssembly in this tab. Results are identical; raw TCP, native dialogs and key-file loading need the desktop app.'
      }
    >
      <span className="shrink-0">
        <Badge tone={native ? 'accent' : 'info'} mono>
          {native ? 'NATIVE' : 'WASM'}
        </Badge>
        <span className="sr-only">
          {native ? 'Native transport.' : 'WebAssembly transport.'}{' '}
          {capabilities.tcp ? 'TCP available.' : 'TCP unavailable.'}
        </span>
      </span>
    </Tooltip>
  )
}

/**
 * The resident-secret indicator (UX_SPEC 5.5 rule 5). Lists which tools hold a
 * secret — by tool, never by value.
 */
function SecretsIndicator() {
  const statuses = useToolStatuses()
  const holders = secretHolders(statuses)
  if (holders.length === 0) return null

  const names = holders.map((id) => getTool(id)?.title ?? id)

  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Secrets resident in memory</span>
          <span className="text-text-secondary">{names.join(', ')}</span>
          <span className="text-text-secondary">
            Clear them with {formatShortcut('Ctrl+Alt+L')}. Nothing here is saved or logged.
          </span>
        </span>
      }
    >
      <span
        className="flex h-control-sm shrink-0 items-center gap-1 rounded-sm px-1 text-warn"
        aria-label={`${names.length} tool${names.length === 1 ? '' : 's'} hold a secret in memory: ${names.join(', ')}`}
      >
        <Lock size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        <span aria-hidden="true" className="font-mono text-mono-xs">
          {names.length}
        </span>
      </span>
    </Tooltip>
  )
}
