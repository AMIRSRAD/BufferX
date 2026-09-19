/**
 * The Crypto result block (UX_SPEC 3.0 common chrome + 3.3 fix 3).
 *
 * > Results go stale visibly: changing any input greys the result block to 55%,
 * > strikes nothing, and adds `inputs changed` to the provenance line. Stale
 * > results can still be copied — they are just labeled.
 */

import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Kbd } from '@/components/ui/Kbd'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { groupHex } from '@/components/ui/HexInput'

export interface ResultBlockProps {
  /** The value in the representation the operator selected. */
  value: string
  /** Render as grouped byte pairs. */
  isHex: boolean
  /** `AES-128-CBC · encrypt · 32 bytes in / 32 bytes out · padding on · 11:42:07` */
  provenance: string
  stale: boolean
  running: boolean
  /** True once a run has produced a value. */
  hasResult: boolean
  /** The `⇄ / →` action row. */
  actions: ReactNode
}

export function ResultBlock({
  value,
  isHex,
  provenance,
  stale,
  running,
  hasResult,
  actions,
}: ResultBlockProps) {
  return (
    <section
      aria-label="Result"
      className="flex flex-col gap-field rounded-md border border-border bg-surface-inset p-2"
    >
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-2xs font-medium tracking-wide text-text-secondary uppercase">
          Result
        </h3>
        {hasResult && <CopyButton value={value} label="Copy output" />}
      </div>

      {running ? (
        <div className="flex flex-col gap-1" aria-live="polite">
          <Skeleton height={14} />
          <Skeleton height={14} width="70%" />
          <span className="sr-only">Running…</span>
        </div>
      ) : !hasResult ? (
        <EmptyState
          icon={Lock}
          title="No output yet"
          description="Fill the key and the input, then run the operation."
          hint={
            <span className="flex items-center gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd> to encrypt
            </span>
          }
        />
      ) : (
        <div className={cn('flex flex-col gap-1', stale && 'opacity-55')}>
          <output
            className={cn(
              'block max-h-48 overflow-auto rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5',
              'font-mono text-mono-sm break-all whitespace-pre-wrap text-text select-all',
            )}
          >
            {isHex ? groupHex(value, 2) : value}
          </output>
          <p className="text-xs text-text-tertiary">
            <span className="font-mono text-mono-xs">{provenance}</span>
            {stale && (
              <>
                {' · '}
                <span className="text-warn">inputs changed</span>
              </>
            )}
          </p>
        </div>
      )}

      {hasResult && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
    </section>
  )
}
