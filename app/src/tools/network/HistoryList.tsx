import { RotateCw, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { formatClock, framingLabel } from './wire'
import type { HistoryEntry, HistoryStatus } from './networkStore'

export interface HistoryListProps {
  entries: HistoryEntry[]
  /** Restores the row's settings and request body into the form. */
  onLoad: (entry: HistoryEntry) => void
  /** Restores and immediately sends again. */
  onResend: (entry: HistoryEntry) => void
  /** Disabled when the host cannot open sockets or a send is already running. */
  resendDisabled: boolean
  /** Why resend is unavailable, for the button tooltip. */
  resendReason?: string
}

const STATUS_TONE: Record<HistoryStatus, 'ok' | 'error' | 'warn'> = {
  ok: 'ok',
  error: 'error',
  cancelled: 'warn',
}

const STATUS_LABEL: Record<HistoryStatus, string> = {
  ok: 'ok',
  error: 'failed',
  cancelled: 'cancelled',
}

/**
 * The session send log of UX_SPEC 3.8.
 *
 * Memory-only, and bounded: every row holds the request body it was sent with,
 * which is live message content (UX_SPEC 5.5). Rows are laid out as a
 * definition-style grid rather than a `DataTable` because each carries two
 * actions and no cell is editable.
 */
export function HistoryList({
  entries,
  onLoad,
  onResend,
  resendDisabled,
  resendReason,
}: HistoryListProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-sm border border-border-subtle bg-surface-1 px-cell-x py-2 text-xs text-text-tertiary">
        No sends yet this session. History is kept in memory only — it holds request bodies.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border-subtle bg-surface-1 px-cell-x py-cell-y"
        >
          <span className="font-mono text-mono-xs text-text-tertiary tabular-nums">
            {formatClock(entry.at)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-mono-xs text-text">
            {entry.host}:{entry.port}
          </span>
          <span className="font-mono text-mono-xs text-text-secondary">
            {entry.framing === 'none' ? 'none' : `${framingLabel(entry.framing)}/${entry.headerSize}`}
          </span>
          <span className="font-mono text-mono-xs text-text-secondary tabular-nums">
            {entry.bytesSent}→{entry.bytesReceived}B
          </span>
          <span className="font-mono text-mono-xs text-text-secondary tabular-nums">
            {entry.elapsedMs}ms
          </span>
          <Badge tone={STATUS_TONE[entry.status]} dot>
            {STATUS_LABEL[entry.status]}
          </Badge>
          <span className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              icon={RotateCw}
              disabled={resendDisabled}
              title={resendDisabled ? resendReason : `Resend to ${entry.host}:${entry.port}`}
              onClick={() => onResend(entry)}
            >
              Resend
            </Button>
            <Button
              size="xs"
              variant="ghost"
              icon={Upload}
              title="Load this request back into the form"
              onClick={() => onLoad(entry)}
            >
              Load
            </Button>
          </span>
          {entry.message ? (
            <p className="w-full text-2xs text-text-tertiary">{entry.message}</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
