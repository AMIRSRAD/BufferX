/** Application shell with document context, workspace tabs and an optional
 * resizable buffer/tool split. Hidden workspaces remain mounted for drafts.
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { IconButton } from '@/components/ui/IconButton'
import { Popover } from '@/components/ui/Popover'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { useBuffers, type BufferTab } from '@/store/buffers'
import { useProblems, type Problem } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { useTools } from '@/store/tools'
import { getTool } from '@/tools/registry'
import { CommandBar } from './CommandBar'
import { CommandPalette } from './CommandPalette'
import { PanelErrorBoundary } from './ErrorBoundary'
import { ProblemsDrawer, type ProblemFilter } from './ProblemsDrawer'
import { RAIL_SLOTS, Rail } from './Rail'
import { StatusStrip } from './StatusStrip'
import { PanelSkeleton, ToolDock } from './ToolDock'
import { WorkspaceTabs } from './WorkspaceTabs'
import { LayoutProvider, defaultDockWidth, useContainerSize } from './layout'
import { clearAllToolStatus } from './toolStatus'
import {
  SHELL_ACTION_EVENT,
  SHELL_COMMAND_EVENT,
  SHORTCUTS,
  formatShortcut,
  useShortcuts,
  type ShellActionDetail,
  type ShellCommandDetail,
  type ShortcutHandlers,
} from './useShortcuts'

// The buffer document is the heaviest surface in the app (CodeMirror, the
// virtualized field table, the byte view). Loading it lazily keeps the shell's
// first paint independent of it.
const BufferWorkspace = lazy(() => import('@/tools/buffer/BufferWorkspace'))

/** `F6` cycles these, wrapping (UX_SPEC 4.3). */
const REGIONS = ['commandbar', 'rail', 'workspace', 'dock', 'problems', 'status'] as const
type Region = (typeof REGIONS)[number]

const REGION_LABEL: Record<Region, string> = {
  commandbar: 'Command bar',
  rail: 'Rail',
  workspace: 'Workspace',
  dock: 'Tool dock',
  problems: 'Problems',
  status: 'Status strip',
}

export function AppShell() {
  const rootRef = useRef<HTMLDivElement>(null)
  const size = useContainerSize(rootRef)
  const { mode, height } = size

  /* ── Stores ─────────────────────────────────────────────────────────────── */
  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const setActive = useBuffers((state) => state.setActive)
  const newTab = useBuffers((state) => state.newTab)
  const closeTab = useBuffers((state) => state.closeTab)
  const reopenLast = useBuffers((state) => state.reopenLast)

  const focusedTool = useTools((state) => state.focused)
  const promoted = useTools((state) => state.promoted)
  const toggleTool = useTools((state) => state.toggleTool)
  const openTool = useTools((state) => state.openTool)
  const promote = useTools((state) => state.promote)
  const unpromote = useTools((state) => state.unpromote)

  const railLabeled = useSettings((state) => state.railLabeled)
  const toggleRail = useSettings((state) => state.toggleRail)
  const theme = useSettings((state) => state.theme)
  const setTheme = useSettings((state) => state.setTheme)
  const density = useSettings((state) => state.density)
  const setDensity = useSettings((state) => state.setDensity)
  const legacyEngine = useSettings((state) => state.legacyEngine)
  const setLegacyEngine = useSettings((state) => state.setLegacyEngine)

  const addProblem = useProblems((state) => state.add)

  /* ── Shell-local layout state ───────────────────────────────────────────── */
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false)
  const [railMenuOpen, setRailMenuOpen] = useState(false)
  const [splitRequested, setSplitRequested] = useState(false)
  const [dockWidth, setDockWidth] = useState(() => defaultDockWidth(mode))
  const [problemsExpanded, setProblemsExpanded] = useState(false)
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>('all')
  const [focusedRegion, setFocusedRegion] = useState<Region>('workspace')
  const [pendingClose, setPendingClose] = useState<BufferTab | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    setFocusedRegion(promoted ? 'dock' : 'workspace')
  }, [promoted])

  const regionRefs = useRef<Partial<Record<Region, HTMLElement | null>>>({})

  // One stable callback per region: a fresh closure each render would detach
  // and re-attach every region ref on every state change.
  const regionRef = useMemo(() => {
    const map = {} as Record<Region, (element: HTMLElement | null) => void>
    for (const region of REGIONS) {
      map[region] = (element) => {
        regionRefs.current[region] = element
      }
    }
    return map
  }, [])

  // Dock width follows the mode's default until the operator drags it.
  const dockTouched = useRef(false)
  useEffect(() => {
    if (dockTouched.current) return
    setDockWidth(defaultDockWidth(mode))
  }, [mode])

  const railAsMenu = mode === 'compact'
  const showRail = !railAsMenu
  const railIsLabeled = railLabeled
  const canSplit = size.width - (showRail ? (railIsLabeled ? 208 : 52) : 0) >= 1050
  const split = splitRequested && canSplit && promoted !== null
  const toolWidth = Math.min(dockWidth, Math.max(380, size.width - (railIsLabeled ? 208 : 52) - 600))

  const announce = useCallback((message: string) => {
    setAnnouncement(message)
  }, [])

  /* ── Command plumbing ───────────────────────────────────────────────────── */

  /**
   * Broadcasts a named command. The workspace, the field table and the tools
   * subscribe to `SHELL_COMMAND_EVENT`; anything the shell owns outright is
   * handled here first and never re-broadcast.
   */
  const dispatch = useCallback(
    (command: string) => {
      switch (command) {
        case 'toggle-theme':
          setTheme(theme === 'dark' ? 'light' : 'dark')
          return
        case 'toggle-density':
          setDensity(density === 'dense' ? 'comfortable' : 'dense')
          return
        case 'toggle-rail-labels':
          toggleRail()
          return
        case 'toggle-legacy-engine':
          setLegacyEngine(!legacyEngine)
          return
        case 'open-problems':
          setProblemsExpanded(true)
          return
        case 'history':
          toast.info('The history timeline is not available in this build. Undo and redo still work.')
          return
        default:
          break
      }

      if (command.startsWith('jump-to-field:') || ['open-buffer', 'filter-fields', 'add-field', 'expand-value'].includes(command)) {
        unpromote()
        regionRefs.current.workspace?.focus()
      }

      const detail: ShellCommandDetail = { command }
      document.dispatchEvent(new CustomEvent<ShellCommandDetail>(SHELL_COMMAND_EVENT, { detail }))
    },
    [density, legacyEngine, setDensity, setLegacyEngine, setTheme, theme, toggleRail, unpromote],
  )

  const regionAction = useCallback(
    (kind: 'primary' | 'secondary') => {
      const toolActive = promoted && (focusedRegion !== 'workspace' || !split)
      const detail: ShellActionDetail = { kind, region: toolActive ? 'dock' : focusedRegion }
      if (toolActive) detail.tool = promoted
      document.dispatchEvent(new CustomEvent<ShellActionDetail>(SHELL_ACTION_EVENT, { detail }))
    },
    [focusedRegion, promoted, split],
  )

  /* ── Buffer lifecycle ───────────────────────────────────────────────────── */

  /**
   * Closing a dirty buffer is one of only two permitted modals (UX_SPEC 5.1):
   * it is genuinely blocking and the loss is not undoable.
   */
  const requestCloseBuffer = useCallback(
    (id: string) => {
      const result = closeTab(id)
      if (result.closed) {
        toast.success(`Closed ${result.tab.name}. Reopen with ${formatShortcut('Alt+Shift+W')}.`)
        return
      }
      if (result.reason === 'dirty') setPendingClose(result.tab)
    },
    [closeTab],
  )

  const stepBuffer = useCallback(
    (delta: -1 | 1) => {
      if (tabs.length === 0) return
      const index = tabs.findIndex((tab) => tab.id === activeId)
      const next = tabs[(((index === -1 ? 0 : index) + delta) % tabs.length + tabs.length) % tabs.length]
      if (next) setActive(next.id)
    },
    [tabs, activeId, setActive],
  )

  /* ── Region focus ───────────────────────────────────────────────────────── */

  const stepRegion = useCallback(
    (delta: -1 | 1) => {
      const index = REGIONS.indexOf(focusedRegion)
      for (let step = 1; step <= REGIONS.length; step += 1) {
        const candidate = REGIONS[(((index + delta * step) % REGIONS.length) + REGIONS.length) % REGIONS.length]
        if (!candidate) continue
        const element = regionRefs.current[candidate]
        if (!element || element.hidden) continue
        element.focus()
        setFocusedRegion(candidate)
        announce(`${REGION_LABEL[candidate]} focused.`)
        return
      }
    },
    [focusedRegion, announce],
  )

  /* ── Rail ───────────────────────────────────────────────────────────────── */

  const focusWorkspace = useCallback(() => {
    unpromote()
    setFocusedRegion('workspace')
    regionRefs.current.workspace?.focus()
  }, [unpromote])

  const railDestination = useCallback(
    (slot: number) => {
      const id = RAIL_SLOTS[slot - 1]
      if (!id) return
      if (id === 'buffer') {
        focusWorkspace()
        return
      }
      if (id === 'history') {
        dispatch('history')
        return
      }
      toggleTool(id)
      setFocusedRegion('dock')
    },
    [dispatch, focusWorkspace, toggleTool],
  )

  /* ── Secrets ────────────────────────────────────────────────────────────── */

  const clearSecrets = useCallback(() => {
    clearAllToolStatus()
    dispatch('clear-secrets')
    addProblem({
      severity: 'info',
      source: 'Security',
      message: 'All in-memory secrets were cleared (keys, PINs, PANs and PEM key material).',
    })
    toast.success('All secrets cleared.')
  }, [addProblem, dispatch])

  /* ── The global keymap ──────────────────────────────────────────────────── */

  const handlers = useMemo<ShortcutHandlers>(
    () => ({
      openPalette: () => setPaletteOpen((current) => !current),
      toggleDock: () => {
        if (promoted) unpromote()
        else if (focusedTool) promote(focusedTool)
      },
      toggleProblems: () => setProblemsExpanded((current) => !current),
      promoteFocusedTool: () => {
        if (!canSplit) {
          toast.info('Widen the window to use split view.')
          return
        }
        if (focusedTool) {
          promote(focusedTool)
          setSplitRequested((current) => !current)
        } else toast.info('Open a tool first.')
      },
      railDestination,
      newBuffer: () => {
        newTab()
        focusWorkspace()
      },
      closeBuffer: () => {
        if (activeId) requestCloseBuffer(activeId)
      },
      reopenBuffer: () => {
        const id = reopenLast()
        if (!id) toast.info('No recently closed buffer to reopen.')
      },
      stepBuffer,
      openSettings: () => {
        openTool('settings')
      },
      openShortcutSheet: () => setShortcutSheetOpen(true),
      clearSecrets,
      stepRegion,
      primaryAction: () => regionAction('primary'),
      secondaryAction: () => regionAction('secondary'),
      dispatch,
    }),
    [
      activeId,
      canSplit,
      clearSecrets,
      dispatch,
      focusWorkspace,
      focusedTool,
      newTab,
      openTool,
      promote,
      promoted,
      railDestination,
      regionAction,
      reopenLast,
      requestCloseBuffer,
      stepBuffer,
      stepRegion,
      unpromote,
    ],
  )

  useShortcuts(handlers)

  /* ── Problems navigation ────────────────────────────────────────────────── */

  const jumpToProblem = useCallback(
    (problem: Problem) => {
      if (problem.fieldId !== undefined) {
        dispatch(`jump-to-field:${problem.fieldId}`)
        return
      }
      const tool = getTool(problem.source.toLowerCase())
      if (tool) {
        openTool(tool.id)
        return
      }
      focusWorkspace()
    },
    [dispatch, focusWorkspace, openTool],
  )

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const problemsBodyHeight = Math.max(120, Math.round(height * 0.3))

  const railElement = (
    <Rail
      labeled={railIsLabeled || railAsMenu}
      onSelectWorkspace={focusWorkspace}
      // Not offered in the compact overlay: there the rail is a menu that is
      // always labelled and dismisses on selection, so collapsing it to icons
      // would produce a menu of unlabelled glyphs.
      {...(railAsMenu ? {} : { onToggleLabels: toggleRail })}
      onNavigate={() => {
        setRailMenuOpen(false)
      }}
    />
  )

  return (
    <LayoutProvider value={size}>
      <div
        ref={rootRef}
        data-layout={mode}
        className="flex h-dvh w-full flex-col overflow-hidden bg-surface-0 text-text"
      >
        {/* Screen-reader announcements for focus and layout changes (6.3). */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <div
          ref={regionRef.commandbar}
          tabIndex={-1}
          onFocusCapture={() => setFocusedRegion('commandbar')}
          className={cn('shrink-0 focus:outline-none', focusedRegion === 'commandbar' && 'ring-1 ring-accent ring-inset')}
        >
          <CommandBar
            onOpenPalette={() => setPaletteOpen(true)}
            onRequestCloseBuffer={requestCloseBuffer}
            onCreateBuffer={focusWorkspace}
            leading={
              railAsMenu ? (
                <Popover
                  open={railMenuOpen}
                  onOpenChange={setRailMenuOpen}
                  align="start"
                  padded={false}
                  trigger={
                    <span>
                      <IconButton icon={Menu} label="Destinations" size="xs" variant="ghost" tooltip={false} />
                    </span>
                  }
                >
                  <div className="h-96 w-56 overflow-y-auto">{railElement}</div>
                </Popover>
              ) : null
            }
          />
        </div>

        {/* Rail · Workspace · Dock. `relative` so the overlay dock has an anchor. */}
        <div className="relative flex min-h-0 flex-1">
          {showRail ? (
            <div
              ref={regionRef.rail}
              tabIndex={-1}
              onFocusCapture={() => setFocusedRegion('rail')}
              className={cn(
                'flex min-h-0 shrink-0 focus:outline-none',
                focusedRegion === 'rail' && 'ring-1 ring-accent ring-inset',
              )}
            >
              {railElement}
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div onFocusCapture={() => setFocusedRegion(promoted ? 'dock' : 'workspace')}>
              <WorkspaceTabs split={split} canSplit={canSplit} onToggleSplit={() => setSplitRequested(!split)} />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1">
              <main
                ref={regionRef.workspace}
                tabIndex={-1}
                id="workspace-buffer"
                role="tabpanel"
                aria-labelledby="workspace-tab-buffer"
                hidden={promoted !== null && !split}
                onFocusCapture={() => setFocusedRegion('workspace')}
                className={cn('min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus:outline-none', promoted !== null && !split ? 'hidden' : 'flex')}
              >
                <PanelErrorBoundary title="the buffer workspace">
                  <Suspense fallback={<PanelSkeleton />}><BufferWorkspace /></Suspense>
                </PanelErrorBoundary>
              </main>
              <div
                ref={regionRef.dock}
                tabIndex={-1}
                hidden={promoted === null}
                onFocusCapture={() => setFocusedRegion('dock')}
                className={cn('min-h-0 min-w-0 focus:outline-none', promoted === null ? 'hidden' : 'flex', split ? 'shrink-0' : 'flex-1')}
              >
                <ToolDock width={toolWidth} split={split} onWidthChange={(width) => {
                  dockTouched.current = true
                  setDockWidth(width)
                }} />
              </div>
            </div>
          </div>
        </div>

        <div
          ref={regionRef.problems}
          tabIndex={-1}
          onFocusCapture={() => setFocusedRegion('problems')}
          className={cn('shrink-0 focus:outline-none', focusedRegion === 'problems' && 'ring-1 ring-accent ring-inset')}
        >
          <ProblemsDrawer
            expanded={problemsExpanded}
            onExpandedChange={setProblemsExpanded}
            filter={problemFilter}
            onFilterChange={setProblemFilter}
            bodyHeight={problemsBodyHeight}
            onJump={jumpToProblem}
          />
        </div>

        <div
          ref={regionRef.status}
          tabIndex={-1}
          onFocusCapture={() => setFocusedRegion('status')}
          className={cn('shrink-0 focus:outline-none', focusedRegion === 'status' && 'ring-1 ring-accent ring-inset')}
        >
          <StatusStrip />
        </div>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} handlers={handlers} />

      <ShortcutSheet open={shortcutSheetOpen} onOpenChange={setShortcutSheetOpen} />

      <DirtyCloseDialog
        tab={pendingClose}
        onCancel={() => setPendingClose(null)}
        onDiscard={() => {
          if (pendingClose) closeTab(pendingClose.id, { force: true })
          setPendingClose(null)
        }}
        onSave={() => {
          dispatch('save-buffer')
          setPendingClose(null)
        }}
      />
    </LayoutProvider>
  )
}

/* ── Shortcut sheet (Ctrl+/) ─────────────────────────────────────────────── */

function ShortcutSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof SHORTCUTS>()
    for (const entry of SHORTCUTS) {
      const list = map.get(entry.scope) ?? []
      map.set(entry.scope, [...list, entry])
    }
    return Array.from(map.entries())
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Keyboard shortcuts"
      description="Every action reachable by mouse is reachable by keyboard."
    >
      <div className="flex flex-col gap-group">
        {groups.map(([scope, entries]) => (
          <section key={scope} className="flex flex-col gap-1">
            <h3 className="text-2xs tracking-wide text-text-tertiary uppercase">{scope}</h3>
            <table className="w-full">
              <caption className="sr-only">{scope} shortcuts</caption>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.keys} className="border-b border-border-subtle">
                    <th
                      scope="row"
                      className="w-48 py-cell-y pr-cell-x text-left font-mono text-mono-sm font-normal text-text"
                    >
                      {formatShortcut(entry.keys)}
                    </th>
                    <td className="py-cell-y text-sm text-text-secondary">{entry.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  )
}

/* ── Dirty-close prompt ──────────────────────────────────────────────────── */

function DirtyCloseDialog({
  tab,
  onCancel,
  onDiscard,
  onSave,
}: {
  tab: BufferTab | null
  onCancel(): void
  onDiscard(): void
  onSave(): void
}) {
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      size="sm"
      title={tab ? `Close ${tab.name}?` : 'Close buffer?'}
      description="This buffer has unsaved edits. Buffers are held in memory only, so discarding them cannot be undone."
      footer={
        <div className="flex w-full items-center justify-end gap-field">
          <Button size="md" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="md" variant="danger" onClick={onDiscard}>
            Discard
          </Button>
          <Button size="md" variant="primary" onClick={onSave}>
            Save
          </Button>
        </div>
      }
    >
      <p className="text-base text-text-secondary">
        {tab?.fields.length ?? 0} field{(tab?.fields.length ?? 0) === 1 ? '' : 's'} and the raw buffer will be
        lost. Saving keeps the tab open so you can confirm the write first.
      </p>
    </Dialog>
  )
}
