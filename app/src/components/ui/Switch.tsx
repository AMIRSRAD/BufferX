import * as SwitchPrimitive from '@radix-ui/react-switch'
import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
}

/**
 * DESIGN_SYSTEM.md §4.7. Track 28×16, thumb 12px.
 *
 * A Switch means "this takes effect immediately and changes system behaviour"
 * — e.g. `Legacy ATM Engine`, which also pins a `LEGACY ENGINE` warn badge in
 * the app header because it silently rewrites framing.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
  name,
  className,
  ...aria
}: SwitchProps) {
  const reactId = useId()
  const switchId = id ?? `switch-${reactId}`
  const descriptionId = description ? `${switchId}-description` : undefined

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <SwitchPrimitive.Root
        id={switchId}
        name={name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={aria['aria-label']}
        aria-describedby={descriptionId}
        className={cn(
          'mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full border p-px',
          'transition-colors duration-fast ease-standard motion-reduce:transition-none',
          'border-border-strong bg-surface-raised',
          'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block size-3 rounded-full bg-text-secondary shadow-e1',
            'transition-transform duration-fast ease-standard motion-reduce:transition-none',
            'translate-x-0 data-[state=checked]:translate-x-3 data-[state=checked]:bg-accent-fg',
          )}
        />
      </SwitchPrimitive.Root>

      {(label || description) && (
        <div className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <label
              htmlFor={switchId}
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
