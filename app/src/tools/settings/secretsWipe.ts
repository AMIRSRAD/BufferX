/**
 * `Clear all secrets` and the idle wipe (UX_SPEC 3.9 → Security, 5.5 rule 5).
 *
 * Wipe triggers: tool close, `Ctrl+Alt+L`, N minutes of inactivity, window
 * close. The first two are owned by the shell; this module owns the timer and
 * the shared entry point that both use, so a tool only ever has to listen for
 * one thing: the `clear-secrets` shell command.
 *
 * The timer is installed at module load rather than from a React effect. The
 * Settings panel is lazily mounted and usually closed, and an idle-wipe that
 * only ran while its own settings screen was open would be worse than useless.
 */

import { clearAllToolStatus } from '@/shell/toolStatus'
import { SHELL_COMMAND_EVENT, type ShellCommandDetail } from '@/shell/useShortcuts'
import { usePreferences } from './preferences'

/**
 * Broadcasts the wipe. Every tool holding key material listens for
 * `clear-secrets` and zeroes its own state; nothing is read back out here,
 * because this module must never see a secret in the first place.
 */
export function clearAllSecretsNow(): void {
  clearAllToolStatus()
  if (typeof document === 'undefined') return
  const detail: ShellCommandDetail = { command: 'clear-secrets' }
  document.dispatchEvent(new CustomEvent<ShellCommandDetail>(SHELL_COMMAND_EVENT, { detail }))
}

/** Fires after a successful idle wipe, so the panel can toast it. */
export const IDLE_WIPE_EVENT = 'bufferx:idle-wipe'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'focusin'] as const

let timer: ReturnType<typeof setTimeout> | null = null
let installed = false

function cancel(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function schedule(): void {
  cancel()
  const minutes = usePreferences.getState().idleWipeMinutes
  if (minutes === null) return
  timer = setTimeout(() => {
    timer = null
    clearAllSecretsNow()
    document.dispatchEvent(new CustomEvent(IDLE_WIPE_EVENT, { detail: { minutes } }))
  }, minutes * 60_000)
}

/**
 * Starts the idle timer and keeps it in step with the preference. Idempotent.
 */
export function installIdleWipe(): void {
  if (installed) return
  if (typeof document === 'undefined' || typeof globalThis.setTimeout !== 'function') return
  installed = true

  for (const name of ACTIVITY_EVENTS) {
    document.addEventListener(name, schedule, { passive: true, capture: true })
  }
  // A tab that goes to the background is not "active"; one that comes back is.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule()
  })

  usePreferences.subscribe((state, previous) => {
    if (state.idleWipeMinutes !== previous.idleWipeMinutes) schedule()
  })

  schedule()
}

installIdleWipe()
