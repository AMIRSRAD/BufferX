/**
 * Settings → Keyboard (UX_SPEC 3.9).
 *
 * "Full shortcut sheet, searchable, with rebinding. Conflicts are flagged,
 * including browser-reserved conflicts on the web build."
 *
 * The sheet and the conflict flags are here. Rebinding is rendered but disabled
 * with its reason: `SHORTCUTS` in `@/shell/useShortcuts` is a constant map read
 * by a single `keydown` handler, so there is nothing for this panel to write to.
 * A rebindable map is a shell change, and this tool may not make it — so the
 * control states that instead of pretending.
 */

import { useMemo, useState } from 'react'
import { KeyRound, Search } from 'lucide-react'
import { SHORTCUTS, formatShortcut, type ShortcutDescriptor } from '@/shell/useShortcuts'
import { hostCapabilities } from '@/engine/client'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Kbd } from '@/components/ui/Kbd'
import { Tooltip } from '@/components/ui/Tooltip'
import { SectionCard } from './parts'

/**
 * Chords a browser keeps for itself. A page cannot `preventDefault` these, so on
 * the web build a binding that used one would simply never fire.
 */
const BROWSER_RESERVED = new Set([
  'Ctrl+T',
  'Ctrl+N',
  'Ctrl+W',
  'Ctrl+Shift+T',
  'Ctrl+Shift+N',
  'Ctrl+Shift+W',
  'Ctrl+Tab',
  'Ctrl+Shift+Tab',
  'Ctrl+1',
  'Ctrl+2',
  'Ctrl+3',
  'Ctrl+4',
  'Ctrl+5',
  'Ctrl+6',
  'Ctrl+7',
  'Ctrl+8',
  'Ctrl+9',
])

/**
 * Chords the browser owns by default but that a page is allowed to take over.
 * On the web build these work, and the browser's own action is suppressed.
 */
const BROWSER_OVERRIDDEN = new Set(['Ctrl+S', 'Ctrl+O', 'Ctrl+F', 'Ctrl+P', 'Ctrl+/'])

type Verdict = 'ok' | 'reserved' | 'overridden'

function verdictFor(keys: string, web: boolean): Verdict {
  if (!web) return 'ok'
  if (BROWSER_RESERVED.has(keys)) return 'reserved'
  if (BROWSER_OVERRIDDEN.has(keys)) return 'overridden'
  return 'ok'
}

/**
 * Splits `Ctrl+Shift+Enter` into key caps.
 *
 * Entries that describe a *family* of bindings rather than one chord
 * (`Alt+1 … Alt+9, Alt+0`, `F6 / Shift+F6`) are left as a single cap: chopping
 * them at `+` would produce nonsense caps.
 */
function keyCaps(keys: string): string[] {
  const display = formatShortcut(keys)
  if (/[…/,]|\s/.test(display)) return [display]
  return display
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export function KeyboardSection() {
  const web = !hostCapabilities().desktop
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return SHORTCUTS
    return SHORTCUTS.filter((entry) =>
      `${entry.keys} ${entry.action} ${entry.scope}`.toLowerCase().includes(needle),
    )
  }, [query])

  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutDescriptor[]>()
    for (const entry of matches) {
      const list = map.get(entry.scope) ?? []
      list.push(entry)
      map.set(entry.scope, list)
    }
    return [...map.entries()]
  }, [matches])

  const conflicts = SHORTCUTS.filter((entry) => verdictFor(entry.keys, web) === 'reserved')
  const overridden = SHORTCUTS.filter((entry) => verdictFor(entry.keys, web) === 'overridden')

  const sheetText = SHORTCUTS.map((entry) => `${entry.keys}\t${entry.action}\t${entry.scope}`).join('\n')

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Conflicts"
        description={web ? 'Checked against what a browser reserves.' : 'The desktop build receives every chord.'}
      >
        {conflicts.length === 0 ? (
          <InlineAlert tone="ok" title="No conflicts">
            {web
              ? 'Every binding avoids the chords Chrome, Edge, Firefox and Safari keep for themselves — that is why the map uses Alt+N, Alt+W and Alt+[ / Alt+] rather than the Ctrl equivalents.'
              : 'Nothing competes with this build for a chord.'}
          </InlineAlert>
        ) : (
          <InlineAlert tone="error" title={`${String(conflicts.length)} binding(s) are browser-reserved`}>
            {conflicts.map((entry) => `${entry.keys} (${entry.action})`).join(', ')}
          </InlineAlert>
        )}

        {web && overridden.length > 0 ? (
          <InlineAlert tone="info" title={`${String(overridden.length)} binding(s) override a browser default`}>
            {overridden.map((entry) => `${entry.keys} → ${entry.action}`).join(' · ')}. BufferX suppresses the
            browser action while the app has focus.
          </InlineAlert>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Shortcut sheet"
        description="Also available anywhere with Ctrl+/."
        action={<CopyButton value={sheetText} label="Copy sheet" size="xs" variant="ghost" />}
      >
        <Input
          value={query}
          onValueChange={setQuery}
          placeholder="Filter by key, action or scope…"
          aria-label="Filter shortcuts"
          prefix={<Search size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
        />

        {grouped.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No shortcut matches"
            description={`Nothing in the map contains "${query}".`}
            action={
              <Button size="xs" onClick={() => setQuery('')}>
                Clear filter
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-field">
            {grouped.map(([scope, entries]) => (
              <div key={scope} className="flex flex-col gap-0.5">
                <h4 className="text-2xs tracking-wide text-text-tertiary uppercase">{scope}</h4>
                <ul className="flex flex-col">
                  {entries.map((entry) => {
                    const verdict = verdictFor(entry.keys, web)
                    return (
                      <li
                        key={`${entry.scope}:${entry.keys}:${entry.action}`}
                        className="flex items-center gap-group border-b border-border-subtle py-cell-y last:border-b-0"
                      >
                        <span className="flex min-w-40 shrink-0 flex-wrap items-center gap-0.5">
                          {keyCaps(entry.keys).map((cap, index) => (
                            <Kbd key={`${entry.keys}:${cap}:${String(index)}`}>{cap}</Kbd>
                          ))}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-text">{entry.action}</span>
                        {verdict === 'reserved' ? <Badge tone="error">browser-reserved</Badge> : null}
                        {verdict === 'overridden' ? <Badge tone="info">overrides browser</Badge> : null}
                        <Tooltip content="Rebinding needs a writable binding map in the shell; this build's map is a constant read by one keydown handler.">
                          <span>
                            <Button size="xs" variant="ghost" disabled>
                              Rebind
                            </Button>
                          </span>
                        </Tooltip>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}
