/**
 * Container-driven layout for the shell (UX_SPEC 1.5).
 *
 * The breakpoints in the spec are written as window widths, but nothing here
 * reads the window: a `ResizeObserver` measures the shell's own root element
 * and every region sizes itself from that. The shell therefore behaves
 * identically at 1200px in a browser, in a 1200px Tauri window, and inside a
 * 1200px storybook frame — and no panel is ever positioned in absolute window
 * pixels, which was the fatal property of the Qt footer popovers.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'

/**
 * | mode      | container width | layout                                        |
 * |-----------|-----------------|-----------------------------------------------|
 * | `ultra`   | >= 1600         | rail labeled, dock 480, dock may hold 2 columns |
 * | `wide`    | 1200 - 1599     | rail icon-only, dock 440                        |
 * | `medium`  | 900 - 1199      | dock becomes an overlay sheet, Esc closes       |
 * | `compact` | < 900           | single column, rail collapses to a menu         |
 */
export type LayoutMode = 'compact' | 'medium' | 'wide' | 'ultra'

export const LAYOUT_BREAKPOINTS = { medium: 900, wide: 1200, ultra: 1600 } as const

/** Dock width bounds from UX_SPEC 1.1. */
export const DOCK_MIN_WIDTH = 380
export const DOCK_MAX_WIDTH = 640

export function modeForWidth(width: number): LayoutMode {
  if (width >= LAYOUT_BREAKPOINTS.ultra) return 'ultra'
  if (width >= LAYOUT_BREAKPOINTS.wide) return 'wide'
  if (width >= LAYOUT_BREAKPOINTS.medium) return 'medium'
  return 'compact'
}

/** Default dock width per mode (UX_SPEC 1.5). */
export function defaultDockWidth(mode: LayoutMode): number {
  return mode === 'ultra' ? 480 : 440
}

/** True when the dock floats over the workspace instead of sitting beside it. */
export function dockIsOverlay(mode: LayoutMode): boolean {
  return mode === 'medium' || mode === 'compact'
}

export interface ContainerSize {
  width: number
  height: number
  mode: LayoutMode
}

const INITIAL_SIZE: ContainerSize = { width: 1280, height: 800, mode: 'wide' }

/**
 * Observes an element and reports its size plus the derived layout mode.
 *
 * The observer is the only source of layout truth; there is deliberately no
 * `window.innerWidth` fallback beyond the first frame, so a shell embedded in a
 * split view never mistakes the window for its own box.
 */
export function useContainerSize(ref: RefObject<HTMLElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>(INITIAL_SIZE)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const measure = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      setSize((current) => {
        const mode = modeForWidth(width)
        if (current.width === width && current.height === height && current.mode === mode) {
          return current
        }
        return { width, height, mode }
      })
    }

    if (typeof ResizeObserver === 'undefined') {
      // jsdom and very old engines: measure once so tests get a real number.
      measure(element.clientWidth, element.clientHeight)
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      measure(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return size
}

const LayoutContext = createContext<ContainerSize>(INITIAL_SIZE)

export function LayoutProvider({ value, children }: { value: ContainerSize; children: ReactNode }) {
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

/** The shell's current container size and layout mode. */
export function useLayout(): ContainerSize {
  return useContext(LayoutContext)
}
