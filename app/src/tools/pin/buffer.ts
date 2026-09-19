/**
 * Field 52 exchange with the active buffer (UX_SPEC 3.2a, 3.2d).
 *
 * `Load F52` / `Apply F52` are the only places the PIN tool touches the
 * document. Two rules from the spec are enforced here:
 *
 * - the operation is *generalised over the bit*, so a host that carries the PIN
 *   block somewhere other than 52 is supported (`targetField`); and
 * - `Apply` creates the field in bit order with `PIN DATA` / `Binary` metadata
 *   when it is absent, then asks the workspace to flash the row so the operator
 *   sees where the block landed.
 */

import { SHELL_COMMAND_EVENT, type ShellCommandDetail } from '@/shell/useShortcuts'
import type { BufferTab, FieldRow } from '@/store/buffers'
import { toHex } from './state'

export type LoadFieldResult =
  | { ok: true; hex: string }
  | { ok: false; reason: 'no-buffer' | 'missing' | 'empty' | 'not-hex'; message: string }

/** Reads one field of the active buffer as hex. */
export function loadFieldHex(tab: BufferTab | undefined, fieldId: number): LoadFieldResult {
  if (!tab) {
    return { ok: false, reason: 'no-buffer', message: 'No buffer is open.' }
  }
  const row = tab.fields.find((field) => field.id === fieldId)
  if (!row) {
    return {
      ok: false,
      reason: 'missing',
      message: `Field ${fieldId} is not present in ${tab.name}.`,
    }
  }
  if (row.value.trim().length === 0) {
    return { ok: false, reason: 'empty', message: `Field ${fieldId} in ${tab.name} is empty.` }
  }
  const hex = toHex(row.value)
  // A binary field edited as text can hold characters that are not hex; say so
  // rather than silently loading a truncated block.
  if (hex.length !== row.value.replace(/\s/g, '').length) {
    return {
      ok: false,
      reason: 'not-hex',
      message: `Field ${fieldId} in ${tab.name} is not hex. Switch the row's Fmt column to hex, or paste the block by hand.`,
    }
  }
  return { ok: true, hex }
}

/**
 * Produces the field list that writes `hex` into `fieldId`, inserting the row
 * in bit order when it does not exist yet.
 */
export function fieldsWithValue(tab: BufferTab, fieldId: number, hex: string): FieldRow[] {
  const fields = tab.fields.slice()
  const index = fields.findIndex((field) => field.id === fieldId)
  const existing = index === -1 ? undefined : fields[index]

  const row: FieldRow = {
    ...(existing ?? {}),
    id: fieldId,
    value: hex,
    desc: existing?.desc ?? 'PIN DATA',
    type: existing?.type ?? 'B',
    hex: true,
    invalid: undefined,
  }

  if (index === -1) {
    const at = fields.findIndex((field) => field.id > fieldId)
    if (at === -1) fields.push(row)
    else fields.splice(at, 0, row)
  } else {
    fields[index] = row
  }
  return fields
}

/**
 * Asks the workspace to reveal and flash a field row. The shell owns the field
 * table; the tool only names the bit (UX_SPEC 4.2 command plumbing).
 */
export function flashField(fieldId: number): void {
  const detail: ShellCommandDetail = { command: `jump-to-field:${fieldId}`, arg: fieldId }
  document.dispatchEvent(new CustomEvent<ShellCommandDetail>(SHELL_COMMAND_EVENT, { detail }))
}

/** `F52 · PIN DATA` — the label on the target selector. */
export function fieldLabel(tab: BufferTab | undefined, fieldId: number): string {
  const row = tab?.fields.find((field) => field.id === fieldId)
  return row?.desc ? `F${fieldId} · ${row.desc}` : `F${fieldId}`
}

/**
 * Target-bit options: every field the buffer actually carries, plus 52 so the
 * default is always offered even on an empty buffer.
 */
export function targetOptions(
  tab: BufferTab | undefined,
  current: number,
): { value: string; label: string }[] {
  const ids = new Set<number>([52, current])
  for (const field of tab?.fields ?? []) ids.add(field.id)
  return [...ids]
    .sort((a, b) => a - b)
    .map((id) => ({ value: String(id), label: fieldLabel(tab, id) }))
}
