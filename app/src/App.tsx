/**
 * Application root.
 *
 * Three responsibilities and nothing else: an error boundary that renders a
 * real recovery surface instead of a blank screen, the tooltip provider that
 * makes moving between neighbouring tooltips instant, and the toast stack.
 *
 * Everything below this file reads its theme and density from `data-theme` /
 * `data-density` on `<html>`, which `@/store/settings` writes at module load —
 * before React's first render — so the first painted frame is already correct.
 */

import { AppShell } from '@/shell/AppShell'
import { ErrorBoundary } from '@/shell/ErrorBoundary'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { Toaster } from '@/components/ui/toast'
import '@/store/settings'

export function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={400} skipDelayDuration={300}>
        <AppShell />
        {/* Bottom-right, 4s auto-dismiss, styled entirely from design tokens.
            Toasts carry transient successes and undoable actions only — errors
            live in the Problems drawer, because errors must be re-readable
            (UX_SPEC 5.1 tier 3). */}
        <Toaster />
      </TooltipProvider>
    </ErrorBoundary>
  )
}
