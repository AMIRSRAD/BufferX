import { describe, expect, it } from 'vitest'

import { decodeHeaderArgs } from '../model'

/**
 * Regression cover for a reported failure: a buffer that used to parse in the
 * Qt app — `0247` followed by exactly 247 bytes — failed here with an error
 * naming an unrelated field.
 *
 * The cause was not the codec. Auto-detect ships enabled, but the tab's default
 * framing is `{ enabled: false, mode: 'none' }`, and the codec gates header
 * handling on `enabled`. So the probe never ran and the length prefix was
 * walked as message data. Verified against the engine: with `enabled:false` the
 * decode fails identically whether auto-detect is on or off.
 */
describe('decodeHeaderArgs', () => {
  const off = { enabled: false, mode: 'none', size: 4 } as const

  it('lets the codec probe when auto-detect is on, despite the build setting', () => {
    // The shipped default. Before the fix this passed enabled:false straight
    // through, which is what made Auto-detect a no-op.
    expect(decodeHeaderArgs(off, true)).toEqual({ enabled: true, mode: 'ascii', size: 4 })
  })

  it('keeps an explicit mode when auto-detect is on', () => {
    expect(decodeHeaderArgs({ enabled: false, mode: 'binary', size: 2 }, true)).toEqual({
      enabled: true,
      mode: 'binary',
      size: 2,
    })
  })

  it('substitutes a usable size when none is configured', () => {
    expect(decodeHeaderArgs({ enabled: false, mode: 'none', size: 0 }, true).size).toBe(4)
  })

  it('honours the operator exactly when auto-detect is off', () => {
    // No probing behind their back: off means off.
    expect(decodeHeaderArgs(off, false)).toEqual({ enabled: false, mode: 'none', size: 4 })
    expect(decodeHeaderArgs({ enabled: true, mode: 'ascii', size: 6 }, false)).toEqual({
      enabled: true,
      mode: 'ascii',
      size: 6,
    })
  })

  it('never reports mode "none" while asking the codec to look', () => {
    // `enabled: true` with `mode: 'none'` is contradictory — the codec would be
    // told to handle a header of no format.
    const result = decodeHeaderArgs(off, true)
    expect(result.enabled).toBe(true)
    expect(result.mode).not.toBe('none')
  })
})
