import { useEffect, useRef } from 'react'
import { ChevronDown, Columns2, FileCode2, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { useTools } from '@/store/tools'
import { getTool } from '@/tools/registry'
import { clearToolStatus } from './toolStatus'

/** Document tabs above select the data; these tabs select the working surface. */
export function WorkspaceTabs({ split, canSplit, onToggleSplit }: {
  split: boolean
  canSplit: boolean
  onToggleSplit(): void
}) {
  const { open, promoted, openTool, closeTool, unpromote } = useTools()
  const list = useRef<HTMLDivElement>(null)
  const entries = [{ id: 'buffer', title: 'Buffer', icon: FileCode2 }, ...open.flatMap((id) => {
    const tool = getTool(id)
    return tool ? [tool] : []
  })]
  const selected = promoted ?? 'buffer'
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selected])
  function select(id: string) {
    if (id === 'buffer') unpromote()
    else openTool(id)
  }
  return (
    <div className="flex min-w-0 shrink-0 items-center border-b border-border bg-surface-1">
      <div ref={list} role="tablist" aria-label="Workspaces" className="flex min-w-0 flex-1 overflow-x-auto"
        onKeyDown={(event) => {
          const index = entries.findIndex((entry) => entry.id === selected)
          let next = index
          if (event.key === 'ArrowRight') next = (index + 1) % entries.length
          else if (event.key === 'ArrowLeft') next = (index - 1 + entries.length) % entries.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = entries.length - 1
          else return
          event.preventDefault()
          const entry = entries[next]
          if (entry) { select(entry.id); document.getElementById(`workspace-tab-${entry.id}`)?.focus() }
        }}>
        {entries.map((entry) => (
          <div key={entry.id} className={cn('group flex h-10 shrink-0 items-center border-r border-border-subtle border-b-2', selected === entry.id ? 'border-b-accent bg-surface-2 text-text' : 'border-b-transparent text-text-secondary')}>
            <button type="button" role="tab" id={`workspace-tab-${entry.id}`} aria-controls={`workspace-${entry.id}`}
              aria-selected={selected === entry.id} tabIndex={selected === entry.id ? 0 : -1}
              onClick={() => select(entry.id)} className="flex h-full items-center gap-2 px-3 text-sm hover:bg-surface-raised">
              <entry.icon size={14} aria-hidden="true" />{entry.title}
            </button>
            {entry.id !== 'buffer' && <button type="button" aria-label={`Close ${entry.title}`} className="mr-1 rounded p-1 text-text-tertiary hover:bg-surface-raised hover:text-text"
              onClick={() => {
                clearToolStatus(entry.id)
                closeTool(entry.id)
                const next = useTools.getState().promoted ?? 'buffer'
                queueMicrotask(() => document.getElementById(`workspace-tab-${next}`)?.focus())
              }}><X size={12} aria-hidden="true" /></button>}
          </div>
        ))}
      </div>
      {entries.length > 4 && <div className="relative mx-1 flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface-raised">
        <ChevronDown size={14} aria-hidden="true" />
        <select aria-label="All workspaces" title="All workspaces" value={selected} onChange={(event) => select(event.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0">
          {entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
      </div>}
      {promoted && <Button size="xs" variant="ghost" icon={split ? Maximize2 : Columns2} disabled={!canSplit}
        title={canSplit ? (split ? 'Give this tool the full workspace' : 'Show the buffer beside this tool') : 'Widen the window to use split view'}
        aria-pressed={split} onClick={onToggleSplit} className="mx-2 shrink-0">
        {split ? 'Focus tool' : 'Split with buffer'}
      </Button>}
    </div>
  )
}
