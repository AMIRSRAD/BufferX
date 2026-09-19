import { useEffect, useState } from 'react'

/**
 * True only once `active` has been true for `delayMs` (UX_SPEC 5.4).
 *
 * Engine calls here are usually sub-millisecond, so a progress indicator that
 * renders immediately is a flash of noise. This defers the indicator past the
 * 120ms threshold while the button's disabled state applies at once.
 */
export function useDelayedFlag(active: boolean, delayMs = 120): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [active, delayMs])

  return visible
}
