import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronDown, Search } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { ControlSize } from './Button'
import { Kbd } from './Kbd'
import type { SelectOption } from './Select'
import './ui.css'

export interface ComboboxProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  emptyText?: string
  /** Text in the filter box. Defaults to `Filter…`. */
  searchPlaceholder?: string
  size?: ControlSize
  invalid?: boolean
  disabled?: boolean
  /** Render option codes in mono — packagers, field ids, tags. Default true. */
  mono?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
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
 * Searchable picker (DESIGN_SYSTEM.md §4.5). Required any time the option
 * count can exceed 8 — packagers, banking operations, field ids, tags.
 *
 * Each row is code (mono) + description (`text-tertiary`), because the
 * packager XML already carries `Desc` and it must be displayed.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  emptyText = 'No matches.',
  searchPlaceholder = 'Filter…',
  size = 'sm',
  invalid = false,
  disabled = false,
  mono = true,
  id,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-sm border px-2 text-left',
          'transition-colors duration-fast ease-standard motion-reduce:transition-none',
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
        {selected ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={cn('truncate', mono && 'font-mono text-mono-base')}>{selected.label}</span>
            {selected.hint && (
              <span className="truncate text-xs text-text-tertiary">{selected.hint}</span>
            )}
          </span>
        ) : (
          <span className="truncate text-text-tertiary">{placeholder}</span>
        )}
        <ChevronDown
          size={14}
          strokeWidth={1.25}
          absoluteStrokeWidth
          className="shrink-0 text-text-tertiary"
          aria-hidden="true"
        />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          className={cn(
            'bx-anim-layer z-50 overflow-hidden rounded-md border border-border bg-surface-3 shadow-e2',
          )}
          style={{
            width: 'var(--radix-popover-trigger-width)',
            minWidth: '18rem',
          }}
        >
          <Command
            loop
            className="flex flex-col"
            filter={(itemValue, search, keywords) => {
              const haystack = `${itemValue} ${(keywords ?? []).join(' ')}`.toLowerCase()
              const needle = search.toLowerCase().trim()
              if (!needle) return 1
              if (haystack.includes(needle)) return 1
              // Subsequence match, so `t7` finds `TABLE71`.
              let cursor = 0
              for (const ch of needle) {
                cursor = haystack.indexOf(ch, cursor)
                if (cursor === -1) return 0
                cursor += 1
              }
              return 0.5
            }}
          >
            <div className="flex h-control-md items-center gap-2 border-b border-border-subtle px-2">
              <Search
                size={14}
                strokeWidth={1.25}
                absoluteStrokeWidth
                className="shrink-0 text-text-tertiary"
                aria-hidden="true"
              />
              <Command.Input
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-text caret-accent outline-none placeholder:text-text-tertiary"
              />
            </div>

            <Command.List
              className="overflow-y-auto overscroll-contain p-1"
              style={{ maxHeight: 'min(60vh, 20rem)' }}
            >
              <Command.Empty className="px-2 py-3 text-center text-xs text-text-tertiary">
                {emptyText}
              </Command.Empty>

              {options.map((option) => (
                <Command.Item
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, option.hint ?? '']}
                  disabled={option.disabled ?? false}
                  onSelect={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex h-row cursor-default items-center gap-2 rounded-xs px-2 text-sm outline-none',
                    'data-[selected=true]:bg-surface-raised data-[selected=true]:text-text',
                    'data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-text-disabled',
                  )}
                >
                  <Check
                    size={14}
                    strokeWidth={1.25}
                    absoluteStrokeWidth
                    aria-hidden="true"
                    className={cn('shrink-0 text-accent', option.value !== value && 'invisible')}
                  />
                  <span className={cn('shrink-0 text-text', mono && 'font-mono text-mono-base')}>
                    {option.label}
                  </span>
                  {option.hint && (
                    <span className="ml-auto truncate text-xs text-text-tertiary">{option.hint}</span>
                  )}
                </Command.Item>
              ))}
            </Command.List>

            <div className="flex items-center gap-2 border-t border-border-subtle px-2 py-1 text-2xs text-text-tertiary">
              <Kbd>↑↓</Kbd> navigate
              <Kbd>↵</Kbd> select
              <Kbd>esc</Kbd> close
            </div>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
