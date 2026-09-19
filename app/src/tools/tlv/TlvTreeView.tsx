/**
 * The `Tree` view of a parsed TLV payload (UX_SPEC 3.5).
 *
 * > Expand/collapse per node, `Expand all` / `Collapse all`, arrow-key
 * > navigation, `Enter` to edit a node value in place. […] Editing a node marks
 * > the tree dirty and enables `Re-encode`, which regenerates `Encoded` — so the
 * > tree is an editor, not a printout.
 *
 * Editing is confined to primitive nodes: a constructed node's bytes *are* its
 * children, so it is edited by editing them.
 */

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Copy, PencilLine, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Popover } from '@/components/ui/Popover'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tree } from '@/components/ui/Tree'
import { normalizeHex } from '@/components/ui/HexInput'
import { cn } from '@/lib/cn'
import { countNodes, expandableIds, spaceHex, type TlvNode } from './model'
import { UNKNOWN_TAG_LABEL } from './tags'

export interface TlvTreeViewProps {
  nodes: TlvNode[]
  /** Bumped on every fresh parse; resets expansion without fighting edits. */
  generation: number
  dirty: boolean
  reencoding: boolean
  onEditValue: (id: string, valueHex: string) => void
  onReencode: () => void
  /** Resolves to the node's own TLV hex, or rejects with an engine message. */
  onCopyNodeTlv: (node: TlvNode) => Promise<string>
  className?: string
}

export function TlvTreeView({
  nodes,
  generation,
  dirty,
  reencoding,
  onEditValue,
  onReencode,
  onCopyNodeTlv,
  className,
}: TlvTreeViewProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(expandableIds(nodes)))
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const total = useMemo(() => countNodes(nodes), [nodes])
  const branches = useMemo(() => expandableIds(nodes), [nodes])

  // A new parse re-expands. An in-place edit does not, because that would throw
  // away the shape the operator just arranged.
  useEffect(() => {
    setExpanded(new Set(expandableIds(nodes)))
    setSelectedId(undefined)
    setEditingId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation])

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const beginEdit = (node: TlvNode) => {
    setEditingId(node.id)
    setDraft(node.valueHex)
  }

  const commitEdit = (node: TlvNode) => {
    setEditingId(null)
    if (draft !== node.valueHex) onEditValue(node.id, draft)
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    const node = findIn(nodes, id)
    if (node && !node.composite) beginEdit(node)
    else setEditingId(null)
  }

  return (
    <div className={cn('flex min-h-0 flex-col gap-field', className)}>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="xs"
          variant="subtle"
          icon={ChevronsUpDown}
          onClick={() => setExpanded(new Set(branches))}
          disabled={branches.length === 0}
        >
          Expand all
        </Button>
        <Button
          size="xs"
          variant="subtle"
          icon={ChevronsDownUp}
          onClick={() => setExpanded(new Set())}
          disabled={branches.length === 0}
        >
          Collapse all
        </Button>

        <span className="ml-1 text-2xs text-text-tertiary tabular-nums">
          {total} {total === 1 ? 'node' : 'nodes'}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {dirty ? <Badge tone="warn">edited</Badge> : null}
          <Button
            size="xs"
            variant={dirty ? 'primary' : 'subtle'}
            icon={RefreshCw}
            disabled={!dirty || reencoding}
            loading={reencoding}
            onClick={onReencode}
          >
            Re-encode
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-surface-1">
        <Tree<TlvNode>
          aria-label="TLV structure"
          nodes={nodes}
          getChildren={(node) => node.children}
          expandedIds={expanded}
          onToggle={toggle}
          selectedId={selectedId}
          onSelect={handleSelect}
          virtualized={total > 60}
          className="max-h-96"
          renderNode={(node) => (
            <TlvTreeRow
              node={node}
              editing={editingId === node.id}
              draft={draft}
              onDraftChange={setDraft}
              onBeginEdit={() => beginEdit(node)}
              onCommit={() => commitEdit(node)}
              onCancel={() => setEditingId(null)}
              onCopyNodeTlv={onCopyNodeTlv}
            />
          )}
        />
      </div>
    </div>
  )
}

function findIn(nodes: readonly TlvNode[], id: string): TlvNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findIn(node.children, id)
    if (found) return found
  }
  return undefined
}

/* ── Row ──────────────────────────────────────────────────────────────────── */

function TlvTreeRow({
  node,
  editing,
  draft,
  onDraftChange,
  onBeginEdit,
  onCommit,
  onCancel,
  onCopyNodeTlv,
}: {
  node: TlvNode
  editing: boolean
  draft: string
  onDraftChange: (value: string) => void
  onBeginEdit: () => void
  onCommit: () => void
  onCancel: () => void
  onCopyNodeTlv: (node: TlvNode) => Promise<string>
}) {
  const handleEditorKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    // The tree row owns arrow keys, Enter and `*`. While an editor is open they
    // belong to the editor, so nothing reaches the row.
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <>
      <span className="w-[7ch] shrink-0 font-mono text-mono-xs text-hl-1">{spaceHex(node.tagHex)}</span>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          node.name === '' ? 'text-text-tertiary italic' : 'text-text-secondary',
        )}
        title={node.name === '' ? UNKNOWN_TAG_LABEL : node.name}
      >
        {node.name === '' ? UNKNOWN_TAG_LABEL : node.name}
      </span>

      <span className="w-[4ch] shrink-0 text-right font-mono text-mono-xs text-text-tertiary tabular-nums">
        {node.length}
      </span>

      {node.composite ? (
        <span className="w-[18ch] shrink-0 text-2xs text-text-tertiary">
          constructed · {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
        </span>
      ) : editing ? (
        <input
          autoFocus
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Value hex for tag ${spaceHex(node.tagHex)}`}
          onChange={(event) => onDraftChange(normalizeHex(event.target.value))}
          onKeyDown={handleEditorKeys}
          onClick={(event) => event.stopPropagation()}
          onBlur={onCommit}
          className="h-control-xs w-[18ch] min-w-0 shrink-0 rounded-xs bg-surface-2 px-1 font-mono text-mono-xs text-text outline-none inset-ring-1 inset-ring-accent"
        />
      ) : (
        <span
          className="w-[18ch] shrink-0 truncate font-mono text-mono-xs text-text"
          title={spaceHex(node.valueHex)}
        >
          {node.valueHex === '' ? '—' : spaceHex(node.valueHex)}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
        <NodeCopyMenu node={node} onCopyNodeTlv={onCopyNodeTlv} />
        {node.composite ? (
          <IconButton
            icon={PencilLine}
            label="A constructed node carries its children, not a value. Edit a child instead."
            size="xs"
            variant="ghost"
            disabled
          />
        ) : (
          <IconButton
            icon={PencilLine}
            label={`Edit value of tag ${spaceHex(node.tagHex)}`}
            size="xs"
            variant="ghost"
            onClick={onBeginEdit}
          />
        )}
      </span>
    </>
  )
}

/* ── Per-node copy menu ───────────────────────────────────────────────────── */

function NodeCopyMenu({
  node,
  onCopyNodeTlv,
}: {
  node: TlvNode
  onCopyNodeTlv: (node: TlvNode) => Promise<string>
}) {
  const [open, setOpen] = useState(false)
  const [nodeTlv, setNodeTlv] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setNodeTlv(null)
    setError(null)
    onCopyNodeTlv(node)
      .then((hex) => {
        if (!cancelled) setNodeTlv(hex)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The node could not be encoded.')
      })
    return () => {
      cancelled = true
    }
  }, [open, node, onCopyNodeTlv])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      side="bottom"
      trigger={
        <IconButton
          icon={Copy}
          label={`Copy from tag ${spaceHex(node.tagHex)}`}
          size="xs"
          variant="ghost"
        />
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-2xs tracking-wide text-text-secondary uppercase">
          Copy · tag {spaceHex(node.tagHex)}
        </p>

        <div className="flex flex-col items-start gap-1">
          <CopyButton value={spaceHex(node.tagHex)} label="Copy tag" size="xs" variant="subtle" showLabel />
          <CopyButton value={String(node.length)} label="Copy length" size="xs" variant="subtle" showLabel />
          {node.composite ? null : (
            <CopyButton
              value={spaceHex(node.valueHex)}
              label="Copy value"
              size="xs"
              variant="subtle"
              showLabel
            />
          )}

          {error !== null ? (
            <InlineAlert tone="error" title="Node TLV unavailable">
              {error}
            </InlineAlert>
          ) : nodeTlv === null ? (
            <Skeleton height={22} width={128} />
          ) : (
            <CopyButton value={nodeTlv} label="Copy node TLV" size="xs" variant="subtle" showLabel />
          )}
        </div>
      </div>
    </Popover>
  )
}
