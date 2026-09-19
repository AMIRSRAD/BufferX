import { useCallback, useMemo, useRef, useState } from 'react'
import { Play, Wrench } from 'lucide-react'
import { tryCall } from '@/engine/client'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Kbd } from '@/components/ui/Kbd'
import { OperationForm } from './OperationForm'
import { OperationList } from './OperationList'
import { RecentRuns } from './RecentRuns'
import { ResultBlock } from './ResultBlock'
import {
  DEFAULT_OPERATION_ID,
  TOOLBOX_OPERATIONS,
  buildArgs,
  describeRun,
  getOperation,
  initialOperationState,
  validateOperation,
  type OperationDef,
  type OperationState,
} from './operations'
import { inputHint, maskedKeyHint, recentRuns, recordRun, clearRuns, type ToolboxRun } from './history'

interface RunOutcome {
  output: string
  meta: string
}

interface ToolsRunData {
  output: string
}

/**
 * The catalogue is a non-empty literal, but `noUncheckedIndexedAccess` cannot
 * see that; this keeps the panel total without a non-null assertion.
 */
const FALLBACK_OPERATION: OperationDef = TOOLBOX_OPERATIONS[0] ?? {
  id: 'sha256',
  label: 'SHA-256',
  group: 'hashes',
  summary: 'SHA-256 digest — 32 bytes.',
  keywords: [],
  input: { kind: 'dynamic', label: 'Input', multiline: true },
  inputMode: true,
  result: { kind: 'hex', label: 'Digest' },
}

/** Lazily seeds one form state per operation, so switching back restores it. */
function seedStates(): Record<string, OperationState> {
  const seed: Record<string, OperationState> = {}
  for (const operation of TOOLBOX_OPERATIONS) seed[operation.id] = initialOperationState(operation)
  return seed
}

/**
 * Toolbox — UX_SPEC 3.7.
 *
 * The old Banking Tools panel was a flat 21-item combobox over three inputs
 * that changed meaning without changing their labels. Here the operation list
 * is grouped and searchable, and the selected operation renders exactly the
 * inputs it consumes, each labelled for what it actually is.
 *
 * Secrets: the four key operations take their key through `SecretInput`, and
 * nothing in this panel writes a key to storage, a URL, or the console. Run
 * history is memory-only and holds a masked hint in place of any key.
 */
export default function ToolboxPanel() {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(DEFAULT_OPERATION_ID)
  const [states, setStates] = useState<Record<string, OperationState>>(seedStates)
  const [results, setResults] = useState<Record<string, RunOutcome | undefined>>({})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [attempted, setAttempted] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState<string | null>(null)
  // Bumped after each recorded run so the memory-backed history re-reads.
  const [historyVersion, setHistoryVersion] = useState(0)

  const runToken = useRef(0)

  const operation: OperationDef = getOperation(selectedId) ?? FALLBACK_OPERATION
  const state: OperationState = states[operation.id] ?? initialOperationState(operation)
  const result = results[operation.id]
  const error = errors[operation.id]
  const busy = running === operation.id

  const liveIssues = useMemo(
    () => validateOperation(operation, state, attempted[operation.id] === true),
    [operation, state, attempted],
  )

  // The history lives in module memory (never in storage), so `historyVersion`
  // is the invalidation signal rather than a value the memo reads.
  const runs = useMemo(() => {
    void historyVersion
    return recentRuns(operation.id)
  }, [operation.id, historyVersion])

  const patchState = useCallback(
    (id: string, patch: Partial<OperationState>) => {
      setStates((current) => {
        const base = current[id] ?? initialOperationState(getOperation(id) ?? operation)
        return { ...current, [id]: { ...base, ...patch } }
      })
    },
    [operation],
  )

  const execute = useCallback(
    async (target: OperationDef, nextState: OperationState) => {
      setAttempted((current) => ({ ...current, [target.id]: true }))

      const blocking = validateOperation(target, nextState, true)
      if (blocking.length > 0) {
        setErrors((current) => ({ ...current, [target.id]: undefined }))
        return
      }

      runToken.current += 1
      const token = runToken.current
      setRunning(target.id)
      setErrors((current) => ({ ...current, [target.id]: undefined }))

      const response = await tryCall<ToolsRunData>('tools.run', buildArgs(target, nextState))

      // A newer run for any operation supersedes this one.
      if (token !== runToken.current) return
      setRunning(null)

      if (!response.ok) {
        setErrors((current) => ({ ...current, [target.id]: response.error.message }))
        setResults((current) => ({ ...current, [target.id]: undefined }))
        return
      }

      const output = response.data.output
      setResults((current) => ({
        ...current,
        [target.id]: { output, meta: describeRun(target, nextState, output) },
      }))

      recordRun({
        op: target.id,
        at: Date.now(),
        output,
        outputIsSecret: target.result.kind === 'secret',
        hint: target.secretInput
          ? target.input
            ? maskedKeyHint(nextState.input)
            : `${nextState.parameter} bytes`
          : inputHint(nextState.input || nextState.secondary),
        // Key operations never retain their inputs (UX_SPEC 5.5).
        replay: target.secretInput ? null : { ...nextState },
      })
      setHistoryVersion((version) => version + 1)
    },
    [],
  )

  const handleRun = useCallback(() => {
    void execute(operation, state)
  }, [execute, operation, state])

  const handleReplay = useCallback(
    (run: ToolboxRun) => {
      if (run.replay) {
        patchState(operation.id, run.replay)
        void execute(operation, run.replay)
        return
      }
      // No stored inputs: re-run against whatever is in the form right now.
      void execute(operation, state)
    },
    [execute, operation, patchState, state],
  )

  const chain = useCallback(() => {
    if (!operation.input || !result) return
    patchState(operation.id, { input: result.output })
  }, [operation, patchState, result])

  const canRerunFromForm = validateOperation(operation, state, true).length === 0

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault()
          handleRun()
        }
      }}
    >
      <div className="flex min-h-0 flex-1">
        <OperationList
          selected={operation.id}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-group overflow-y-auto p-panel">
          <header className="flex flex-col gap-1">
            <h2 className="text-md font-medium text-text">{operation.label}</h2>
            <p className="max-w-prose text-xs text-text-secondary">{operation.summary}</p>
          </header>

          <OperationForm
            operation={operation}
            state={state}
            onChange={(patch) => patchState(operation.id, patch)}
            issues={liveIssues}
            disabled={busy}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={Play} loading={busy} onClick={handleRun}>
              Run
            </Button>
            <span className="flex items-center gap-1 text-2xs text-text-tertiary">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd>
            </span>
            {operation.secretInput && (
              <span className="text-2xs text-text-tertiary">
                Keys stay in memory — never stored, never logged.
              </span>
            )}
          </div>

          {error !== undefined && (
            <InlineAlert
              tone="error"
              title={`${operation.label} failed`}
              onDismiss={() => setErrors((current) => ({ ...current, [operation.id]: undefined }))}
            >
              {error}
            </InlineAlert>
          )}

          {busy ? (
            <p role="status" className="text-xs text-text-secondary">
              Running {operation.label}…
            </p>
          ) : result ? (
            <ResultBlock
              operation={operation}
              output={result.output}
              meta={result.meta}
              {...(operation.input
                ? { onChain: chain }
                : {
                    chainDisabledReason: `${operation.label} takes no input, so there is nothing to chain into.`,
                  })}
            />
          ) : error === undefined ? (
            <EmptyState
              icon={Wrench}
              title="No result yet"
              description={
                operation.input
                  ? `Enter a value and run ${operation.label}.`
                  : `Choose a size and run ${operation.label}.`
              }
              hint={
                <span className="flex items-center justify-center gap-1">
                  <Kbd>Ctrl</Kbd>
                  <Kbd>Enter</Kbd> to run
                </span>
              }
              className="py-6"
            />
          ) : null}

          <RecentRuns
            operation={operation}
            runs={runs}
            onReplay={handleReplay}
            canRerunFromForm={canRerunFromForm}
            busy={busy}
            onClear={() => {
              clearRuns(operation.id)
              setHistoryVersion((version) => version + 1)
            }}
          />
        </div>
      </div>
    </div>
  )
}
