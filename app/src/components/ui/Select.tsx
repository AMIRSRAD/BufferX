import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { ControlSize } from './Button'
import './ui.css'

export interface SelectOption {
  value: string
  label: string
  /** Secondary description shown after the label in `text-tertiary`. */
  hint?: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  size?: ControlSize
  invalid?: boolean
  disabled?: boolean
  /** Render the trigger value in mono — for codes like `STX21`. */
  mono?: boolean
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

const HEIGHT: Record<ControlSize, string> = {
  xs: 'h-control-xs',
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
}

const TEXT: Record<ControlSize, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-sm',
  lg: 'text-base',
}

/**
 * Radix Select (DESIGN_SYSTEM.md §4.5). Use it up to 8 options; above that the
 * spec mandates `Combobox` so the list stays searchable.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  size = 'sm',
  invalid = false,
  disabled = false,
  mono = false,
  id,
  name,
  className,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-sm border px-2',
          'text-left transition-colors duration-fast ease-standard motion-reduce:transition-none',
          'focus-visible:border-accent focus-visible:shadow-focus',
          HEIGHT[size],
          TEXT[size],
          disabled
            ? 'cursor-not-allowed border-border-subtle bg-surface-1 text-text-disabled'
            : cn(
                'bg-surface-2 text-text shadow-e1 hover:bg-surface-raised',
                invalid ? 'border-error' : 'border-border-strong',
              ),
          className,
        )}
        {...aria}
      >
        <span className={cn('min-w-0 truncate', mono && 'font-mono text-mono-base')}>
          <SelectPrimitive.Value placeholder={<span className="text-text-tertiary">{placeholder}</span>} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown
            size={14}
            strokeWidth={1.25}
            absoluteStrokeWidth
            className="shrink-0 text-text-tertiary"
            aria-hidden="true"
          />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          collisionPadding={12}
          className={cn(
            'bx-anim-layer z-50 overflow-hidden rounded-md border border-border bg-surface-3 shadow-e2',
          )}
          style={{
            minWidth: 'var(--radix-select-trigger-width)',
            maxHeight: 'min(60vh, 24rem)',
          }}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center bg-surface-3 text-text-tertiary">
            <ChevronUp size={14} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className={cn(
                  'relative flex h-row cursor-default items-center gap-2 rounded-xs pr-2 pl-6 text-sm outline-none select-none',
                  'data-[highlighted]:bg-surface-raised data-[highlighted]:text-text',
                  'data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 flex items-center">
                  <Check
                    size={14}
                    strokeWidth={1.25}
                    absoluteStrokeWidth
                    className="text-accent"
                    aria-hidden="true"
                  />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>
                  <span className={cn('text-text', mono && 'font-mono text-mono-base')}>{option.label}</span>
                </SelectPrimitive.ItemText>
                {option.hint && (
                  <span className="ml-auto truncate text-xs text-text-tertiary">{option.hint}</span>
                )}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center bg-surface-3 text-text-tertiary">
            <ChevronDown size={14} strokeWidth={1.25} absoluteStrokeWidth aria-hidden="true" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
