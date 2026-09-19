/**
 * The MAC result block (UX_SPEC 3.1).
 *
 * The single fix this component exists for: Calculate and Verify no longer
 * share one output slot. A calculated MAC and a verification verdict are two
 * results with two lifetimes, rendered as two blocks, each carrying its own
 * copy affordance and its own staleness.
 */

import { Check, RotateCw, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { Kbd } from '@/components/ui/Kbd'
import { cn } from '@/lib/cn'
import {
  diffMac,
  groupMac,
  mismatchSummary,
  splitBytes,
  type CalculatedResult,
  type VerificationResult,
} from './macModel'

export interface MacResultBlockProps {
  calculated: CalculatedResult | null
  verification: VerificationResult | null
  /** Signature of the inputs as they stand right now. */
  currentSignature: string
  /** The muted 11px line under each result. */
  provenance: string
  bufferName: string
  onRerun: () => void
  rerunDisabled: boolean
}

/** Renders hex in two-byte groups, tinting the bytes that differ. */
function HexBytes({
  hex,
  differing,
  tone,
}: {
  hex: string
  differing?: ReadonlySet<number>
  tone: 'neutral' | 'ok' | 'error'
}) {
  const bytes = splitBytes(hex)
  if (bytes.length === 0) return <span className="text-text-tertiary">—</span>

  return (
    <span
      className={cn(
        'font-mono text-mono-base tracking-wide break-all',
        tone === 'ok' && 'text-ok',
        tone === 'error' && 'text-error',
        tone === 'neutral' && 'text-text',
      )}
    >
      {bytes.map((byte, index) => (
        <span key={index}>
          <span
            className={cn(
              differing?.has(index) &&
                'rounded-xs bg-error-bg text-error underline decoration-dotted underline-offset-2',
            )}
          >
            {byte}
          </span>
          {index % 2 === 1 && index < bytes.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}

function ResultRow({
  label,
  hex,
  note,
  differing,
  tone = 'neutral',
  copyLabel,
}: {
  label: string
  hex: string
  note?: string
  differing?: ReadonlySet<number>
  tone?: 'neutral' | 'ok' | 'error'
  copyLabel: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-0.5 text-xs text-text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <HexBytes hex={hex} differing={differing} tone={tone} />
        {note && <span className="text-2xs text-text-tertiary">{note}</span>}
      </div>
      <CopyButton value={hex} label={copyLabel} size="xs" variant="ghost" />
    </div>
  )
}

function Provenance({ text, stale }: { text: string; stale: boolean }) {
  return (
    <p className="text-2xs text-text-tertiary">
      {text}
      {stale && ' · inputs changed'}
    </p>
  )
}

export function MacResultBlock({
  calculated,
  verification,
  currentSignature,
  provenance,
  bufferName,
  onRerun,
  rerunDisabled,
}: MacResultBlockProps) {
  const calculatedStale = calculated !== null && calculated.signature !== currentSignature
  const verificationStale = verification !== null && verification.signature !== currentSignature

  const diff = verification ? diffMac(verification.expectedHex, verification.actualHex) : null

  const copyAll = [
    calculated ? `Calculated\t${calculated.hex}` : null,
    verification ? `Received\t${verification.actualHex}` : null,
    verification ? `Expected\t${verification.expectedHex}` : null,
    verification && !verificationStale
      ? `Verdict\t${verification.valid ? 'MATCH' : diff ? mismatchSummary(diff) : 'MISMATCH'}`
      : null,
    provenance,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  const hasResult = calculated !== null || verification !== null

  return (
    <section
      aria-label="MAC result"
      className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-inset p-panel"
    >
      <header className="flex items-center gap-2">
        <h3 className="flex-1 text-2xs tracking-wider text-text-tertiary uppercase">Result</h3>
        {hasResult && <CopyButton value={copyAll} label="Copy all results" size="xs" variant="ghost" />}
        <IconButton
          icon={RotateCw}
          size="xs"
          variant="ghost"
          label="Re-run the last action"
          onClick={onRerun}
          disabled={rerunDisabled}
        />
      </header>

      {!hasResult && (
        <p className="text-sm text-text-secondary">
          No MAC yet. Calculate one over {bufferName}. <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
        </p>
      )}

      {calculated && (
        <div
          className={cn(
            'flex flex-col gap-1.5 transition-opacity duration-fast ease-standard motion-reduce:transition-none',
            calculatedStale && 'opacity-55',
          )}
        >
          <ResultRow label="Calculated" hex={calculated.hex} copyLabel="Copy calculated MAC" />
          <Provenance text={provenance} stale={calculatedStale} />
        </div>
      )}

      {calculated && verification && <div className="border-t border-border-subtle" />}

      {verification && diff && (
        <div
          className={cn(
            'flex flex-col gap-1.5 transition-opacity duration-fast ease-standard motion-reduce:transition-none',
            verificationStale && 'opacity-55',
          )}
        >
          <ResultRow
            label="Received"
            hex={verification.actualHex}
            note={`from F${verification.fieldId} in ${bufferName}`}
            differing={verification.valid ? undefined : diff.differing}
            copyLabel="Copy received MAC"
          />
          <ResultRow
            label="Expected"
            hex={verification.expectedHex}
            differing={verification.valid ? undefined : diff.differing}
            copyLabel="Copy expected MAC"
          />

          <div className="flex items-center gap-2 pl-22">
            {verificationStale ? (
              <>
                <Badge tone="neutral">Verdict cleared</Badge>
                <span className="text-2xs text-text-tertiary">
                  An input changed after this run. Verify again.
                </span>
              </>
            ) : verification.valid ? (
              <>
                <Badge tone="ok">
                  <Check size={12} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
                  MATCH
                </Badge>
                <span className="text-2xs text-ok">
                  {groupMac(verification.expectedHex)} confirmed
                </span>
              </>
            ) : (
              <>
                <Badge tone="error">
                  <X size={12} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" />
                  MISMATCH
                </Badge>
                <span className="text-2xs text-error">{mismatchSummary(diff)}</span>
              </>
            )}
          </div>

          <Provenance text={provenance} stale={verificationStale} />
        </div>
      )}

    </section>
  )
}
