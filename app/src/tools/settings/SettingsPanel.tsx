/**
 * The Settings surface (UX_SPEC 3.9).
 *
 * "A full workspace tab (`Ctrl+,`), not a 320x472 fixed popover whose bottom
 * controls fell off short windows. Left sub-nav, right content pane."
 *
 * The panel takes no props and renders only its own body: the dock (or the
 * promoted workspace tab) supplies the header, collapse, promote and close
 * affordances. Nothing here has a fixed pixel height; the content pane scrolls
 * internally and the sub-nav collapses to a horizontal strip on narrow docks.
 *
 * Every section is a sibling module in this folder. They share exactly two
 * things: the layout parts in `./parts` and the preference store in
 * `./preferences`.
 */

import { useEffect, useState, type ComponentType } from 'react'
import {
  Cpu,
  FileBox,
  Info,
  Keyboard,
  Package,
  Palette,
  Ruler,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { reportToolStatus } from '@/shell/toolStatus'
import { AppearanceSection } from './AppearanceSection'
import { BuffersSection } from './BuffersSection'
import { DiagnosticsSection } from './DiagnosticsSection'
import { EngineSection } from './EngineSection'
import { FramingSection } from './FramingSection'
import { KeyboardSection } from './KeyboardSection'
import { PackagersSection } from './PackagersSection'
import { SecuritySection } from './SecuritySection'
import './settings.css'
// Installs the idle-wipe timer as a side effect of the tool existing.
import './secretsWipe'

interface SettingsSection {
  id: string
  label: string
  icon: LucideIcon
  /** One line, shown under the heading of the content pane. */
  blurb: string
  Content: ComponentType
}

const SECTIONS: readonly SettingsSection[] = [
  {
    id: 'packagers',
    label: 'Packagers',
    icon: Package,
    blurb: 'Where the ISO 8583 definitions come from, and what the active one declares.',
    Content: PackagersSection,
  },
  {
    id: 'engine',
    label: 'Engine',
    icon: Cpu,
    blurb: 'Generic or legacy ATM rules, and the framing each one applies.',
    Content: EngineSection,
  },
  {
    id: 'framing',
    label: 'Framing defaults',
    icon: Ruler,
    blurb: 'The length-header settings new buffers start with.',
    Content: FramingSection,
  },
  {
    id: 'buffers',
    label: 'Buffers and session',
    icon: FileBox,
    blurb: 'Open, save, recent files and draft retention.',
    Content: BuffersSection,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: Palette,
    blurb: 'Theme, density, scale, type and motion.',
    Content: AppearanceSection,
  },
  {
    id: 'keyboard',
    label: 'Keyboard',
    icon: Keyboard,
    blurb: 'The full binding sheet, searchable, with conflicts flagged.',
    Content: KeyboardSection,
  },
  {
    id: 'security',
    label: 'Security',
    icon: ShieldCheck,
    blurb: 'What is persisted, what never is, and how secrets are wiped.',
    Content: SecuritySection,
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics and About',
    icon: Info,
    blurb: 'Versions, transport, packager provenance and a scrubbed report.',
    Content: DiagnosticsSection,
  },
]

const FIRST_SECTION = SECTIONS[0] as SettingsSection

export default function SettingsPanel() {
  const [activeId, setActiveId] = useState<string>(FIRST_SECTION.id)
  const active = SECTIONS.find((section) => section.id === activeId) ?? FIRST_SECTION

  // Settings holds no result and no secret; it reports a clean slate so the
  // rail dot for this tool never lights up spuriously.
  useEffect(() => {
    reportToolStatus('settings', { result: false, stale: false, error: false, secret: false })
  }, [])

  /** Roving arrow-key navigation across the vertical tablist (WCAG 2.2 AA). */
  function onNavKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = SECTIONS.findIndex((section) => section.id === activeId)
    let next = -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = SECTIONS.length - 1
    else return

    event.preventDefault()
    const wrapped = (next + SECTIONS.length) % SECTIONS.length
    const target = SECTIONS[wrapped]
    if (!target) return
    setActiveId(target.id)
    const node = document.getElementById(`settings-tab-${target.id}`)
    node?.focus()
  }

  const Content = active.Content

  return (
    <div className="flex min-h-0 flex-col gap-group lg:flex-row">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings sections"
        onKeyDown={onNavKeyDown}
        className={cn(
          'flex shrink-0 gap-0.5 overflow-x-auto',
          'flex-row lg:w-56 lg:flex-col lg:overflow-x-visible',
        )}
      >
        {SECTIONS.map((section) => {
          const selected = section.id === active.id
          const Icon = section.icon
          return (
            <button
              key={section.id}
              id={`settings-tab-${section.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`settings-panel-${section.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(section.id)}
              className={cn(
                'flex h-control-md shrink-0 items-center gap-1.5 rounded-sm px-2 text-left text-sm',
                'transition-colors duration-fast ease-standard',
                selected
                  ? 'bg-accent-muted font-medium text-accent'
                  : 'text-text-secondary hover:bg-surface-raised hover:text-text',
              )}
            >
              <Icon size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
              <span className="truncate">{section.label}</span>
            </button>
          )
        })}
      </div>

      <div
        id={`settings-panel-${active.id}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${active.id}`}
        tabIndex={0}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-group overflow-y-auto"
      >
        <header className="flex flex-col gap-0.5">
          <h2 className="text-md font-medium text-text">{active.label}</h2>
          <p className="text-xs text-text-secondary">{active.blurb}</p>
        </header>
        <Content />
      </div>
    </div>
  )
}
