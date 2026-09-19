import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { Popover } from '@/components/ui/Popover'
import { framingLabel } from './wire'
import type { Endpoint } from './networkStore'

export interface SavedEndpointsProps {
  endpoints: Endpoint[]
  onApply: (id: string) => void
  onRemove: (id: string) => void
  disabled?: boolean
}

/**
 * The `[Saved ▾]` picker of UX_SPEC 3.8.
 *
 * A popover rather than a `Select`, because each row carries a destructive
 * action of its own and a native listbox cannot hold one. Rows state the whole
 * profile (`10.20.30.40:5000 · ASCII/4`) so the operator can tell two
 * similarly-named hosts apart before committing to one.
 */
export function SavedEndpoints({ endpoints, onApply, onRemove, disabled = false }: SavedEndpointsProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      padded={false}
      className="w-80"
      trigger={
        <Button size="xs" variant="default" iconRight={ChevronDown} disabled={disabled}>
          Saved
          {endpoints.length > 0 ? ` (${endpoints.length})` : ''}
        </Button>
      }
    >
      {endpoints.length === 0 ? (
        <p className="p-panel text-xs text-text-secondary">
          No saved endpoints yet. Fill in the host, port and framing, then choose
          <span className="text-text"> Save endpoint</span>.
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id} className="flex items-center gap-1 px-1">
              <button
                type="button"
                className="min-w-0 flex-1 rounded-xs px-2 py-1 text-left hover:bg-surface-2"
                onClick={() => {
                  onApply(endpoint.id)
                  setOpen(false)
                }}
              >
                <span className="block truncate text-xs text-text">{endpoint.name}</span>
                <span className="block truncate font-mono text-mono-xs text-text-tertiary">
                  {endpoint.host || '(no host)'}:{endpoint.port} ·{' '}
                  {endpoint.framing === 'none'
                    ? 'No framing'
                    : `${framingLabel(endpoint.framing)}/${endpoint.headerSize}`}{' '}
                  · {endpoint.timeoutMs} ms
                </span>
              </button>
              <IconButton
                icon={Trash2}
                label={`Delete endpoint ${endpoint.name}`}
                size="xs"
                variant="ghost"
                onClick={() => onRemove(endpoint.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}
