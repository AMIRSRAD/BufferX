/**
 * Legacy ATM engine framing rules (UX_SPEC 3.9 → Engine).
 *
 * The old app applied these silently the moment the checkbox was ticked, with no
 * indication anywhere in the main view that a mode with this blast radius was
 * active. Here the table is rendered, the consequence for the *current* packager
 * is previewed, and the operator presses `Apply`.
 *
 * The rules are reproduced from the spec table:
 *
 * | Packager family                                        | Header | Auto | Mode   | Size |
 * |--------------------------------------------------------|--------|------|--------|------|
 * | HYPERCOM                                               | on     | on   | Binary | 2    |
 * | DATASET, TABLE*, AMNT*, STX*, STMNT2003, BIT121        | off    | off  | —      | —    |
 * | all others                                             | on     | on   | ASCII  | 4    |
 *
 * The old app carried a fourth rule — `activePackager === "SLMLink" ? 7 : 4`,
 * hardcoded in Main.qml — giving SLMLink a 7-digit header. `SLMLink` is not in
 * the shipped definitions any more (it was replaced by `NEGINLink`), so that
 * rule matched nothing and was removed. `NEGINLink` declares `LenLen="4"`, the
 * same as `NEGIN`, so the default row is the correct rule for it. If a host
 * ever needs the 7-digit variant back, add a row here rather than reviving the
 * name check.
 */

import type { HeaderConfig } from '@/store/buffers'

export interface FramingRule {
  /** Row id, for React keys and for the preview's provenance line. */
  id: string
  /** How the row is labelled in the table. */
  family: string
  enabled: boolean
  autoDetect: boolean
  mode: HeaderConfig['mode']
  /** `null` renders as `—`: the rule leaves the size alone. */
  size: number | null
}

export const LEGACY_FRAMING_TABLE: readonly FramingRule[] = [
  { id: 'hypercom', family: 'HYPERCOM', enabled: true, autoDetect: true, mode: 'binary', size: 2 },
  {
    id: 'headerless',
    family: 'DATASET, TABLE*, AMNT*, STX*, STMNT2003, BIT121',
    enabled: false,
    autoDetect: false,
    mode: 'none',
    size: null,
  },
  { id: 'default', family: 'all others', enabled: true, autoDetect: true, mode: 'ascii', size: 4 },
]

const HEADERLESS_EXACT = new Set(['DATASET', 'STMNT2003', 'BIT121'])
const HEADERLESS_PREFIXES = ['TABLE', 'AMNT', 'STX']

/** Looks a rule up by id, so reordering or removing a row cannot silently
 *  repoint a rule at its neighbour the way positional indexing did. */
function ruleById(id: string): FramingRule {
  const found = LEGACY_FRAMING_TABLE.find((rule) => rule.id === id)
  if (!found) {
    throw new Error(`Legacy framing rule "${id}" is missing from LEGACY_FRAMING_TABLE.`)
  }
  return found
}

/** The rule the legacy engine applies to `packager`. Never returns undefined. */
export function legacyFramingFor(packager: string): FramingRule {
  const name = packager.trim().toUpperCase()

  if (name === 'HYPERCOM') return ruleById('hypercom')
  if (HEADERLESS_EXACT.has(name) || HEADERLESS_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return ruleById('headerless')
  }
  return ruleById('default')
}

/** The framing a rule produces, given what the buffer has now. */
export function applyRule(
  rule: FramingRule,
  current: HeaderConfig,
): { header: HeaderConfig; autoDetect: boolean } {
  return {
    header: {
      enabled: rule.enabled,
      mode: rule.mode,
      // A `—` size means the rule is silent about width; the buffer keeps its own.
      size: rule.size ?? current.size,
    },
    autoDetect: rule.autoDetect,
  }
}

/** One line of the before/after preview card. */
export interface FramingChange {
  label: string
  before: string
  after: string
  changed: boolean
}

function modeLabel(mode: HeaderConfig['mode']): string {
  if (mode === 'ascii') return 'ASCII'
  if (mode === 'binary') return 'Binary'
  return 'None'
}

/**
 * What switching the legacy engine on would do to this buffer.
 *
 * Switching it *off* changes nothing by itself -- the rules simply stop being
 * applied on the next packager change -- so the caller renders a sentence rather
 * than a diff in that direction.
 */
export function previewLegacyFraming(
  packager: string,
  header: HeaderConfig,
  autoDetect: boolean,
): { rule: FramingRule; changes: FramingChange[] } {
  const rule = legacyFramingFor(packager)
  const next = applyRule(rule, header)

  const changes: FramingChange[] = [
    {
      label: 'Header enabled',
      before: header.enabled ? 'On' : 'Off',
      after: next.header.enabled ? 'On' : 'Off',
      changed: header.enabled !== next.header.enabled,
    },
    {
      label: 'Auto-detect',
      before: autoDetect ? 'On' : 'Off',
      after: next.autoDetect ? 'On' : 'Off',
      changed: autoDetect !== next.autoDetect,
    },
    {
      label: 'Header mode',
      before: modeLabel(header.mode),
      after: modeLabel(next.header.mode),
      changed: header.mode !== next.header.mode,
    },
    {
      label: 'Header size',
      before: String(header.size),
      after: rule.size === null ? `${String(header.size)} (unchanged)` : String(next.header.size),
      changed: header.size !== next.header.size,
    },
  ]

  return { rule, changes }
}

/** Body copy for the Engine section, promoted from the old tooltip verbatim. */
export const LEGACY_ENGINE_EXPLANATION =
  'Use AlmasPlus packed BCD, binary bitmap, length-prefix, and field-flag rules.'
