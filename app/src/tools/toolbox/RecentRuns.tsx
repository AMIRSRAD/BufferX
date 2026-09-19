import { RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { IconButton } from '@/components/ui/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import type { OperationDef } from './operations'
import type { ToolboxRun } from './history'

export interface RecentRunsProps {
  operation: OperationDef
  runs: readonly ToolboxRun[]
  /** Restores the run's inputs and runs again. Absent for key operations. */
  onReplay: (run: ToolboxRun) => void
  /** True when a re-run without stored inputs cannot proceed right now. */
  canRerunFromForm: boolean
  onClear: () => void
  busy: boolean
}

const TIME = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function preview(run: ToolboxRun): string {
  if (run.outputIsSecret) return `•••• ${Math.floor(run.output.length / 2)} bytes`
  if (run.output.length <= 34) return run.output
  return `${run.output.slice(0, 24)}…${run.output.slice(-6)}`
}

/**
 * The last twenty runs of the selected operation (UX_SPEC 3.7).
 *
 * Rows for key operations show a masked hint and no stored inputs, so their
 * `re-run` uses whatever key is in the form — stated in the tooltip rather than
 * left as a surprise.
 */
export function RecentRuns({
  operation,
  runs,
  onReplay,
  canRerunFromForm,
  onClear,
  busy,
}: RecentRunsProps) {
  if (runs.length === 0) return null

  return (
    <section aria-label="Recent runs" className="flex flex-col gap-1.5">
      <header className="flex items-center gap-2">
        <h3 className="text-2xs font-medium tracking-wide text-text-tertiary uppercase">Recent</h3>
        <span className="text-2xs text-text-tertiary">
          {runs.length} of the last 20 · this session only
        </span>
        <IconButton
          icon={Trash2}
          size="xs"
          variant="ghost"
          label="Clear recent runs"
          className="ml-auto"
          onClick={onClear}
        />
      </header>

      <ul className="flex flex-col divide-y divide-border-subtle rounded-sm border border-border-subtle">
        {runs.map((run) => {
          const replayable = run.replay !== null
          const disabled = busy || (!replayable && !canRerunFromForm)
          return (
            <li key={run.id} className="flex items-center gap-2 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-mono-xs text-text">
                {preview(run)}
              </span>
              <span className="hidden shrink-0 truncate text-2xs text-text-tertiary sm:inline">
                {run.hint}
              </span>
              <span className="shrink-0 font-mono text-mono-xs tabular-nums text-text-tertiary">
                {TIME.format(run.at)}
              </span>
              <CopyButton
                value={run.output}
                label={`Copy result from ${TIME.format(run.at)}`}
                size="xs"
              />
              <Tooltip
                content={
                  replayable
                    ? 'Restore these inputs and run again'
                    : canRerunFromForm
                      ? `Keys are never stored — this re-runs ${operation.label} with the key currently in the form.`
                      : `Keys are never stored, so this row cannot be replayed. Fill the form to run ${operation.label} again.`
                }
              >
                <span>
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={RotateCw}
                    disabled={disabled}
                    onClick={() => onReplay(run)}
                  >
                    re-run
                  </Button>
                </span>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
