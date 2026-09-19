/**
 * The `Recent runs` disclosure (UX_SPEC 3.3).
 *
 * > A `Recent runs` disclosure lists the last 20 operations as
 * > `AES-128-CBC · encrypt · 32 in / 32 out · 11:42:07` with a `re-run` action.
 * > **Keys are not stored in history** — re-run re-uses the key currently in
 * > the field and says so if it is empty.
 *
 * `CryptoRun` therefore has no key field, by construction: the type cannot
 * carry one. The history lives in component state and is never persisted
 * (UX_SPEC 5.5) — it still holds payloads, which can be real message content.
 */

import { useId, useState } from 'react'
import { ChevronRight, History, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/cn'
import type { CryptoAlgorithm, CryptoOperation } from './algorithms'

/** One completed run. Deliberately has no `keyHex` member. */
export interface CryptoRun {
  id: string
  algorithm: CryptoAlgorithm
  operation: CryptoOperation
  /** Input as it was submitted: cleaned hex, or the text verbatim. */
  payload: string
  inputHex: boolean
  outputHex: boolean
  usePadding: boolean
  /** IV hex. Not a secret — it is public material by definition. */
  ivHex: string
  inBytes: number
  outBytes: number
  at: number
}

export const RECENT_RUN_LIMIT = 20

export function makeRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clockTime(at: number): string {
  const date = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export interface RecentRunsProps {
  runs: readonly CryptoRun[]
  /** Restores the run's inputs and executes it with the key currently typed. */
  onRerun: (run: CryptoRun) => void
  onClear: () => void
  /** Drives the `key field is empty` note — never the key itself. */
  keyPresent: boolean
}

export function RecentRuns({ runs, onRerun, onClear, keyPresent }: RecentRunsProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()

  return (
    <section className="flex flex-col gap-field border-t border-border-subtle pt-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            'flex min-h-6 flex-1 items-center gap-1.5 rounded-xs text-left',
            'text-2xs font-medium tracking-wide text-text-secondary uppercase',
            'hover:text-text',
          )}
        >
          <ChevronRight
            size={14}
            strokeWidth={1.25}
            absoluteStrokeWidth
            aria-hidden="true"
            className={cn(
              'shrink-0 transition-transform duration-fast ease-standard motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
          Recent runs
          <span className="font-mono text-mono-xs text-text-tertiary tabular-nums">({runs.length})</span>
        </button>

        {open && runs.length > 0 && (
          <Button size="xs" variant="ghost" onClick={onClear}>
            Clear history
          </Button>
        )}
      </div>

      {open && (
        <div id={listId}>
          {runs.length === 0 ? (
            <EmptyState
              icon={History}
              title="No runs yet"
              description="Encrypt or decrypt something and the last 20 runs are listed here. Keys are never kept."
            />
          ) : (
            <>
              <ul className="flex flex-col rounded-sm border border-border-subtle">
                {runs.map((run) => (
                  <li
                    key={run.id}
                    className="flex items-center gap-2 border-b border-border-subtle px-2 py-1 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-mono-xs text-text-secondary">
                      <span className="text-text">{run.algorithm}</span>
                      {' · '}
                      {run.operation}
                      {' · '}
                      {run.inBytes} in / {run.outBytes} out
                      {' · '}
                      {clockTime(run.at)}
                    </span>
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={RotateCcw}
                      onClick={() => onRerun(run)}
                      title={`Re-run ${run.algorithm} ${run.operation} with the key currently in the field`}
                    >
                      Re-run
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-text-tertiary">
                {keyPresent
                  ? 'Re-run uses the key currently in the Key field. Keys are never stored in history.'
                  : 'The Key field is empty — fill it before re-running. Keys are never stored in history.'}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
