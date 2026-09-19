/**
 * Packager selection, identification and remap reporting (UX_SPEC 2.2).
 *
 * Three surfaces live here:
 *
 * - `PackagerPicker` — the searchable, grouped picker. Every one of the 32
 *   shipped entries is preserved, each row shows the metadata the XML already
 *   carried (`LenLen`, MAC method and size, field count) and the `Desc`
 *   attribute becomes the row subtitle. `Browse…` and `Reload` sit in the
 *   footer, host-gated rather than hidden.
 * - `PackagerCandidates` — replaces "guess and get an error" with a ranked list
 *   of packagers that *do* decode the buffer.
 * - `PackagerRemapSummary` — switching a packager no longer destroys field values;
 *   this states exactly what was re-mapped, what was kept as custom, and what
 *   framing metadata changed.
 */

import { useMemo, useState } from 'react'
import { ChevronDown, FolderOpen, RefreshCw, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Popover } from '@/components/ui/Popover'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { capabilityHint } from '@/engine/protocol'
import { cn } from '@/lib/cn'
import { groupPackagers, packagerSummary, type PackagerInfo } from './model'

/* ── Picker ───────────────────────────────────────────────────────────────── */

export interface PackagerPickerProps {
  value: string
  packagers: readonly PackagerInfo[]
  loading: boolean
  error: string | null
  /** Where the definitions came from, e.g. `data/packagers.xml`. */
  source: string
  canBrowse: boolean
  onSelect(name: string): void
  onReload(): void
  onBrowse(): void
}

function matches(info: PackagerInfo, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return (
    info.name.toLowerCase().includes(needle) ||
    (info.desc ?? '').toLowerCase().includes(needle)
  )
}

export function PackagerPicker({
  value,
  packagers,
  loading,
  error,
  source,
  canBrowse,
  onSelect,
  onReload,
  onBrowse,
}: PackagerPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const filtered = packagers.filter((info) => matches(info, query))
    return groupPackagers(filtered)
  }, [packagers, query])

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setQuery('')
      }}
      align="start"
      padded={false}
      trigger={
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Packager: ${value || 'none selected'}. Choose a packager.`}
          className={cn(
            'flex h-control-sm shrink-0 items-center gap-1 rounded-sm border border-border-strong',
            'bg-surface-2 px-2 font-mono text-mono-sm text-text shadow-e1 hover:bg-surface-raised',
          )}
        >
          {value || '—'}
          <ChevronDown size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
        </button>
      }
    >
      <div className="flex w-96 flex-col">
        <div className="border-b border-border-subtle p-1.5">
          <Input
            value={query}
            onValueChange={setQuery}
            autoFocus
            placeholder="Search packagers…"
            aria-label="Search packagers"
            prefix={
              <Search size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            }
            suffix={
              <span className="text-2xs text-text-tertiary tabular-nums">{total}</span>
            }
          />
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {loading ? (
            <div className="flex flex-col gap-1 p-1.5">
              <Skeleton height={22} />
              <Skeleton height={22} />
              <Skeleton height={22} />
              <Skeleton height={22} />
              <Skeleton height={22} />
              <Skeleton height={22} />
            </div>
          ) : total === 0 ? (
            <p className="px-2 py-3 text-sm text-text-tertiary">
              {packagers.length === 0
                ? 'No packagers are loaded. Use Browse… to open a packager XML.'
                : `No packager matches “${query}”.`}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.label}>
                <h3 className="sticky top-0 bg-surface-3 px-2 py-0.5 text-2xs tracking-wide text-text-tertiary uppercase">
                  {group.label}
                </h3>
                <ul>
                  {group.items.map((info) => (
                    <li key={info.name}>
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(info.name)
                          setOpen(false)
                        }}
                        aria-current={info.name === value ? 'true' : undefined}
                        className={cn(
                          'flex w-full flex-col items-start gap-0 px-2 py-1 text-left',
                          info.name === value
                            ? 'bg-accent-muted text-text'
                            : 'text-text-secondary hover:bg-surface-raised hover:text-text',
                        )}
                      >
                        <span className="flex w-full items-baseline gap-2">
                          <span className="font-mono text-mono-sm text-text">{info.name}</span>
                          <span className="truncate text-2xs text-text-tertiary">
                            {packagerSummary(info)}
                          </span>
                        </span>
                        {info.desc ? (
                          <span className="truncate text-2xs text-text-tertiary">{info.desc}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        {error ? (
          <p className="border-t border-border-subtle px-2 py-1 text-xs text-error">{error}</p>
        ) : null}

        <div className="flex items-center gap-field border-t border-border-subtle px-2 py-1.5">
          <span className="min-w-0 flex-1 truncate font-mono text-mono-xs text-text-tertiary">
            Source: {source}
          </span>
          <Tooltip
            content={
              canBrowse
                ? 'Open a packager XML from disk.'
                : capabilityHint('files')
            }
          >
            <span>
              <Button size="xs" icon={FolderOpen} onClick={onBrowse} disabled={!canBrowse}>
                Browse…
              </Button>
            </span>
          </Tooltip>
          <Button size="xs" icon={RefreshCw} onClick={onReload}>
            Reload
          </Button>
        </div>
      </div>
    </Popover>
  )
}

/* ── Candidates banner ────────────────────────────────────────────────────── */

export interface PackagerCandidate {
  name: string
  fields: number
  errors: number
  consumed: number
  total: number
}

export interface PackagerCandidatesProps {
  current: string
  candidates: readonly PackagerCandidate[]
  /** Present while a sweep is running: `Identify packager · 14 / 32`. */
  progress: { done: number; total: number } | null
  onUse(name: string): void
  onIdentifyAgain(): void
  onCancel(): void
  onDismiss(): void
}

export function PackagerCandidates({
  current,
  candidates,
  progress,
  onUse,
  onIdentifyAgain,
  onCancel,
  onDismiss,
}: PackagerCandidatesProps) {
  return (
    <div className="shrink-0 rounded-md border border-warn-border bg-warn-bg p-panel">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-base text-text">
          <span className="font-mono text-mono-base">{current}</span> could not decode this buffer.
          {candidates.length > 0 ? ' Candidates ranked by fit:' : ''}
        </p>
        <Button size="xs" variant="ghost" icon={X} onClick={onDismiss} aria-label="Dismiss and show the error">
          Dismiss
        </Button>
      </div>

      {progress ? (
        <p className="mt-1 font-mono text-mono-xs text-text-secondary tabular-nums">
          Identify packager · {progress.done} / {progress.total}
        </p>
      ) : null}

      {candidates.length === 0 && !progress ? (
        <p className="mt-1 text-sm text-text-secondary">
          No packager in the loaded XML decoded this buffer. Check the framing controls, or open a
          different packager file.
        </p>
      ) : null}

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {candidates.map((candidate, index) => (
          <li
            key={candidate.name}
            className="flex items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-surface-raised"
          >
            <span aria-hidden="true" className="text-text-tertiary">
              {index === 0 ? '●' : '○'}
            </span>
            <span className="w-24 shrink-0 font-mono text-mono-sm text-text">{candidate.name}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-text-secondary tabular-nums">
              {candidate.fields} field{candidate.fields === 1 ? '' : 's'}, {candidate.errors} error
              {candidate.errors === 1 ? '' : 's'}
              {candidate.total > 0
                ? `, ${candidate.consumed}/${candidate.total} bytes consumed`
                : ''}
            </span>
            <Button size="xs" variant="primary" onClick={() => onUse(candidate.name)}>
              Use
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-1.5 flex items-center gap-field">
        {progress ? (
          <Button size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <Button size="xs" variant="ghost" onClick={onIdentifyAgain}>
            Identify again
          </Button>
        )}
        <span className="ml-auto text-2xs text-text-tertiary">
          Ranked by fields decoded, then bytes consumed, then errors.
        </span>
      </div>
    </div>
  )
}

/* ── Remap card ───────────────────────────────────────────────────────────── */

export interface PackagerRemapSummary {
  from: string
  to: string
  /** Fields the new packager defines. */
  mapped: number
  /** Fields kept but not defined by the new packager. */
  custom: number[]
  /** One line per metadata change, e.g. `Header size 4 → 7 (LenLen)`. */
  changes: string[]
}

