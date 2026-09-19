/**
 * Error boundaries for the shell.
 *
 * "Errors are data, not interruptions" (UX_SPEC tenet 4). A render crash is the
 * one class of error the inline machinery cannot express, so it gets a real
 * recovery UI: what failed, the message in full, a copy affordance for a bug
 * report, and a way back — never a blank screen.
 *
 * Two scopes:
 *
 * - `ErrorBoundary` wraps the whole app. Its fallback fills the viewport and
 *   offers `Try again` (re-mount) and `Reload`.
 * - `PanelErrorBoundary` wraps one dock tool, so a broken panel degrades to a
 *   red strip inside its own accordion section and the rest of the shell — and
 *   the operator's buffer — keeps working.
 *
 * Neither fallback echoes props or state: a panel's props can contain a PAN or
 * a key, and a crash report must not become the leak (UX_SPEC 5.5 rule 3).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { cn } from '@/lib/cn'

interface BoundaryProps {
  children: ReactNode
  /** What broke, in operator language: `the MAC tool`, `BufferX`. */
  label: string
  /** Rendered instead of the built-in fallback when supplied. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  className?: string
}

interface BoundaryState {
  error: Error | null
}

class BaseBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Message and component stack only. Never props, never state.
    console.error(`[bufferx] ${this.props.label} crashed: ${error.message}`, info.componentStack)
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return null
  }
}

/** Whole-app boundary with a full recovery surface. */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <BaseBoundary
      label="BufferX"
      fallback={(error, reset) => (
        <div
          role="alert"
          className="grid min-h-dvh place-items-center bg-surface-0 p-panel text-text"
        >
          <div
            className={cn(
              'flex w-full max-w-128 flex-col gap-group rounded-md border border-error-border',
              'bg-surface-1 p-panel shadow-e2',
            )}
          >
            <div className="flex items-start gap-2">
              <TriangleAlert
                size={20}
                strokeWidth={1.5}
                absoluteStrokeWidth
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-error"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-lg">BufferX stopped unexpectedly</h1>
                <p className="text-base text-text-secondary">
                  The interface hit an error while rendering. Your buffers are held in memory only, so
                  reloading starts a clean session.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-field">
              <span className="text-2xs tracking-wide text-text-tertiary uppercase">Details</span>
              <pre
                className={cn(
                  'max-h-40 overflow-auto rounded-sm border border-border bg-surface-inset',
                  'p-2 font-mono text-mono-sm break-words whitespace-pre-wrap text-text',
                )}
              >
                {error.message || String(error)}
              </pre>
            </div>

            <div className="flex flex-wrap items-center gap-field">
              <Button variant="primary" size="md" icon={RotateCcw} onClick={reset}>
                Try again
              </Button>
              <Button size="md" onClick={() => window.location.reload()}>
                Reload BufferX
              </Button>
              <CopyButton value={error.stack ?? error.message} label="Copy details" size="md" showLabel />
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </BaseBoundary>
  )
}

/** Per-tool boundary. Keeps a broken panel inside its own dock section. */
export function PanelErrorBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <BaseBoundary
      label={`the ${title} tool`}
      fallback={(error, reset) => (
        <div className="p-panel">
          <InlineAlert
            tone="error"
            title={`${title} could not render`}
            action={
              <Button size="xs" icon={RotateCcw} onClick={reset}>
                Retry
              </Button>
            }
          >
            <span className="flex flex-col gap-1">
              <span className="break-words">{error.message || 'Unknown error.'}</span>
              <span>
                <CopyButton value={error.stack ?? error.message} label="Copy details" size="xs" showLabel />
              </span>
            </span>
          </InlineAlert>
        </div>
      )}
    >
      {children}
    </BaseBoundary>
  )
}
