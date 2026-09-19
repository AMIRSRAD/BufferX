/**
 * The three reference sheets About links to: the keyboard shortcut reference,
 * the licence text, and the documentation set (UX_SPEC 3.9 → Diagnostics /
 * About; 4.2 for the shortcut map).
 *
 * These are non-blocking reference dialogs, the same class as the shell's
 * `Ctrl+/` sheet — not the two data-loss confirmations UX_SPEC 5.1 restricts
 * modals to. Nothing here mutates state; `Esc` closes and nothing is lost.
 *
 * The shortcut table renders `SHORTCUTS` from the shell, so this sheet can
 * never drift from the bindings the app actually installs.
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Kbd } from '@/components/ui/Kbd'
import { SHORTCUTS, formatShortcut, type ShortcutDescriptor } from '@/shell/useShortcuts'
import { DOCUMENTS, LICENCE_PLAIN_TEXT, LICENCE_TEXT, PRODUCT } from './identity'

/* ── Keyboard shortcuts ───────────────────────────────────────────────────── */

function groupByScope(entries: readonly ShortcutDescriptor[]): [string, ShortcutDescriptor[]][] {
  const map = new Map<string, ShortcutDescriptor[]>()
  for (const entry of entries) {
    const list = map.get(entry.scope)
    if (list) list.push(entry)
    else map.set(entry.scope, [entry])
  }
  return Array.from(map.entries())
}

/** The whole map as plain text, for the copy-all button. */
function shortcutsAsText(entries: readonly ShortcutDescriptor[]): string {
  return entries.map((entry) => `${formatShortcut(entry.keys)}\t${entry.action}\t${entry.scope}`).join('\n')
}

export function ShortcutReferenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return SHORTCUTS
    return SHORTCUTS.filter(
      (entry) =>
        entry.action.toLowerCase().includes(needle) ||
        entry.scope.toLowerCase().includes(needle) ||
        entry.keys.toLowerCase().includes(needle) ||
        formatShortcut(entry.keys).toLowerCase().includes(needle),
    )
  }, [query])

  const groups = useMemo(() => groupByScope(matches), [matches])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Keyboard shortcuts"
      description="Every action reachable by mouse is reachable by keyboard. Ctrl+/ opens this sheet from anywhere."
      footer={
        <CopyButton
          value={shortcutsAsText(SHORTCUTS)}
          label="Copy all shortcuts"
          size="sm"
          variant="default"
          showLabel
        />
      }
    >
      <div className="flex flex-col gap-group">
        <Input
          value={query}
          onValueChange={setQuery}
          size="sm"
          placeholder="Filter shortcuts…"
          aria-label="Filter shortcuts"
          prefix={<Search size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />}
        />

        {groups.length === 0 ? (
          <EmptyState
            title="No shortcut matches that."
            description={`Nothing in the keyboard map contains “${query.trim()}”.`}
          />
        ) : (
          groups.map(([scope, entries]) => (
            <section key={scope} className="flex flex-col gap-1">
              <h3 className="text-2xs tracking-wide text-text-tertiary uppercase">{scope}</h3>
              <table className="w-full">
                <caption className="sr-only">{scope} shortcuts</caption>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={`${scope}:${entry.keys}`} className="border-b border-border-subtle last:border-b-0">
                      <th
                        scope="row"
                        className="w-52 py-cell-y pr-cell-x text-left font-mono text-mono-sm font-normal text-text"
                      >
                        {formatShortcut(entry.keys)}
                      </th>
                      <td className="py-cell-y text-sm text-text-secondary">{entry.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))
        )}
      </div>
    </Dialog>
  )
}

/* ── Licence ──────────────────────────────────────────────────────────────── */

export function LicenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Licence"
      description={`${PRODUCT.name} is proprietary software. This is the LICENSE file that ships with it.`}
      footer={
        <CopyButton
          value={LICENCE_PLAIN_TEXT}
          label="Copy licence text"
          size="sm"
          variant="default"
          showLabel
        />
      }
    >
      <div className="flex flex-col gap-field rounded-sm border border-border-subtle bg-surface-inset p-panel">
        {LICENCE_TEXT.map((paragraph) => (
          <p key={paragraph} className="text-sm break-words text-text-secondary">
            {paragraph}
          </p>
        ))}
      </div>
    </Dialog>
  )
}

/* ── Documentation ────────────────────────────────────────────────────────── */

/** The docs list as plain text, so an operator can paste the paths somewhere. */
function documentsAsText(): string {
  return DOCUMENTS.map((doc) => `${doc.title}\t${doc.path}`).join('\n')
}

export function DocumentationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange(open: boolean): void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Documentation"
      description="The documentation ships with the source rather than on a website. These are repository paths."
      footer={
        <CopyButton value={documentsAsText()} label="Copy all paths" size="sm" variant="default" showLabel />
      }
    >
      <ul className="flex flex-col gap-field">
        {DOCUMENTS.map((doc) => (
          <li
            key={doc.path}
            className="flex items-start justify-between gap-group rounded-sm border border-border-subtle bg-surface-inset p-panel"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-text">{doc.title}</span>
              <span className="font-mono text-mono-xs break-all text-text-secondary">{doc.path}</span>
              <span className="text-xs text-text-tertiary">{doc.summary}</span>
            </div>
            <CopyButton value={doc.path} label={`Copy path to ${doc.title}`} size="xs" variant="ghost" />
          </li>
        ))}
      </ul>
      <p className="pt-field text-xs text-text-tertiary">
        Open them from the repository checkout. Press <Kbd>Ctrl</Kbd> <Kbd>/</Kbd> for the keyboard map.
      </p>
    </Dialog>
  )
}
