import { Children, cloneElement, isValidElement, useId, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FieldProps {
  label: ReactNode
  /** Constraint, not concept: `8, 16, or 24 bytes hex`. §7 rule 14. */
  hint?: ReactNode
  /** Renders inline beneath the control — never in a status bar. §4.2. */
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  children: ReactNode
  className?: string
}

/** Props a Field will inject into a single element child. */
interface InjectableChildProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  required?: boolean
}

/**
 * Label + control + hint/error wrapper.
 *
 * When `children` is a single element, the control's `id`, `aria-describedby`,
 * and `aria-invalid` are wired automatically. Pass multiple children and the
 * wiring is yours — the ids are still stable and derived from `htmlFor`.
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  children,
  className,
}: FieldProps) {
  const reactId = useId()
  const controlId = htmlFor ?? `field-${reactId}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ')

  let control: ReactNode = children
  if (Children.count(children) === 1 && isValidElement<InjectableChildProps>(children)) {
    const existing = children.props['aria-describedby']
    control = cloneElement(children, {
      id: children.props.id ?? controlId,
      'aria-describedby': [existing, describedBy].filter(Boolean).join(' ') || undefined,
      'aria-invalid': error ? true : children.props['aria-invalid'],
      required: required || children.props.required,
    })
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={controlId} className="flex items-center gap-1 text-xs text-text-secondary">
        {label}
        {required && (
          <span className="text-error" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">(required)</span>}
      </label>

      {control}

      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-xs text-error">
          <AlertCircle
            size={14}
            strokeWidth={1.25}
            absoluteStrokeWidth
            className="mt-px shrink-0"
            aria-hidden="true"
          />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-text-tertiary">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
