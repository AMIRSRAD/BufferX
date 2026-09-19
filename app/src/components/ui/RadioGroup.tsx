import * as RadioGroupPrimitive from '@radix-ui/react-radio-group'
import { useId } from 'react'
import { cn } from '@/lib/cn'
import type { SelectOption } from './Select'

export interface RadioGroupProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  orientation?: 'horizontal' | 'vertical'
  disabled?: boolean
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * DESIGN_SYSTEM.md §4.8. Only for ≤ 5 mutually exclusive options that must all
 * be visible at once — PIN block format, framing mode. Above 5, use Select.
 *
 * Arrow keys move selection; Tab enters and leaves the group (Radix roving
 * tabindex).
 */
export function RadioGroup({
  value,
  onValueChange,
  options,
  orientation = 'vertical',
  disabled = false,
  name,
  className,
  ...aria
}: RadioGroupProps) {
  const reactId = useId()

  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      orientation={orientation}
      disabled={disabled}
      name={name}
      className={cn(
        'flex',
        orientation === 'horizontal' ? 'flex-row flex-wrap gap-group' : 'flex-col gap-field',
        className,
      )}
      {...aria}
    >
      {options.map((option) => {
        const itemId = `radio-${reactId}-${option.value}`
        const itemDisabled = disabled || (option.disabled ?? false)
        return (
          <div key={option.value} className="flex items-start gap-2">
            <RadioGroupPrimitive.Item
              id={itemId}
              value={option.value}
              disabled={itemDisabled}
              className={cn(
                'mt-0.5 flex size-3 shrink-0 items-center justify-center rounded-full border',
                'transition-colors duration-instant ease-standard motion-reduce:transition-none',
                'border-border-strong bg-surface-2',
                'data-[state=checked]:border-accent',
                itemDisabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <RadioGroupPrimitive.Indicator className="block size-1.5 rounded-full bg-accent" />
            </RadioGroupPrimitive.Item>

            <div className="flex min-w-0 flex-col gap-0.5">
              <label
                htmlFor={itemId}
                className={cn(
                  'text-sm leading-tight select-none',
                  itemDisabled ? 'cursor-not-allowed text-text-disabled' : 'cursor-pointer text-text',
                )}
              >
                {option.label}
              </label>
              {option.hint && <p className="text-xs text-text-tertiary">{option.hint}</p>}
            </div>
          </div>
        )
      })}
    </RadioGroupPrimitive.Root>
  )
}
