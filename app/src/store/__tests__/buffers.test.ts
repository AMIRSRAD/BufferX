import { beforeEach, describe, expect, it } from 'vitest'
import type { FieldRow } from '@/store/buffers'
import { useBuffers } from '@/store/buffers'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { useTools } from '@/store/tools'

const INITIAL = useBuffers.getState()

/** A PAN-shaped value. If this string ever reaches storage, we have a bug. */
const PAN = '6274129900112233'

const buffers = () => useBuffers.getState()

function seedFields(id: string, fields: FieldRow[]): void {
  // `stale: false` mimics what Decode does: it produced these fields from the
  // raw pane, so the two are in sync.
  buffers().update(id, { fields, decoded: true, stale: false, dirty: false })
}

beforeEach(() => {
  localStorage.clear()
  useBuffers.setState(INITIAL, true)
})

describe('buffers: staleness model (UX_SPEC 2.6)', () => {
  it('starts in sync', () => {
    const tab = buffers().active()
    expect(tab).toBeDefined()
    expect(tab?.stale).toBe(false)
    expect(tab?.decoded).toBe(false)
    expect(tab?.dirty).toBe(false)
  })

  it('marks the buffer stale when a field value is edited', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [
      { id: 2, value: PAN },
      { id: 3, value: '000000' },
    ])
    expect(buffers().active()?.stale).toBe(false)

    buffers().updateField(id, 3, '010000')

    const tab = buffers().active()
    expect(tab?.stale).toBe(true)
    expect(tab?.dirty).toBe(true)
    expect(tab?.fields[1]?.value).toBe('010000')
  })

  it('does not go stale when a field is set to the value it already had', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 3, value: '000000' }])

    expect(buffers().updateField(id, 3, '000000')).toBe(false)
    expect(buffers().active()?.stale).toBe(false)
  })

  it('clears the row validation message when its value changes', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 4, value: '0000012.50', invalid: 'Numeric field contains non-digits' }])

    buffers().updateField(id, 4, '000001250')
    expect(buffers().active()?.fields[0]?.invalid).toBeUndefined()
  })

  it('marks the buffer stale when a field is added or removed', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])

    expect(buffers().addField(id, 55)).toBe(true)
    expect(buffers().active()?.stale).toBe(true)

    seedFields(id, buffers().active()?.fields ?? [])
    expect(buffers().active()?.stale).toBe(false)

    expect(buffers().removeField(id, 55)).toBe(true)
    expect(buffers().active()?.stale).toBe(true)
  })

  it('inserts added fields in bit order and refuses duplicates', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [
      { id: 2, value: PAN },
      { id: 39, value: '00' },
    ])

    buffers().addField(id, 11)
    buffers().addField(id, 128)
    expect(buffers().active()?.fields.map((field) => field.id)).toEqual([2, 11, 39, 128])

    expect(buffers().addField(id, 11)).toBe(false)
    expect(buffers().active()?.fields).toHaveLength(4)
  })

  it('marks the buffer stale when a framing option changes', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])

    buffers().update(id, { header: { size: 7 } })
    expect(buffers().active()?.stale).toBe(true)
    // Partial header patches merge rather than replace.
    expect(buffers().active()?.header).toEqual({ enabled: false, mode: 'none', size: 7 })

    seedFields(id, buffers().active()?.fields ?? [])
    buffers().update(id, { autoDetect: false })
    expect(buffers().active()?.stale).toBe(true)
  })

  it('does not go stale when a framing control is re-set to its current value', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])

    buffers().update(id, { header: { size: 4 }, autoDetect: true })
    expect(buffers().active()?.stale).toBe(false)
    expect(buffers().active()?.dirty).toBe(false)
  })

  it('marks the buffer stale when the raw pane or the packager changes', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])

    buffers().update(id, { raw: '30313230' })
    expect(buffers().active()?.stale).toBe(true)
    expect(buffers().active()?.dirty).toBe(true)

    seedFields(id, buffers().active()?.fields ?? [])
    buffers().update(id, { packager: 'SHETAB7' })
    expect(buffers().active()?.stale).toBe(true)
  })

  it('clears staleness on decode', () => {
    const id = INITIAL.activeId ?? ''
    buffers().update(id, { raw: '30313230' })
    expect(buffers().active()?.stale).toBe(true)

    // What the decode path does: replace the fields, clear the flag explicitly.
    buffers().update(id, { fields: [{ id: 2, value: PAN }], decoded: true, stale: false })

    const tab = buffers().active()
    expect(tab?.stale).toBe(false)
    expect(tab?.decoded).toBe(true)
  })

  it('clears staleness on build without re-decoding', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])
    buffers().updateField(id, 2, '6274129900119999')
    expect(buffers().active()?.stale).toBe(true)

    // Build writes the encoded result into the raw pane and stops there.
    buffers().update(id, { raw: '303134380200', stale: false })

    const tab = buffers().active()
    expect(tab?.stale).toBe(false)
    expect(tab?.raw).toBe('303134380200')
    expect(tab?.decoded).toBe(true)
    expect(tab?.fields[0]?.value).toBe('6274129900119999')
  })

  it('does not mark a freshly decoded file as dirty', () => {
    const id = INITIAL.activeId ?? ''
    buffers().update(id, { raw: '30313230', dirty: false })
    buffers().update(id, { fields: [{ id: 2, value: PAN }], decoded: true, stale: false })
    expect(buffers().active()?.dirty).toBe(false)
  })

  it('markStale flags the tab without otherwise touching it', () => {
    const id = INITIAL.activeId ?? ''
    seedFields(id, [{ id: 2, value: PAN }])

    buffers().markStale(id)
    const tab = buffers().active()
    expect(tab?.stale).toBe(true)
    expect(tab?.dirty).toBe(false)
    expect(tab?.fields).toHaveLength(1)
  })

  it('ignores mutations aimed at an unknown tab', () => {
    expect(buffers().updateField('nope', 2, 'x')).toBe(false)
    expect(buffers().addField('nope', 2)).toBe(false)
    expect(buffers().removeField('nope', 2)).toBe(false)
    buffers().markStale('nope')
    buffers().update('nope', { raw: 'x' })
    expect(buffers().tabs).toHaveLength(1)
  })
})

describe('buffers: tabs, dirty close and reopen (UX_SPEC 1.3)', () => {
  it('creates tabs with untitled-N names and makes them active', () => {
    const second = buffers().newTab()
    expect(buffers().tabs).toHaveLength(2)
    expect(buffers().activeId).toBe(second)
    expect(buffers().active()?.name).toBe('untitled-2')

    const third = buffers().newTab({ name: 'reversal.bxb', raw: '30313230' })
    expect(buffers().active()?.name).toBe('reversal.bxb')
    expect(buffers().active()?.id).toBe(third)
    expect(buffers().active()?.dirty).toBe(false)
  })

  it('closes a clean tab immediately', () => {
    const id = buffers().newTab()
    const result = buffers().closeTab(id)

    expect(result.closed).toBe(true)
    expect(buffers().tabs.some((tab) => tab.id === id)).toBe(false)
  })

  it('refuses to close a dirty tab and hands the caller what it needs to prompt', () => {
    const id = buffers().newTab()
    buffers().update(id, { raw: PAN })
    expect(buffers().active()?.dirty).toBe(true)

    const result = buffers().closeTab(id)

    expect(result.closed).toBe(false)
    expect(result.closed === false ? result.reason : null).toBe('dirty')
    // The tab travels with the refusal so the prompt can name it.
    expect(result.closed === false && result.reason === 'dirty' ? result.tab.name : null).toBe(
      'untitled-2',
    )
    // Nothing was discarded.
    expect(buffers().tabs.some((tab) => tab.id === id)).toBe(true)
    expect(buffers().activeId).toBe(id)
  })

  it('closes a dirty tab once the caller has confirmed', () => {
    const id = buffers().newTab()
    buffers().update(id, { raw: PAN })

    const result = buffers().closeTab(id, { force: true })

    expect(result.closed).toBe(true)
    expect(buffers().tabs.some((tab) => tab.id === id)).toBe(false)
  })

  it('reports an unknown tab rather than silently succeeding', () => {
    const result = buffers().closeTab('buf-does-not-exist')
    expect(result.closed).toBe(false)
    expect(result.closed === false ? result.reason : null).toBe('not-found')
  })

  it('reopenLast fully restores the closed tab, in place', () => {
    const first = INITIAL.activeId ?? ''
    const middle = buffers().newTab({ name: 'auth-req.bxb' })
    const last = buffers().newTab({ name: 'reversal.bxb' })

    buffers().update(middle, {
      raw: '30313438',
      inputHex: true,
      packager: 'SHETAB7',
      autoDetect: false,
      header: { enabled: true, mode: 'ascii', size: 4 },
      fields: [
        { id: 2, value: PAN, desc: 'PAN', type: 'N', length: 19, hex: false },
        { id: 52, value: 'A1B2C3D4E5F60718', desc: 'PIN DATA', type: 'B', hex: true },
      ],
      decoded: true,
      lastError: 'F52 binary length mismatch',
    })

    const before = buffers().tabs.find((tab) => tab.id === middle)
    expect(before?.dirty).toBe(true)

    expect(buffers().closeTab(middle, { force: true }).closed).toBe(true)
    expect(buffers().tabs.map((tab) => tab.id)).toEqual([first, last])

    const reopened = buffers().reopenLast()

    expect(reopened).toBe(middle)
    // Restored at its original index, not appended.
    expect(buffers().tabs.map((tab) => tab.id)).toEqual([first, middle, last])
    expect(buffers().activeId).toBe(middle)

    const after = buffers().tabs.find((tab) => tab.id === middle)
    expect(after).toEqual(before)
  })

  it('reopens in most-recent-first order and then reports nothing left', () => {
    const a = buffers().newTab({ name: 'a.bxb' })
    const b = buffers().newTab({ name: 'b.bxb' })

    buffers().closeTab(a)
    buffers().closeTab(b)

    expect(buffers().reopenLast()).toBe(b)
    expect(buffers().reopenLast()).toBe(a)
    expect(buffers().reopenLast()).toBeUndefined()
  })

  it('moves activation to a neighbour when the active tab closes', () => {
    const first = INITIAL.activeId ?? ''
    const middle = buffers().newTab()
    const last = buffers().newTab()

    buffers().setActive(middle)
    buffers().closeTab(middle)
    expect(buffers().activeId).toBe(last)

    buffers().closeTab(last)
    expect(buffers().activeId).toBe(first)

    buffers().closeTab(first)
    expect(buffers().tabs).toHaveLength(0)
    expect(buffers().activeId).toBeNull()
    expect(buffers().active()).toBeUndefined()
  })

  it('setActive ignores unknown ids', () => {
    const before = buffers().activeId
    buffers().setActive('buf-nope')
    expect(buffers().activeId).toBe(before)
  })
})

describe('buffers: never persisted (UX_SPEC 5.5)', () => {
  function storageSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key === null) continue
      snapshot[key] = localStorage.getItem(key) ?? ''
    }
    return snapshot
  }

  it('keeps buffer content out of storage even while every other store persists', () => {
    const id = INITIAL.activeId ?? ''

    // Drive the stores that *are* allowed to write, so the assertion below is
    // about the allowlist rather than about an empty localStorage.
    useSettings.getState().setTheme('light')
    useSettings.getState().setDensity('comfortable')
    useTools.getState().openTool('pin')
    useTools.getState().openTool('mac')

    buffers().update(id, { name: 'auth-req.bxb', raw: `3031343830323030${PAN}` })
    buffers().update(id, {
      fields: [
        { id: 2, value: PAN, desc: 'Primary account number' },
        { id: 35, value: `${PAN}=25121011234500000`, desc: 'Track 2 Data' },
        { id: 52, value: 'A1B2C3D4E5F60718', desc: 'PIN DATA' },
      ],
      decoded: true,
      stale: false,
    })
    useProblems.getState().add({
      severity: 'error',
      source: 'Build',
      message: `F52 binary length mismatch: declared 8 bytes, value is 6 (${PAN}).`,
      fieldId: 52,
    })
    buffers().newTab({ name: 'reversal.bxb', raw: PAN })

    const snapshot = storageSnapshot()

    // No store may claim a key of its own beyond the three sanctioned ones.
    expect(Object.keys(snapshot).sort()).toEqual(
      ['bufferx.settings', 'bufferx.theme', 'bufferx.tools'].sort(),
    )

    const serialised = JSON.stringify(snapshot)
    expect(serialised).not.toContain(PAN)
    expect(serialised).not.toContain('auth-req.bxb')
    expect(serialised).not.toContain('reversal.bxb')
    expect(serialised).not.toContain('A1B2C3D4E5F60718')
    expect(serialised).not.toContain('Track 2 Data')
    expect(serialised).not.toContain('binary length mismatch')
  })

  it('keeps closed-tab history in memory only', () => {
    const id = buffers().newTab({ name: 'card.bxb' })
    buffers().update(id, { raw: PAN })

    // Checked at every step, not just at the end: a store that wrote on each
    // change would be masked by a final PAN-free snapshot.
    expect(storageSnapshot()).toEqual({})

    buffers().closeTab(id, { force: true })

    expect(buffers().closed).toHaveLength(1)
    expect(buffers().closed[0]?.tab.raw).toBe(PAN)
    expect(storageSnapshot()).toEqual({})

    expect(buffers().reopenLast()).toBe(id)
    expect(storageSnapshot()).toEqual({})
  })
})
