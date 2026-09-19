import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Badge } from './Badge'

export interface TabDescriptor {
  value: string
  label: ReactNode
  /** Count or status chip rendered after the label. */
  badge?: ReactNode
  disabled?: boolean
}

export interface TabsProps {
  value: string
  onValueChange: (value: string) => void
  tabs: TabDescriptor[]
  /** Panel content for the *active* tab. The caller switches on `value`. */
  children?: ReactNode
  className?: string
  listClassName?: string
  contentClassName?: string
  'aria-label'?: string
}

/**
 * DESIGN_SYSTEM.md §4.10. Underline style, manual activation.
 *
 * Manual activation matters: auto-activating on arrow-through would fire a
 * decode every time an operator scans the tab strip.
 */
export function Tabs({
  value,
  onValueChange,
  tabs,
  children,
  className,
  listClassName,
  contentClassName,
  ...aria
}: TabsProps) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      activationMode="manual"
      className={cn('flex min-h-0 flex-col', className)}
    >
      <TabsPrimitive.List
        aria-label={aria['aria-label']}
        className={cn(
          'flex shrink-0 items-stretch gap-0 overflow-x-auto border-b border-border-subtle bg-surface-1',
          listClassName,
        )}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.value}
            value={tab.value}
            disabled={tab.disabled ?? false}
            className={cn(
              'group relative inline-flex h-8 shrink-0 items-center gap-1.5 px-3 whitespace-nowrap',
              'text-sm transition-colors duration-fast ease-standard motion-reduce:transition-none',
              'text-text-tertiary hover:text-text-secondary',
              'data-[state=active]:font-medium data-[state=active]:text-text',
              'data-[disabled]:cursor-not-allowed data-[disabled]:text-text-disabled',
            )}
          >
            {tab.label}
            {tab.badge != null &&
              (typeof tab.badge === 'string' || typeof tab.badge === 'number' ? (
                <Badge tone="neutral">{tab.badge}</Badge>
              ) : (
                tab.badge
              ))}
            {/* 2px accent rule inset to the label width — drawn as an overlay so
                it never changes the trigger's box. */}
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-x-3 bottom-0 h-0.5 bg-accent opacity-0',
                'transition-opacity duration-base ease-standard motion-reduce:transition-none',
                'group-data-[state=active]:opacity-100',
              )}
            />
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>

      {children != null && (
        <TabsPrimitive.Content
          value={value}
          forceMount
          className={cn('min-h-0 flex-1 outline-none', contentClassName)}
        >
          {children}
        </TabsPrimitive.Content>
      )}
    </TabsPrimitive.Root>
  )
}
