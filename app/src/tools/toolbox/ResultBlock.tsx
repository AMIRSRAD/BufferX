import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { groupHex } from '@/components/ui/HexInput'
import { isPositiveVerdict, type OperationDef } from './operations'

export interface ResultBlockProps {
  operation: OperationDef
  output: string
  /** Provenance line: what ran, on how much data. */
  meta: string
  /** `⇄ send output to input`. Absent ⇒ the button renders disabled. */
  onChain?: () => void
  chainDisabledReason?: string
}

/** Matches SecretInput: a revealed secret relocks itself after 15 seconds. */
const REVEAL_SECONDS = 15

/**
 * The result surface (UX_SPEC 3.7).
 *
 * Every result is copyable. A result that *is* key material — `Random Key`,
 * `Adjust Odd Parity` — renders masked with the same reveal/relock discipline
 * as `SecretInput`, but keeps its copy button: a key generator whose output
 * cannot leave the panel is not a key generator.
 */
export function ResultBlock({
  operation,
  output,
  meta,
  onChain,
  chainDisabledReason,
}: ResultBlockProps) {
  const secret = operation.result.kind === 'secret'
  const [revealed, setRevealed] = useState(false)
  const [remaining, setRemaining] = useState(REVEAL_SECONDS)

  const relock = useCallback(() => {
    setRevealed(false)
    setRemaining(REVEAL_SECONDS)
  }, [])

  useEffect(() => {
    if (!revealed) return
    setRemaining(REVEAL_SECONDS)
    const tick = window.setInterval(() => {
      setRemaining((seconds) => {
        if (seconds <= 1) {
          window.clearInterval(tick)
          setRevealed(false)
          return REVEAL_SECONDS
        }
        return seconds - 1
      })
    }, 1000)
    const onHide = () => relock()
    window.addEventListener('blur', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('blur', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [revealed, relock])

  // A new result always starts masked.
  useEffect(() => relock(), [output, relock])

  const hexLike = operation.result.kind === 'hex' || secret
  const display = hexLike ? groupHex(output, 2) : output
  const masked = secret && !revealed

  return (
    <section aria-label="Result" className="flex flex-col gap-1.5">
      <header className="flex items-center gap-2">
        <h3 className="text-2xs font-medium tracking-wide text-text-tertiary uppercase">
          {operation.result.label}
        </h3>

        {secret && (
          <Badge tone={revealed ? 'warn' : 'neutral'}>
            {revealed ? `revealed ${remaining}s` : 'masked'}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          {secret && (
            <IconButton
              icon={revealed ? EyeOff : Eye}
              size="xs"
              variant="ghost"
              label={revealed ? `Hide result (relocks in ${remaining}s)` : 'Reveal result for 15 seconds'}
              aria-pressed={revealed}
              onClick={() => (revealed ? relock() : setRevealed(true))}
            />
          )}

          {onChain ? (
            <Tooltip content="Send output to input">
              <IconButton
                icon={ArrowLeftRight}
                size="xs"
                variant="ghost"
                label="Send output to input"
                tooltip={false}
                onClick={onChain}
              />
            </Tooltip>
          ) : (
            <Tooltip content={chainDisabledReason ?? 'This operation has no input to chain into.'}>
              <IconButton
                icon={ArrowLeftRight}
                size="xs"
                variant="ghost"
                label="Send output to input"
                tooltip={false}
                disabled
              />
            </Tooltip>
          )}

          <CopyButton value={output} label={`Copy ${operation.result.label.toLowerCase()}`} size="xs" />
        </div>
      </header>

      {operation.result.kind === 'verdict' ? (
        <div className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface-inset px-2 py-2">
          <Badge tone={isPositiveVerdict(output) ? 'ok' : 'error'} dot>
            {output}
          </Badge>
          <span className="text-xs text-text-secondary">
            {isPositiveVerdict(output)
              ? 'The engine accepted this value.'
              : 'The engine rejected this value.'}
          </span>
        </div>
      ) : (
        <output
          data-sensitive={secret ? 'true' : undefined}
          className={cn(
            'block rounded-sm border border-border-subtle bg-surface-inset px-2 py-2',
            'max-h-56 overflow-auto font-mono text-mono-base break-all whitespace-pre-wrap text-text',
            output.length === 0 && 'text-text-tertiary',
          )}
        >
          {output.length === 0 ? '(empty result)' : masked ? '•'.repeat(Math.min(display.length, 64)) : display}
        </output>
      )}

      <p className="text-xs text-text-tertiary">{meta}</p>
    </section>
  )
}
