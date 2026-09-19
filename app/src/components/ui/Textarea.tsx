import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
  mono?: boolean
  rows?: number
  invalid?: boolean
  /** Grows with content up to 40vh (§4.3), then scrolls internally. */
  autoResize?: boolean
  containerClassName?: string
}

/** §4.3: a textarea never has a hard pixel cap that fights the window. */
const MAX_AUTO_HEIGHT_RATIO = 0.4

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    value,
    onValueChange,
    mono = false,
    rows = 3,
    invalid = false,
    autoResize = false,
    className,
    containerClassName,
    disabled,
    readOnly,
    ...rest
  },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  useLayoutEffect(() => {
    if (!autoResize) return
    const el = innerRef.current
    if (!el) return
    el.style.height = 'auto'
    const cap = window.innerHeight * MAX_AUTO_HEIGHT_RATIO
    const next = Math.min(el.scrollHeight, cap)
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden'
  }, [autoResize, value])

  return (
    <div
      data-disabled={disabled ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      className={cn(
        'flex min-h-0 w-full flex-col rounded-sm border px-2 py-1',
        'transition-colors duration-fast ease-standard motion-reduce:transition-none',
        disabled
          ? 'border-border-subtle bg-surface-1'
          : readOnly
            ? 'border-border bg-surface-1'
            : 'bg-surface-2',
        !disabled && !readOnly && (invalid ? 'border-error' : 'border-border-strong'),
        !disabled &&
          'has-[textarea:focus-visible]:border-accent has-[textarea:focus-visible]:shadow-focus',
        containerClassName,
      )}
    >
      <textarea
        ref={setRefs}
        value={value}
        rows={rows}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'min-h-0 w-full flex-1 bg-transparent text-text caret-accent outline-none',
          'placeholder:text-text-tertiary placeholder:not-italic',
          autoResize ? 'resize-none' : 'resize-y',
          mono ? 'font-mono text-mono-base' : 'text-sm',
          disabled && 'cursor-not-allowed text-text-disabled',
          className,
        )}
        {...rest}
      />
    </div>
  )
})
