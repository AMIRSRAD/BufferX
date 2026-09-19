import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button, ICON_PX, ICON_STROKE, type ButtonVariant, type ControlSize } from './Button'
import { Tooltip } from './Tooltip'

export interface CopyButtonProps {
  /**
   * The text to place on the clipboard.
   *
   * Never a key, PIN, PAN, or PEM body — §4.24 forbids a copy button on a
   * secret input; expose the KCV instead.
   */
  value: string
  label?: string
  size?: ControlSize
  variant?: ButtonVariant
  /** Render the label next to the glyph instead of icon-only. */
  showLabel?: boolean
  className?: string
  onCopied?: (value: string) => void
}

const FEEDBACK_MS = 1200

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path — a denied permission is not a failure
    // the operator can act on, but a stale execCommand often still works.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * DESIGN_SYSTEM.md §4.24.
 *
 * Always in the tab order (hover-only affordances are keyboard-invisible), and
 * the outcome is announced via `aria-live` rather than a toast.
 */
export function CopyButton({
  value,
  label = 'Copy',
  size = 'xs',
  variant = 'ghost',
  showLabel = false,
  className,
  onCopied,
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [announcement, setAnnouncement] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const handleCopy = async () => {
    const ok = await writeClipboard(value)
    const bytes = new TextEncoder().encode(value).length
    setState(ok ? 'copied' : 'failed')
    setAnnouncement(ok ? `Copied ${bytes} bytes` : 'Copy failed')
    if (ok) onCopied?.(value)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setState('idle')
      setAnnouncement('')
    }, FEEDBACK_MS)
  }

  const Icon = state === 'copied' ? Check : state === 'failed' ? AlertTriangle : Copy
  const tooltip = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label

  return (
    <>
      <Tooltip content={tooltip}>
        <Button
          size={size}
          variant={variant}
          aria-label={label}
          onClick={handleCopy}
          className={cn(!showLabel && 'aspect-square px-0', className)}
        >
          <Icon
            size={ICON_PX[size]}
            strokeWidth={ICON_STROKE[size]}
            absoluteStrokeWidth
            aria-hidden="true"
            className={cn(state === 'copied' && 'text-ok', state === 'failed' && 'text-error')}
          />
          {showLabel && label}
        </Button>
      </Tooltip>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </>
  )
}
