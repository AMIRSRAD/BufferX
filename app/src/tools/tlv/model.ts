/**
 * The TLV tool's data model.
 *
 * The engine owns parsing and encoding; this module only reshapes what the
 * engine returns into something a tree grid and a table can render, and
 * reshapes an edited tree back into the `<Tlv>` document the engine's
 * `tlv.fromXml` accepts. There is deliberately **no TLV encoder here** — a
 * second encoder would be a second source of truth, and the two would drift.
 * Re-encoding an edited tree is one `tlv.fromXml` call.
 *
 * The one piece of BER arithmetic that does live here is `encodedSize`, used to
 * keep a constructed node's displayed length honest after a child is edited.
 * It is length bookkeeping, not encoding: no bytes are produced.
 */

import { normalizeHex } from '@/components/ui/HexInput'
import { describePath, describeTag, UNKNOWN_TAG_LABEL } from './tags'

/* ── Engine wire shapes (bufferx_abi.cpp, opTlvParse) ─────────────────────── */

export interface EngineTlvNode {
  /** Space-separated uppercase hex, e.g. `9F 02`. */
  tag: string
  /** Payload length in bytes: value bytes, or the children's encoded size. */
  length: number
  /** Space-separated uppercase hex; empty for a constructed node. */
  value: string
  /** Printable bytes verbatim, others as `\xNN`. */
  ascii: string
  composite: boolean
  children: EngineTlvNode[]
}

export interface EngineFlatEntry {
  path: string
  description: string
  tag: string
  value: string
  ascii: string
}

export interface TlvParseResponse {
  nodes: EngineTlvNode[]
  tree: string
  flat: EngineFlatEntry[]
  inline: string
}

export interface TlvValidateResponse {
  valid: boolean
  message: string
  nodeCount: number
}

/* ── View model ───────────────────────────────────────────────────────────── */

export interface TlvNode {
  /** Stable positional id, e.g. `0.2.1`. Survives edits; not a tag. */
  id: string
  /** Engine-style path: tag bytes joined by `/`, ancestors first. */
  path: string
  /** Compact uppercase tag, e.g. `9F02`. */
  tagHex: string
  /** Dictionary name, or an empty string when no dictionary matched. */
  name: string
  /** Payload length in bytes. */
  length: number
  /** Compact uppercase value hex. Empty for a constructed node. */
  valueHex: string
  /** Debug ASCII of the value, matching the engine's rendering. */
  ascii: string
  composite: boolean
  children: TlvNode[]
}

/** One row of the Flat view. Constructed nodes are included and marked. */
export interface TlvFlatRow {
  id: string
  path: string
  tagHex: string
  name: string
  length: number
  valueHex: string
  ascii: string
  composite: boolean
  depth: number
}

/* ── Hex and text helpers ─────────────────────────────────────────────────── */

/** `9F02` → `9F 02`. Presentation only. */
export function spaceHex(hex: string): string {
  return (hex.match(/.{1,2}/g) ?? []).join(' ')
}

/** `9F02` → `9F/02`, the segment form `tlvtool::flatten` builds paths from. */
export function tagSegment(tagHex: string): string {
  return (tagHex.match(/.{1,2}/g) ?? []).join('/')
}

export function hexByteLength(hex: string): number {
  return Math.floor(normalizeHex(hex).length / 2)
}

/** True when the text is hex with an even nibble count (empty counts as true). */
export function isWholeBytes(hex: string): boolean {
  return normalizeHex(hex).length % 2 === 0
}

/**
 * The first character that is neither hex nor whitespace, with its 1-based
 * position, so the error can name it (DESIGN_SYSTEM §7 rule 1).
 */
export function firstNonHex(text: string): { char: string; position: number } | null {
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    if (/[0-9a-fA-F\s]/.test(char)) continue
    return { char, position: index + 1 }
  }
  return null
}

/** Mirrors `tlvtool::toAsciiDebug`: printable bytes verbatim, others `\xNN`. */
export function hexToAsciiDebug(hex: string): string {
  const clean = normalizeHex(hex)
  let out = ''
  for (let index = 0; index + 1 < clean.length; index += 2) {
    const byte = Number.parseInt(clean.slice(index, index + 2), 16)
    if (Number.isNaN(byte)) continue
    out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : `\\x${clean.slice(index, index + 2)}`
  }
  return out
}

/** UTF-8 bytes of `text` as compact uppercase hex. */
export function textToHex(text: string): string {
  let out = ''
  for (const byte of new TextEncoder().encode(text)) {
    out += byte.toString(16).padStart(2, '0').toUpperCase()
  }
  return out
}

/** Bytes the engine will read from the payload box, as compact hex. */
export function payloadToHex(payload: string, inputHex: boolean): string {
  return inputHex ? normalizeHex(payload) : textToHex(payload)
}

/** True when the tag's leading byte carries the constructed bit (0x20). */
export function tagIsConstructed(tagHex: string): boolean {
  const clean = normalizeHex(tagHex)
  if (clean.length < 2) return false
  const first = Number.parseInt(clean.slice(0, 2), 16)
  return Number.isNaN(first) ? false : (first & 0x20) !== 0
}

/* ── Normalisation ────────────────────────────────────────────────────────── */

function nameFor(path: string, tagHex: string, engineNames: ReadonlyMap<string, string>): string {
  const fromEngine = engineNames.get(path)
  if (fromEngine !== undefined && fromEngine !== '') return fromEngine
  return describePath(path) ?? describeTag(tagHex) ?? ''
}

function normalizeNode(
  node: EngineTlvNode,
  parentPath: string,
  id: string,
  engineNames: ReadonlyMap<string, string>,
): TlvNode {
  const tagHex = normalizeHex(node.tag)
  const segment = tagSegment(tagHex)
  const path = parentPath === '' ? segment : `${parentPath}/${segment}`
  const children = (node.children ?? []).map((child, index) =>
    normalizeNode(child, path, `${id}.${index}`, engineNames),
  )

  return {
    id,
    path,
    tagHex,
    name: nameFor(path, tagHex, engineNames),
    length: node.length,
    valueHex: normalizeHex(node.value),
    ascii: node.ascii ?? '',
    composite: node.composite === true,
    children,
  }
}

/**
 * Reshapes a `tlv.parse` response into the view model, joining the engine's
 * leaf descriptions onto every node by path.
 */
export function normalizeParse(response: TlvParseResponse): TlvNode[] {
  const engineNames = new Map<string, string>()
  for (const entry of response.flat ?? []) {
    if (entry.description !== '') engineNames.set(entry.path, entry.description)
  }
  return (response.nodes ?? []).map((node, index) => normalizeNode(node, '', String(index), engineNames))
}

/** Total node count, constructed nodes included. */
export function countNodes(nodes: readonly TlvNode[]): number {
  let total = 0
  for (const node of nodes) total += 1 + countNodes(node.children)
  return total
}

/** Ids of every constructed node, for `Expand all`. */
export function expandableIds(nodes: readonly TlvNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.children.length > 0) {
      ids.push(node.id)
      ids.push(...expandableIds(node.children))
    }
  }
  return ids
}

/* ── Length bookkeeping ───────────────────────────────────────────────────── */

/** Bytes a BER length field occupies for `length`. */
function lengthFieldSize(length: number): number {
  if (length < 0x80) return 1
  let bytes = 0
  let remaining = length
  while (remaining > 0) {
    bytes += 1
    remaining = Math.floor(remaining / 256)
  }
  return 1 + bytes
}

/** Total encoded size of a node: tag + length field + payload. */
export function encodedSize(node: TlvNode): number {
  return node.tagHex.length / 2 + lengthFieldSize(node.length) + node.length
}

/** Recomputes constructed lengths bottom-up after an edit. */
function withRecomputedLengths(node: TlvNode): TlvNode {
  if (!node.composite) return node
  const children = node.children.map(withRecomputedLengths)
  let length = 0
  for (const child of children) length += encodedSize(child)
  return { ...node, children, length }
}

/**
 * Replaces one primitive node's value and repairs every ancestor's length, so
 * the tree never displays a length that its own bytes contradict.
 */
export function setNodeValue(nodes: readonly TlvNode[], id: string, valueHex: string): TlvNode[] {
  const clean = normalizeHex(valueHex)

  const visit = (node: TlvNode): TlvNode => {
    if (node.id === id && !node.composite) {
      return {
        ...node,
        valueHex: clean,
        ascii: hexToAsciiDebug(clean),
        length: Math.floor(clean.length / 2),
      }
    }
    if (node.children.length === 0) return node
    return { ...node, children: node.children.map(visit) }
  }

  return nodes.map(visit).map(withRecomputedLengths)
}

/** Finds a node anywhere in the tree. */
export function findNode(nodes: readonly TlvNode[], id: string): TlvNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return undefined
}

/* ── Flattening ───────────────────────────────────────────────────────────── */

/**
 * Every node as a row, parents before children.
 *
 * The engine's own `flat` array is leaves-only; including constructed nodes here
 * is a superset, and each is marked so a reader can tell a branch from a leaf.
 */
export function flattenTree(nodes: readonly TlvNode[], depth = 0): TlvFlatRow[] {
  const rows: TlvFlatRow[] = []
  for (const node of nodes) {
    rows.push({
      id: node.id,
      path: node.path,
      tagHex: node.tagHex,
      name: node.name,
      length: node.length,
      valueHex: node.valueHex,
      ascii: node.ascii,
      composite: node.composite,
      depth,
    })
    rows.push(...flattenTree(node.children, depth + 1))
  }
  return rows
}

const TSV_HEADER = ['Path', 'Tag', 'Name', 'Len', 'Value (hex)', 'Value (ascii)'].join('\t')

function tsvCell(text: string): string {
  return text.replace(/[\t\r\n]/g, ' ')
}

/** The Flat view as TSV with a header row (UX_SPEC 5.2). */
export function flatRowsToTsv(rows: readonly TlvFlatRow[]): string {
  const lines = [TSV_HEADER]
  for (const row of rows) {
    lines.push(
      [
        tsvCell(row.path),
        tsvCell(spaceHex(row.tagHex)),
        tsvCell(row.name === '' ? UNKNOWN_TAG_LABEL : row.name),
        String(row.length),
        tsvCell(spaceHex(row.valueHex)),
        tsvCell(row.ascii),
      ].join('\t'),
    )
  }
  return lines.join('\n')
}

/* ── XML ──────────────────────────────────────────────────────────────────── */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function appendXml(node: TlvNode, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth)
  if (node.composite) {
    lines.push(`${indent}<Node tag="${escapeXml(node.tagHex)}" constructed="true">`)
    for (const child of node.children) appendXml(child, depth + 1, lines)
    lines.push(`${indent}</Node>`)
    return
  }
  lines.push(`${indent}<Node tag="${escapeXml(node.tagHex)}" value="${escapeXml(node.valueHex)}" />`)
}

/**
 * The `<Tlv>` document `tlv.fromXml` reads, in the same shape `tlv.toXml`
 * writes. Round-tripping an edited tree through this is how `Re-encode` works
 * without a second encoder.
 */
export function nodesToXml(nodes: readonly TlvNode[]): string {
  const lines = ['<Tlv>']
  for (const node of nodes) appendXml(node, 1, lines)
  lines.push('</Tlv>')
  return `${lines.join('\n')}\n`
}
