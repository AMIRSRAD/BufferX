/**
 * About — UX_SPEC 3.9 (Diagnostics / About) and Appendix A (Info).
 *
 * The old app's Info popover carried three things: the creator's name, an
 * ownership statement, and a link. It carried nothing an operator could put in
 * a bug report. This panel keeps all three verbatim and adds what the spec
 * lists as missing: app version, build date and commit, core engine version,
 * transport, crypto backend, packager path and hash, licence text, docs, and a
 * `Copy diagnostics` button that emits a scrubbed report.
 *
 * Secrets: this tool holds no secret and takes no input. The diagnostics report
 * is assembled from versions, capabilities, layout state and the Problems log,
 * and every log line is scrubbed before it lands (UX_SPEC 5.5 rule 3) — buffer
 * contents, field values and tool inputs are never passed to the builder at
 * all.
 *
 * States: the engine version is the only asynchronous value. It renders as a
 * skeleton while in flight, as an `InlineAlert` with the engine's own message
 * plus `Retry` on failure, and as readouts on success. Nothing here opens a
 * modal for an error, and no failure stops the rest of the panel rendering —
 * a diagnostics screen that goes blank when the engine is unhappy is exactly
 * the screen you need when the engine is unhappy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Keyboard,
  RefreshCw,
  Scale,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Kbd } from '@/components/ui/Kbd'
import { toast } from '@/components/ui/toast'
import { engineKind, hostCapabilities, tryCall } from '@/engine/client'
import { capabilityHint, type HostCapabilities } from '@/engine/protocol'
import { SHELL_ACTION_EVENT, type ShellActionDetail } from '@/shell/useShortcuts'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { useTools } from '@/store/tools'
import { elidePath, openExternal } from '@/tools/settings/hostFiles'
import { usePackagerSource } from '@/tools/settings/packagerSource'
import {
  DIAGNOSTICS_GUARANTEE,
  DOCUMENTS,
  LICENCE_SUMMARY,
  PRODUCT,
} from './identity'
import {
  buildDiagnosticsReport,
  countRedactions,
  hostLabel,
  normalizeEngineVersion,
  readBuildInfo,
  scrubDiagnosticText,
  transportLabel,
  type DiagnosticsProblem,
  type EngineVersionInfo,
  type LayoutDiagnostics,
  type PackagerDiagnostics,
} from './diagnostics'
import { DocumentationDialog, LicenceDialog, ShortcutReferenceDialog } from './ReferenceDialogs'
import { Readout, ReadoutGroup, ResultBlock, Section } from './parts'

const TOOL_ID = 'about'

type VersionStatus = 'loading' | 'ready' | 'error'

interface CapabilityRow {
  key: keyof HostCapabilities
  label: string
}

const CAPABILITY_ROWS: readonly CapabilityRow[] = [
  { key: 'tcp', label: 'Raw TCP sockets' },
  { key: 'files', label: 'File system' },
  { key: 'keyFiles', label: 'Key file loading' },
  { key: 'desktop', label: 'Desktop host' },
]

function formatTimestamp(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  return new Date(at).toLocaleString()
}

export default function AboutPanel() {
  /* ── Static, synchronous facts ──────────────────────────────────────────── */

  const build = useMemo(() => readBuildInfo(), [])
  const transport = useMemo(() => engineKind(), [])
  const capabilities = useMemo(() => hostCapabilities(), [])

  /* ── Engine version (the one async value) ───────────────────────────────── */

  const [engine, setEngine] = useState<EngineVersionInfo | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [versionStatus, setVersionStatus] = useState<VersionStatus>('loading')
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    setVersionStatus('loading')
    void tryCall('engine.version', {}).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setEngine(normalizeEngineVersion(result.data))
        setEngineError(null)
        setVersionStatus('ready')
      } else {
        setEngine(null)
        setEngineError(result.error.message)
        setVersionStatus('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [reloadNonce])

  /* ── Packager provenance (shared with Settings → Packagers) ─────────────── */

  const packagerSource = usePackagerSource((state) => state.source)
  const packagerCount = usePackagerSource((state) => state.packagers.length)
  const packagerStatus = usePackagerSource((state) => state.status)
  const packagerError = usePackagerSource((state) => state.error)
  const refreshPackagers = usePackagerSource((state) => state.refresh)

  // About only ever reads the registry. When nothing has read it yet in this
  // session there is nothing to report, so ask once — `packager.list` is a pure
  // query and cannot disturb a decode in progress.
  useEffect(() => {
    if (packagerStatus === 'idle') void refreshPackagers()
  }, [packagerStatus, refreshPackagers])

  /* ── Layout state and the Problems log ──────────────────────────────────── */

  const theme = useSettings((state) => state.theme)
  const density = useSettings((state) => state.density)
  const railLabeled = useSettings((state) => state.railLabeled)
  const legacyEngine = useSettings((state) => state.legacyEngine)
  const openTools = useTools((state) => state.open)
  const problems = useProblems((state) => state.items)

  /* ── Dialogs and the report preview ─────────────────────────────────────── */

  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [licenceOpen, setLicenceOpen] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [stampedAt, setStampedAt] = useState(() => Date.now())

  const packagerDiagnostics: PackagerDiagnostics | null = useMemo(() => {
    if (!packagerSource) return null
    return {
      label: packagerSource.label,
      kind: packagerSource.kind,
      path: packagerSource.path,
      hash: packagerSource.hash,
      bytes: packagerSource.bytes,
      loadedAt: packagerSource.loadedAt,
      count: packagerCount,
    }
  }, [packagerSource, packagerCount])

  const layout: LayoutDiagnostics = useMemo(
    () => ({ theme, density, railLabeled, legacyEngine, openTools }),
    [theme, density, railLabeled, legacyEngine, openTools],
  )

  const scrubbedProblems: DiagnosticsProblem[] = useMemo(
    () =>
      problems.map((problem) => ({
        severity: problem.severity,
        source: problem.source,
        message: problem.message,
        at: problem.at,
      })),
    [problems],
  )

  const report = useMemo(
    () =>
      buildDiagnosticsReport({
        generatedAt: stampedAt,
        build,
        engine,
        engineError,
        transport,
        capabilities,
        packagers: packagerDiagnostics,
        layout,
        problems: scrubbedProblems,
      }),
    [
      build,
      capabilities,
      engine,
      engineError,
      layout,
      packagerDiagnostics,
      scrubbedProblems,
      stampedAt,
      transport,
    ],
  )

  const redactions = useMemo(() => {
    const raw = problems.map((problem) => `${problem.source} — ${problem.message}`).join('\n')
    return countRedactions(raw, scrubDiagnosticText(raw))
  }, [problems])

  /* ── Actions ────────────────────────────────────────────────────────────── */

  const refreshAll = useCallback(() => {
    setStampedAt(Date.now())
    setReloadNonce((nonce) => nonce + 1)
    void refreshPackagers()
  }, [refreshPackagers])

  const copyDiagnostics = useCallback(async () => {
    setStampedAt(Date.now())
    try {
      await navigator.clipboard.writeText(report)
      toast.success('Diagnostics copied.')
    } catch {
      // A denied clipboard permission is not something the operator can fix
      // from here, so show the report instead of failing silently.
      setPreviewOpen(true)
      toast.error('The clipboard was refused. The report is shown below — select it and copy manually.')
    }
  }, [report])

  /* ── Shell wiring: Ctrl+Enter / Ctrl+Shift+Enter ────────────────────────── */

  useEffect(() => {
    function onAction(event: Event) {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (detail.region !== 'dock' || detail.tool !== TOOL_ID) return
      if (detail.kind === 'primary') void copyDiagnostics()
      else refreshAll()
    }
    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    return () => document.removeEventListener(SHELL_ACTION_EVENT, onAction)
  }, [copyDiagnostics, refreshAll])

  /* ── Render ─────────────────────────────────────────────────────────────── */

  const loadingVersion = versionStatus === 'loading'
  const websiteHint = capabilities.desktop
    ? 'Opens in a new webview window on the desktop build.'
    : 'Opens in a new browser tab (target="_blank" rel="noreferrer").'

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-group overflow-y-auto p-panel">
        {/* ── Identity ─────────────────────────────────────────────────────── */}
        <header className="flex items-start gap-group">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-surface-2"
          >
            <Info size={20} strokeWidth={1.5} absoluteStrokeWidth className="text-accent" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-lg text-text">{PRODUCT.name}</h2>
            <p className="text-sm text-text-secondary">{PRODUCT.tagline}</p>
            <div className="flex flex-wrap items-center gap-1">
              <Badge tone="accent" mono>{`v${build.appVersion}`}</Badge>
              <Badge tone="info" mono>
                {transportLabel(transport)}
              </Badge>
              <Badge tone="neutral">{hostLabel(transport)}</Badge>
              {legacyEngine ? <Badge tone="warn">ENGINE: LEGACY</Badge> : null}
            </div>
          </div>
        </header>

        {/* ── Credits (the old Info popover, verbatim) ──────────────────────── */}
        <Section label="Credits">
          <ReadoutGroup>
            <Readout label="Creator" value={PRODUCT.creator} mono={false} />
            <Readout
              label="Website"
              value={PRODUCT.website}
              mono
              note={websiteHint}
            />
          </ReadoutGroup>
          <p className="text-sm text-text-secondary">{PRODUCT.ownership}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              icon={ExternalLink}
              onClick={() => openExternal(PRODUCT.website)}
            >
              Open amirsrad.ir
            </Button>
          </div>
        </Section>

        {/* ── Versions ─────────────────────────────────────────────────────── */}
        <Section
          label="Version and build"
          action={
            <Button
              size="xs"
              variant="ghost"
              icon={RefreshCw}
              onClick={refreshAll}
              loading={loadingVersion}
            >
              Refresh
            </Button>
          }
        >
          {versionStatus === 'error' ? (
            <InlineAlert
              tone="error"
              title="The engine did not report its version."
              action={
                <Button size="xs" variant="default" icon={RefreshCw} onClick={refreshAll}>
                  Retry
                </Button>
              }
            >
              {engineError ?? 'engine.version returned no message.'} Everything else on this screen
              is read from the host and is still accurate.
            </InlineAlert>
          ) : null}

          <ReadoutGroup>
            <Readout label="App version" value={build.appVersion} />
            <Readout label="Build mode" value={build.mode} />
            <Readout
              label="Build date"
              value={build.buildDate}
              emptyText="Not stamped by this build"
            />
            <Readout label="Commit" value={build.commit} emptyText="Not stamped by this build" />
            <Readout
              label="Core engine"
              value={engine?.version ?? null}
              loading={loadingVersion}
              emptyText={versionStatus === 'error' ? 'Unavailable' : 'Not reported'}
            />
            <Readout
              label="Engine protocol"
              value={engine?.protocol ?? null}
              loading={loadingVersion}
              emptyText={versionStatus === 'error' ? 'Unavailable' : 'Not reported'}
            />
            <Readout
              label="Crypto backend"
              value={engine?.cryptoBackend ?? null}
              loading={loadingVersion}
              emptyText="Not reported by this engine build"
              note="BufferXCore links OpenSSL libcrypto; this ABI build does not report its version."
            />
            <Readout label="Transport" value={transportLabel(transport)} />
            <Readout label="Host" value={hostLabel(transport)} mono={false} />
          </ReadoutGroup>
        </Section>

        {/* ── Host capabilities ────────────────────────────────────────────── */}
        <Section label="Host capabilities">
          <ReadoutGroup>
            {CAPABILITY_ROWS.map((row) => {
              const available = capabilities[row.key]
              return (
                <Readout
                  key={row.key}
                  label={row.label}
                  value={available ? 'Available' : 'Unavailable'}
                  mono={false}
                  display={
                    <Badge tone={available ? 'ok' : 'neutral'} dot>
                      {available ? 'Available' : 'Unavailable'}
                    </Badge>
                  }
                  note={available ? undefined : capabilityHint(row.key)}
                />
              )
            })}
          </ReadoutGroup>
        </Section>

        {/* ── Packager registry ────────────────────────────────────────────── */}
        <Section label="Packagers">
          {packagerError ? (
            <InlineAlert
              tone="warn"
              title="The packager registry could not be read."
              action={
                <Button
                  size="xs"
                  variant="default"
                  icon={RefreshCw}
                  onClick={() => void refreshPackagers()}
                >
                  Retry
                </Button>
              }
            >
              {packagerError}
            </InlineAlert>
          ) : null}

          <ReadoutGroup>
            <Readout
              label="Source"
              value={packagerDiagnostics?.kind === 'file' ? packagerDiagnostics.label : 'Engine defaults'}
              mono={false}
              emptyText="No registry read in this session"
            />
            <Readout
              label="Path"
              value={packagerDiagnostics?.path ?? null}
              display={packagerDiagnostics?.path ? elidePath(packagerDiagnostics.path) : undefined}
              emptyText={
                capabilities.files
                  ? 'Built-in registry — no file loaded'
                  : 'Browsers do not expose a file path'
              }
            />
            <Readout
              label="Hash"
              value={packagerDiagnostics?.hash ?? null}
              display={
                packagerDiagnostics?.hash ? <span title={packagerDiagnostics.hash}>{packagerDiagnostics.hash}</span> : undefined
              }
              emptyText="No file loaded in this session"
            />
            <Readout
              label="File size"
              value={packagerDiagnostics?.bytes === null || packagerDiagnostics === null ? null : `${packagerDiagnostics.bytes} bytes`}
              emptyText="No file loaded in this session"
            />
            <Readout
              label="Loaded"
              value={
                packagerDiagnostics && packagerDiagnostics.loadedAt > 0
                  ? new Date(packagerDiagnostics.loadedAt).toISOString()
                  : null
              }
              display={
                packagerDiagnostics && packagerDiagnostics.loadedAt > 0
                  ? formatTimestamp(packagerDiagnostics.loadedAt)
                  : undefined
              }
              emptyText="Never"
            />
            <Readout
              label="Registered"
              value={packagerCount > 0 ? String(packagerCount) : null}
              display={packagerCount > 0 ? `${packagerCount} packagers` : undefined}
              emptyText={packagerStatus === 'loading' ? 'Reading…' : 'None'}
              loading={packagerStatus === 'loading' && packagerCount === 0}
            />
          </ReadoutGroup>
        </Section>

        {/* ── Licence and documentation ────────────────────────────────────── */}
        <Section label="Licence">
          <p className="text-sm text-text-secondary">{LICENCE_SUMMARY}</p>
          <ReadoutGroup>
            <Readout label="Copyright" value={PRODUCT.copyright} mono={false} />
          </ReadoutGroup>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="default" icon={Scale} onClick={() => setLicenceOpen(true)}>
              Licence text
            </Button>
            <Button size="sm" variant="default" icon={BookOpen} onClick={() => setDocsOpen(true)}>
              Documentation
            </Button>
            <span className="text-xs text-text-tertiary">{DOCUMENTS.length} documents ship with the source.</span>
          </div>
        </Section>

        {/* ── Keyboard reference ───────────────────────────────────────────── */}
        <Section label="Keyboard">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="default"
              icon={Keyboard}
              onClick={() => setShortcutsOpen(true)}
            >
              Keyboard shortcuts
            </Button>
            <span className="flex items-center gap-1 text-xs text-text-tertiary">
              or press <Kbd>Ctrl</Kbd> <Kbd>/</Kbd> anywhere.
            </span>
          </div>
        </Section>

        {/* ── Diagnostics ──────────────────────────────────────────────────── */}
        <ResultBlock
          title="Diagnostics"
          action={
            <>
              <Button
                size="xs"
                variant="ghost"
                icon={previewOpen ? EyeOff : Eye}
                onClick={() => setPreviewOpen((open) => !open)}
                aria-expanded={previewOpen}
                aria-controls="about-diagnostics-report"
              >
                {previewOpen ? 'Hide report' : 'Show report'}
              </Button>
              <CopyButton value={report} label="Copy diagnostics report" size="xs" variant="ghost" />
            </>
          }
          provenance={
            <>
              Generated {formatTimestamp(stampedAt)} · {problems.length}{' '}
              {problems.length === 1 ? 'problem' : 'problems'} included ·{' '}
              {redactions === 0 ? 'nothing needed redacting' : `${redactions} values redacted`}
            </>
          }
        >
          <p className="text-xs text-text-secondary">{DIAGNOSTICS_GUARANTEE}</p>
          {previewOpen ? (
            <pre
              id="about-diagnostics-report"
              tabIndex={0}
              aria-label="Diagnostics report"
              className="max-h-80 overflow-auto rounded-sm border border-border-subtle bg-surface-inset p-panel font-mono text-mono-xs whitespace-pre text-text"
            >
              {report}
            </pre>
          ) : null}
        </ResultBlock>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-1 px-panel py-2">
        <Button size="sm" variant="primary" icon={Copy} onClick={() => void copyDiagnostics()}>
          Copy diagnostics
        </Button>
        <Button size="sm" variant="default" icon={RefreshCw} onClick={refreshAll} loading={loadingVersion}>
          Refresh
        </Button>
        <span className="ml-auto flex items-center gap-1 text-2xs text-text-tertiary">
          <Kbd>Ctrl</Kbd>
          <Kbd>↵</Kbd>
          copy
        </span>
      </div>

      <ShortcutReferenceDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <LicenceDialog open={licenceOpen} onOpenChange={setLicenceOpen} />
      <DocumentationDialog open={docsOpen} onOpenChange={setDocsOpen} />
    </div>
  )
}
