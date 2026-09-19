import { beforeEach, describe, expect, it } from 'vitest'
import { PROBLEM_LIMIT, useProblems } from '@/store/problems'

const INITIAL = useProblems.getState()

const problems = () => useProblems.getState()

beforeEach(() => {
  localStorage.clear()
  useProblems.setState(INITIAL, true)
})

describe('problems: the durable log (UX_SPEC 5.1)', () => {
  it('accumulates entries instead of overwriting the previous one', () => {
    problems().add({ severity: 'error', source: 'Build', message: 'F52 binary length mismatch.' })
    problems().add({ severity: 'warning', source: 'Fields', message: 'F35 has a trailing space.' })

    expect(problems().items).toHaveLength(2)
    // Newest first, which is the order the drawer renders.
    expect(problems().items[0]?.source).toBe('Fields')
    expect(problems().items[1]?.source).toBe('Build')
  })

  it('fills in an id and a timestamp, and returns the id', () => {
    const before = Date.now()
    const id = problems().add({ severity: 'info', source: 'MAC', message: 'Calculated.' })
    const entry = problems().items.find((item) => item.id === id)

    expect(entry).toBeDefined()
    expect(entry?.at).toBeGreaterThanOrEqual(before)
    expect(id).not.toBe('')
  })

  it('issues unique ids', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      ids.add(problems().add({ severity: 'info', source: 'Fields', message: `entry ${i}` }))
    }
    expect(ids.size).toBe(50)
  })

  it('accepts a caller-supplied id and timestamp so a Problem round-trips', () => {
    problems().add({
      id: 'fixed-id',
      at: 1_700_000_000_000,
      severity: 'error',
      source: 'Network',
      message: 'Timed out after 5000 ms.',
    })

    const entry = problems().items[0]
    expect(entry?.id).toBe('fixed-id')
    expect(entry?.at).toBe(1_700_000_000_000)
  })

  it('carries the field id so the drawer can jump to the origin', () => {
    problems().add({
      severity: 'error',
      source: 'Build',
      message: 'F52 binary length mismatch: declared 8 bytes, value is 6.',
      fieldId: 52,
    })
    expect(problems().items[0]?.fieldId).toBe(52)
  })

  it('counts by severity', () => {
    problems().add({ severity: 'error', source: 'Build', message: 'a' })
    problems().add({ severity: 'error', source: 'Build', message: 'b' })
    problems().add({ severity: 'warning', source: 'Fields', message: 'c' })
    problems().add({ severity: 'info', source: 'MAC', message: 'd' })

    expect(problems().counts()).toEqual({ error: 2, warning: 1, info: 1, total: 4 })
  })

  it('counts nothing when the log is empty', () => {
    expect(problems().counts()).toEqual({ error: 0, warning: 0, info: 0, total: 0 })
  })

  it('clears one source without touching the others', () => {
    problems().add({ severity: 'error', source: 'Build', message: 'a' })
    problems().add({ severity: 'warning', source: 'Fields', message: 'b' })
    problems().add({ severity: 'error', source: 'Build', message: 'c' })

    problems().clear('Build')

    expect(problems().items).toHaveLength(1)
    expect(problems().items[0]?.source).toBe('Fields')
  })

  it('retracts one field without touching other fields', () => {
    problems().add({ severity: 'error', source: 'Fields', message: 'F2 bad', fieldId: 2 })
    problems().add({ severity: 'error', source: 'Fields', message: 'F3 bad', fieldId: 3 })

    problems().clearField(2)

    expect(problems().items).toHaveLength(1)
    expect(problems().items[0]?.fieldId).toBe(3)
  })

  it('retracts a field only within the named source', () => {
    problems().add({ severity: 'error', source: 'Fields', message: 'F2 bad', fieldId: 2 })
    problems().add({ severity: 'warning', source: 'Build', message: 'F2 short', fieldId: 2 })

    problems().clearField(2, 'Fields')

    expect(problems().items).toHaveLength(1)
    expect(problems().items[0]?.source).toBe('Build')
  })

  it('leaves entries with no field attached alone', () => {
    problems().add({ severity: 'error', source: 'Decode', message: 'whole message failed' })
    problems().clearField(2)
    expect(problems().items).toHaveLength(1)
  })

  // The reported bug: a red stayed in the drawer after the value was fixed and
  // the buffer decoded again, so the counts never came back down.
  it('a corrected field stops counting as an error', () => {
    problems().add({
      severity: 'error',
      source: 'Fields',
      message: 'F2 is a numeric field but contains non-digits.',
      fieldId: 2,
    })
    expect(problems().counts().error).toBe(1)

    // Re-editing the same field retracts what was said about the old value.
    problems().clearField(2, 'Fields')

    expect(problems().counts()).toEqual({ error: 0, warning: 0, info: 0, total: 0 })
  })

  it('clears everything when no source is given', () => {
    problems().add({ severity: 'error', source: 'Build', message: 'a' })
    problems().add({ severity: 'warning', source: 'Fields', message: 'b' })

    problems().clear()
    expect(problems().items).toEqual([])
  })

  it('removes a single entry by id', () => {
    const keep = problems().add({ severity: 'error', source: 'Build', message: 'keep' })
    const drop = problems().add({ severity: 'error', source: 'Build', message: 'drop' })

    problems().remove(drop)

    expect(problems().items).toHaveLength(1)
    expect(problems().items[0]?.id).toBe(keep)

    // Removing an unknown id is a no-op.
    problems().remove('not-an-id')
    expect(problems().items).toHaveLength(1)
  })

  it('bounds the log so a malformed capture cannot exhaust memory', () => {
    for (let i = 0; i < PROBLEM_LIMIT + 25; i += 1) {
      problems().add({ severity: 'error', source: 'Decode', message: `entry ${i}` })
    }

    expect(problems().items).toHaveLength(PROBLEM_LIMIT)
    // The newest survive; the oldest are dropped.
    expect(problems().items[0]?.message).toBe(`entry ${PROBLEM_LIMIT + 24}`)
  })
})

describe('problems: never persisted (UX_SPEC 5.5)', () => {
  it('keeps quoted field values out of storage', () => {
    problems().add({
      severity: 'error',
      source: 'Build',
      message: 'F2 invalid: 6274129900112233 is not a valid PAN.',
      fieldId: 2,
    })

    expect(localStorage.length).toBe(0)
  })
})
