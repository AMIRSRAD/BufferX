/**
 * The loading rule from UX_SPEC 5.4, as a hook.
 *
 * Engine calls are usually sub-millisecond, so showing a spinner the instant a
 * button is pressed produces a flash of noise on every click. This returns
 * `true` only once work has been running for `delay` ms, which is what the
 * progress strip and the button's pressed-disabled state key off.
 */

import { useEffect, useState } from 'react'

export function useDeferredBusy(busy: boolean, delay = 120): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!busy) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [busy, delay])

  return visible
}
