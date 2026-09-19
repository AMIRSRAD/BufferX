import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import './ui.css'

export interface SkeletonProps {
  /** Match the real content's box. A generic bar is a defect (§4.23). */
  width?: number | string
  height?: number | string
  className?: string
  /**
   * §4.23: skeletons appear only after a delay, so a fast response renders
   * nothing at all instead of a flash of grey.
   */
  delayMs?: number
}

/**
 * DESIGN_SYSTEM.md §4.23.
 *
 * Under reduced motion the 1200ms shimmer is replaced by a static 60% block
 * (see `ui.css`). Never skeleton the hex viewer — show its gutter and an
 * empty grid instead.
 */
export function Skeleton({ width, height, className, delayMs = 200 }: SkeletonProps) {
  const [visible, setVisible] = useState(delayMs <= 0)

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true)
      return
    }
    setVisible(false)
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs])

  if (!visible) return null

  return (
    <span
      aria-hidden="true"
      className={cn('bx-skeleton block rounded-xs bg-surface-raised', className)}
      style={{ width, height }}
    />
  )
}
