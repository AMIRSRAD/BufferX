import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ICON_PX, ICON_STROKE, type ControlSize } from './Button'

export interface SegmentedOption {
  value: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
}

export interface SegmentedControlProps {
  value: string
  onValueChange: (value: string) => void
  /** 2–4 items. Above 4, or with long labels, use a Select. */
  options: SegmentedOption[]
  size?: ControlSize
  disabled?: boolean
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
  xs: 'text-2xs',
  sm: 'text-xs',
  md: 'text-xs',
  lg: 'text-sm',
}

/**
 * DESIGN_SYSTEM.md §4.9 — `Hex | Text`, `Tree | Flat | Raw`, `Encode | Decode`.
 *
 * The selection indicator is a measured element that slides on `transform`
 * only (§5.2 forbids animating width). Under reduced motion the transition is
 * dropped and it jumps, losing no information.
 */
export function SegmentedControl({
  value,
  onValueChange,
  options,
  size = 'sm',
  disabled = false,
  className,
  ...aria
}: SegmentedControlProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const [indicator, setIndicator] = useState<{ x: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const track = trackRef.current
    const measure = () => {
      const item = itemRefs.current.get(value)
      if (!track || !item) {
        setIndicator((prev) => (prev === null ? prev : null))
        return
      }
      // offsetLeft is measured from the border box; the indicator's containing
      // block is the padding box, so subtract the border width.
      const x = item.offsetLeft - track.clientLeft
      const width = item.offsetWidth
      setIndicator((prev) => (prev && prev.x === x && prev.width === width ? prev : { x, width }))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    if (track) observer.observe(track)
    for (const item of itemRefs.current.values()) observer.observe(item)
    return () => observer.disconnect()
  }, [value, options.length])

  return (
    <ToggleGroupPrimitive.Root
      ref={trackRef}
      type="single"
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        // Radix emits '' when the pressed item is toggled off; a segmented
        // control always has exactly one selection.
        if (next) onValueChange(next)
      }}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-sm border border-border-strong',
        'bg-surface-2 p-0.5 shadow-e1',
        HEIGHT[size],
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
      {...aria}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-0.5 bottom-0.5 left-0 rounded-xs bg-surface-3 shadow-e1',
            'transition-transform duration-fast ease-standard motion-reduce:transition-none',
          )}
          style={{ width: indicator.width, transform: `translateX(${indicator.x}px)` }}
        />
      )}

      {options.map((option) => {
        const Icon = option.icon
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled ?? false}
            ref={(node) => {
              if (node) itemRefs.current.set(option.value, node)
              else itemRefs.current.delete(option.value)
            }}
            className={cn(
              'relative z-10 inline-flex h-full items-center justify-center gap-1 rounded-xs px-2.5',
              'whitespace-nowrap transition-colors duration-fast ease-standard motion-reduce:transition-none',
              'focus-visible:shadow-focus',
              TEXT[size],
              'text-text-tertiary hover:text-text-secondary',
              'data-[state=on]:font-medium data-[state=on]:text-text',
              'data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
            )}
          >
            {Icon && (
              <Icon
                size={ICON_PX[size]}
                strokeWidth={ICON_STROKE[size]}
                absoluteStrokeWidth
                aria-hidden="true"
              />
            )}
            {option.label}
          </ToggleGroupPrimitive.Item>
        )
      })}
    </ToggleGroupPrimitive.Root>
  )
}
