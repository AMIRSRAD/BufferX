import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onCheckedChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}

/**
 * DESIGN_SYSTEM.md §4.6.
 *
 * Use rule (§4.7): a Checkbox is *a value that will be submitted*
 * (`Include length header on build`). A Switch is *this takes effect now*.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
  name,
  className,
  ...aria
}: CheckboxProps) {
  const reactId = useId()
  const boxId = id ?? `checkbox-${reactId}`
  const descriptionId = description ? `${boxId}-description` : undefined

  const describedBy = [aria['aria-describedby'], descriptionId].filter(Boolean).join(' ')

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <CheckboxPrimitive.Root
        id={boxId}
        name={name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        aria-label={aria['aria-label']}
        aria-describedby={describedBy || undefined}
        className={cn(
          // 14px box, centred inside a 20px line box so it aligns with text-sm.
          'mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-xs border',
          'transition-colors duration-instant ease-standard motion-reduce:transition-none',
          'border-border-strong bg-surface-2',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          'data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <CheckboxPrimitive.Indicator
          forceMount
          className={cn(
            'flex items-center justify-center text-accent-fg',
            'transition-opacity duration-instant ease-standard motion-reduce:transition-none',
            'data-[state=unchecked]:opacity-0',
          )}
        >
          {checked === 'indeterminate' ? (
            <Minus size={10} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
          ) : (
            <Check size={10} strokeWidth={1.75} absoluteStrokeWidth aria-hidden="true" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>

      {(label || description) && (
        <div className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <label
              htmlFor={boxId}
              className={cn(
                'text-sm leading-tight select-none',
                disabled ? 'cursor-not-allowed text-text-disabled' : 'cursor-pointer text-text',
              )}
            >
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="text-xs text-text-tertiary">
              {description}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
