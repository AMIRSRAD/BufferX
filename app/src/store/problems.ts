import { create } from 'zustand'

/**
 * The Problems log (UX_SPEC 5.1, tier 2).
 *
 * "Errors are data, not interruptions" (tenet 4). This replaces the old single
 * elided status label where each new error silently overwrote the last: entries
 * are durable, timestamped, filterable and copyable, and they accumulate rather
 * than replace.
 *
 * **Never persisted.** Messages quote real field values -- a length-mismatch
 * error names the offending bytes -- so the log can contain PAN and PIN-block
 * material and must not outlive the session (UX_SPEC 5.5).
 */

export type ProblemSeverity = 'error' | 'warning' | 'info'

export interface Problem {
  id: string
  severity: ProblemSeverity
  /** Which surface raised it: `Build`, `Fields`, `MAC`, `Network`, ... */
  source: string
  /** The full, untruncated message. Never elided at the source. */
  message: string
  /** Bit number, when the problem belongs to a field row. Drives the jump link. */
  fieldId?: number
  /** `Date.now()` when raised. */
  at: number
}

/**
 * What callers pass to `add`. `id` and `at` are filled in automatically but may
 * be supplied, so a full `Problem` round-trips.
 */
export type ProblemInput = Omit<Problem, 'id' | 'at'> & { id?: string; at?: number }

export interface ProblemCounts {
  error: number
  warning: number
  info: number
  total: number
}

export interface ProblemsState {
  /** Most recent first, which is the order the drawer renders. */
  items: Problem[]

  /** Appends an entry and returns its id. */
  add(problem: ProblemInput): string
  /** Clears one source's entries, or the whole log when `source` is omitted. */
  clear(source?: string): void
  /**
   * Clears entries attached to one field, optionally limited to a source.
   *
   * Field-level problems describe the field's *current* value, so they have to
   * be retracted when it changes. Without this, correcting a bad value leaves
   * the old error in the drawer forever and the counts lie.
   */
  clearField(fieldId: number, source?: string): void
  remove(id: string): void
  counts(): ProblemCounts
}

/**
 * Upper bound on retained entries. A decode of a malformed 64KB capture can
 * raise thousands; the drawer stays useful and memory stays bounded.
 */
export const PROBLEM_LIMIT = 500

let sequence = 0

function nextId(): string {
  sequence += 1
  return `problem-${sequence}`
}

export const useProblems = create<ProblemsState>()((set, get) => ({
  items: [],

  add(problem) {
    const id = problem.id ?? nextId()
    const entry: Problem = {
      ...problem,
      id,
      at: problem.at ?? Date.now(),
    }
    set((state) => ({ items: [entry, ...state.items].slice(0, PROBLEM_LIMIT) }))
    return id
  },

  clear(source) {
    const { items } = get()
    if (source === undefined) {
      if (items.length === 0) return
      set({ items: [] })
      return
    }
    const next = items.filter((item) => item.source !== source)
    if (next.length === items.length) return
    set({ items: next })
  },

  clearField(fieldId, source) {
    const { items } = get()
    const next = items.filter(
      (item) =>
        item.fieldId !== fieldId || (source !== undefined && item.source !== source),
    )
    if (next.length === items.length) return
    set({ items: next })
  },

  remove(id) {
    const { items } = get()
    const next = items.filter((item) => item.id !== id)
    if (next.length === items.length) return
    set({ items: next })
  },

  counts() {
    const counts: ProblemCounts = { error: 0, warning: 0, info: 0, total: 0 }
    for (const item of get().items) {
      counts[item.severity] += 1
      counts.total += 1
    }
    return counts
  },
}))
