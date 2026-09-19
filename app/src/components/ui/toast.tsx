import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { Toaster as SonnerToaster, toast as sonnerToast, type ExternalToast } from 'sonner'
import { cn } from '@/lib/cn'

/**
 * DESIGN_SYSTEM.md §4.18.
 *
 * A toast is only for something that finished off-screen. It is **never** the
 * primary error channel — validation errors live inline on the control, and
 * operation errors live in the panel's result region.
 *
 * A toast body never contains a key, PIN, PAN, or PEM. It may contain a KCV.
 */

/** §4.18: `ok` 4s, `info` 6s, `warn`/`error` never auto-dismiss. */
const DURATION = {
  success: 4000,
  info: 6000,
  warning: Number.POSITIVE_INFINITY,
  error: Number.POSITIVE_INFINITY,
} as const

export type ToastOptions = Omit<ExternalToast, 'duration'> & { duration?: number }

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonnerToast.success(message, { duration: DURATION.success, ...options }),
  info: (message: string, options?: ToastOptions) =>
    sonnerToast.info(message, { duration: DURATION.info, ...options }),
  warning: (message: string, options?: ToastOptions) =>
    sonnerToast.warning(message, { duration: DURATION.warning, ...options }),
  error: (message: string, options?: ToastOptions) =>
    sonnerToast.error(message, { duration: DURATION.error, ...options }),
  dismiss: (id?: number | string) => sonnerToast.dismiss(id),
}

const TOAST_BASE = cn(
  'group pointer-events-auto flex w-88 items-start gap-2',
  'rounded-md border border-border border-l-2 bg-surface-3 p-3 shadow-e3',
)

/**
 * Mount once, near the app root. Bottom-right, max 3 visible, timers pause on
 * hover or focus (sonner handles both).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      visibleToasts={3}
      expand={false}
      gap={8}
      closeButton
      icons={{
        success: <CheckCircle2 size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />,
        info: <Info size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />,
        warning: <AlertTriangle size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />,
        error: <XCircle size={16} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: TOAST_BASE,
          default: 'border-l-border-strong',
          success: 'border-l-ok',
          info: 'border-l-info',
          warning: 'border-l-warn',
          error: 'border-l-error',
          icon: cn(
            'mt-px shrink-0',
            'group-data-[type=success]:text-ok group-data-[type=info]:text-info',
            'group-data-[type=warning]:text-warn group-data-[type=error]:text-error',
          ),
          content: 'flex min-w-0 flex-1 flex-col gap-0.5',
          title: 'text-sm font-medium text-text',
          description: 'text-xs text-text-secondary',
          actionButton: cn(
            'ml-auto inline-flex h-control-xs shrink-0 items-center rounded-sm px-2',
            'bg-surface-2 text-xs font-medium text-text hover:bg-surface-raised',
          ),
          cancelButton: cn(
            'inline-flex h-control-xs shrink-0 items-center rounded-sm px-2',
            'text-xs text-text-secondary hover:bg-surface-raised',
          ),
          closeButton: cn(
            'absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-xs',
            'border border-border-subtle bg-surface-2 text-text-secondary hover:bg-surface-raised',
          ),
        },
      }}
    />
  )
}
