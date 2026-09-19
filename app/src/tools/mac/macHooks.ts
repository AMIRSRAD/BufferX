/**
 * Engine-backed hooks for the MAC tool.
 *
 * Both hooks are read-only: they never mutate a buffer and never surface a
 * secret. `useKcv` sends the key to the engine to derive a check value — the
 * only thing that leaves this tool, and the only thing the operator can copy.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { tryCall } from '@/engine/client'
import type { PackagerSummary } from './macModel'
import { macKeyProblem } from './macModel'

export interface PackagerSummariesState {
  summaries: PackagerSummary[]
  loading: boolean
  /** Operator-facing failure text from `packager.list`, or `null`. */
  error: string | null
  reload: () => void
}

/**
 * The packager registry, with the MAC metadata the tool reads
 * (`macMethod`, `macSize`, `macFieldIds`). Reloaded after a packager XML load.
 */
export function usePackagerSummaries(): PackagerSummariesState {
  const [summaries, setSummaries] = useState<PackagerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void tryCall<{ packagers: PackagerSummary[] }>('packager.list', {}).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSummaries(Array.isArray(result.data.packagers) ? result.data.packagers : [])
        setError(null)
      } else {
        setSummaries([])
        setError(result.error.message)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { summaries, loading, error, reload }
}

export interface KcvState {
  /** 3-byte check value as hex, or `null` while the key is absent or illegal. */
  kcv: string | null
  computing: boolean
  /** Why the check value could not be derived, or `null`. */
  error: string | null
}

const KCV_DEBOUNCE_MS = 250
const KCV_BYTES = 3

/**
 * Derives the key check value once the key reaches a legal length, debounced so
 * a typed key does not fire a call per keystroke.
 *
 * Note: a 24-byte MAC key is legal here but the engine's `kcv` utility accepts
 * 8, 16, 24, and 32 bytes, so every legal MAC key is covered.
 */
export function useKcv(keyHex: string): KcvState {
  const [state, setState] = useState<KcvState>({ kcv: null, computing: false, error: null })
  const token = useRef(0)

  useEffect(() => {
    token.current += 1
    const mine = token.current

    if (macKeyProblem(keyHex) !== null) {
      setState({ kcv: null, computing: false, error: null })
      return
    }

    setState((previous) => ({ ...previous, computing: true }))
    const timer = window.setTimeout(() => {
      void tryCall<{ output: string }>('tools.run', {
        operation: 'kcv',
        input: keyHex,
        parameter: KCV_BYTES,
      }).then((result) => {
        if (token.current !== mine) return
        setState(
          result.ok
            ? { kcv: result.data.output, computing: false, error: null }
            : { kcv: null, computing: false, error: result.error.message },
        )
      })
    }, KCV_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [keyHex])

  return state
}

/**
 * `true` once a run has been in flight longer than 120ms — the threshold at
 * which UX_SPEC 5.4 permits a progress indication. Below it, nothing renders.
 */
export function useDelayedProgress(active: boolean, delayMs = 120): boolean {
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
