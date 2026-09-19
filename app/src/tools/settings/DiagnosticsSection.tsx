/**
 * Settings → Diagnostics / About (UX_SPEC 3.9).
 *
 * "This absorbs the old Info popover and fixes it. Creator `Amirsalar Saberi
 * rad`; the ownership statement verbatim; the link `https://amirsrad.ir` …
 * Plus what the old panel entirely lacked: app version, build date and commit,
 * core engine version, transport (`WASM` / `Native IPC`), OpenSSL or crypto
 * backend version, packager file path and hash, license text link, docs link,
 * and a `Copy diagnostics` button that emits a scrubbed report."
 *
 * Everything in the report is a version, a path, a hash, a capability flag or a
 * layout preference. No engine argument, no buffer content and no problem
 * message text is included, which is how 5.5 rule 3 is honoured by construction
 * rather than by filtering.
 */

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { engineKind, hostCapabilities, tryCall } from '@/engine/client'
import { PROTOCOL_VERSION, type HostCapabilities } from '@/engine/protocol'
import { useProblems } from '@/store/problems'
import { useSettings } from '@/store/settings'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Skeleton } from '@/components/ui/Skeleton'
import { Readout, ReadoutGroup, SectionCard } from './parts'
import { usePackagerSource } from './packagerSource'
import { usePreferences } from './preferences'
import { openExternal } from './hostFiles'

const CREATOR = 'Amirsalar Saberi rad'
const OWNERSHIP = 'All rights, ownership, and licensing for this app belong to Amirsalar Saberi rad.'
const HOME_URL = 'https://amirsrad.ir'

/** Build metadata, when the build injected any. Never throws on the web. */
function buildEnv(): Record<string, string | undefined> {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
  return meta.env ?? {}
}

interface EngineInfo {
  version: string
  protocol: number
  /** Present only if a future ABI reports it; rendered honestly when absent. */
  cryptoBackend: string | null
}

function toEngineInfo(data: unknown): EngineInfo {
  const raw = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  return {
    version: typeof raw.version === 'string' ? raw.version : 'unknown',
    protocol: typeof raw.protocol === 'number' ? raw.protocol : PROTOCOL_VERSION,
    cryptoBackend:
      typeof raw.cryptoBackend === 'string'
        ? raw.cryptoBackend
        : typeof raw.openssl === 'string'
          ? raw.openssl
          : null,
  }
}

function capabilityRow(capabilities: HostCapabilities): string {
  return (Object.keys(capabilities) as (keyof HostCapabilities)[])
    .map((key) => `${key}=${capabilities[key] ? 'yes' : 'no'}`)
    .join(' ')
}

export function DiagnosticsSection() {
  const env = buildEnv()
  const kind = engineKind()
  const capabilities = hostCapabilities()

  const theme = useSettings((state) => state.theme)
  const density = useSettings((state) => state.density)
  const legacyEngine = useSettings((state) => state.legacyEngine)

  const uiScale = usePreferences((state) => state.uiScale)
  const monoFace = usePreferences((state) => state.monoFace)
  const reduceMotion = usePreferences((state) => state.reduceMotion)

  const source = usePackagerSource((state) => state.source)
  const packagers = usePackagerSource((state) => state.packagers)

  const counts = useProblems((state) => state.counts)

  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const probe = useCallback(async () => {
    setLoading(true)
    const result = await tryCall('engine.version', {})
    setLoading(false)
    if (result.ok) {
      setEngine(toEngineInfo(result.data))
      setEngineError(null)
    } else {
      setEngine(null)
      setEngineError(result.error.message)
    }
  }, [])

  useEffect(() => {
    void probe()
  }, [probe])

  const appVersion = env.VITE_APP_VERSION ?? '2.0.0'
  const buildDate = env.VITE_BUILD_DATE ?? null
  const commit = env.VITE_COMMIT ?? null
  const transport = kind === 'native' ? 'Native IPC' : 'WASM (in-tab)'
  const problemCounts = counts()

  const report = [
    '# BufferX diagnostics',
    `generated       ${new Date().toISOString()}`,
    '',
    '## App',
    `version         ${appVersion}`,
    `build date      ${buildDate ?? 'not injected at build time'}`,
    `commit          ${commit ?? 'not injected at build time'}`,
    `mode            ${env.MODE ?? 'unknown'}`,
    '',
    '## Engine',
    `core version    ${engine?.version ?? (engineError ? `unavailable (${engineError})` : 'probing')}`,
    `protocol        ${String(engine?.protocol ?? PROTOCOL_VERSION)}`,
    `crypto backend  ${engine?.cryptoBackend ?? 'not reported by this engine build'}`,
    `transport       ${transport}`,
    `capabilities    ${capabilityRow(capabilities)}`,
    `legacy engine   ${legacyEngine ? 'on' : 'off'}`,
    '',
    '## Packagers',
    `source          ${source?.path ?? source?.label ?? 'engine defaults'}`,
    `hash            ${source?.hash ?? 'not computed'}`,
    `bytes           ${typeof source?.bytes === 'number' ? String(source.bytes) : 'n/a'}`,
    `loaded          ${packagers.length ? `${String(packagers.length)} definitions` : 'none'}`,
    '',
    '## Appearance',
    `theme           ${theme}`,
    `density         ${density}`,
    `ui scale        ${String(uiScale)}%`,
    `mono face       ${monoFace}`,
    `reduce motion   ${reduceMotion}`,
    '',
    '## Problems',
    `errors          ${String(problemCounts.error)}`,
    `warnings        ${String(problemCounts.warning)}`,
    `info            ${String(problemCounts.info)}`,
    '(messages are omitted: they quote field values — UX_SPEC 5.5 rule 3)',
    '',
  ].join('\n')

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Engine and transport"
        action={
          <Button size="xs" variant="ghost" icon={RefreshCw} onClick={() => void probe()} loading={loading}>
            Re-probe
          </Button>
        }
      >
        {engineError ? (
          <InlineAlert
            tone="error"
            title="The engine did not answer"
            action={
              <Button size="xs" onClick={() => void probe()}>
                Retry
              </Button>
            }
          >
            {engineError}
          </InlineAlert>
        ) : null}

        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={kind === 'native' ? 'accent' : 'info'} mono>
            {kind === 'native' ? 'NATIVE' : 'WASM'}
          </Badge>
          <Badge tone={legacyEngine ? 'warn' : 'neutral'} mono dot>
            {legacyEngine ? 'ENGINE: LEGACY ATM' : 'ENGINE: GENERIC'}
          </Badge>
          {(Object.keys(capabilities) as (keyof HostCapabilities)[]).map((key) => (
            <Badge key={key} tone={capabilities[key] ? 'ok' : 'neutral'}>
              {key}: {capabilities[key] ? 'yes' : 'no'}
            </Badge>
          ))}
        </div>

        <ReadoutGroup>
          <Readout
            label="Core engine version"
            value={engine?.version ?? ''}
            display={loading && engine === null ? <Skeleton width={80} height={12} /> : undefined}
          />
          <Readout label="Protocol" value={String(engine?.protocol ?? PROTOCOL_VERSION)} />
          <Readout label="Transport" value={transport} />
          <Readout
            label="Crypto backend"
            value={engine?.cryptoBackend ?? ''}
            display={
              engine?.cryptoBackend ?? (
                <span className="text-text-tertiary">not reported by this engine build</span>
              )
            }
          />
        </ReadoutGroup>
      </SectionCard>

      <SectionCard title="Build">
        <ReadoutGroup>
          <Readout label="App version" value={appVersion} />
          <Readout
            label="Build date"
            value={buildDate ?? ''}
            display={buildDate ?? <span className="text-text-tertiary">not injected at build time</span>}
          />
          <Readout
            label="Commit"
            value={commit ?? ''}
            display={commit ?? <span className="text-text-tertiary">not injected at build time</span>}
          />
          <Readout label="Mode" value={env.MODE ?? 'unknown'} />
        </ReadoutGroup>
      </SectionCard>

      <SectionCard title="Packager file">
        <ReadoutGroup>
          <Readout label="Path" value={source?.path ?? source?.label ?? 'engine defaults'} />
          <Readout label="Hash" value={source?.hash ?? ''} />
          <Readout label="Definitions loaded" value={String(packagers.length)} />
        </ReadoutGroup>
      </SectionCard>

      <SectionCard
        title="Diagnostics report"
        description="Versions, capabilities, layout preferences and problem counts. No secret and no message content."
        action={<CopyButton value={report} label="Copy diagnostics" size="xs" />}
      >
        <pre className="max-h-72 overflow-auto rounded-sm border border-border-subtle bg-surface-inset p-panel font-mono text-mono-xs text-text-secondary">
          {report}
        </pre>
      </SectionCard>

      <SectionCard title="About BufferX">
        <ReadoutGroup>
          <Readout label="Creator" value={CREATOR} />
          <Readout label="Ownership" value={OWNERSHIP} />
        </ReadoutGroup>

        <div className="flex flex-wrap items-center gap-1">
          <Button size="xs" icon={ExternalLink} onClick={() => openExternal(HOME_URL)}>
            amirsrad.ir
          </Button>
          <CopyButton value={HOME_URL} size="xs" variant="ghost" label="Copy link" />
        </div>

        <p className="text-xs text-text-secondary">
          Licence and documentation ship with the source tree: <span className="font-mono text-mono-xs">LICENSE</span>{' '}
          and <span className="font-mono text-mono-xs">docs/</span> in the BufferX repository. Links open in a new
          tab; this build grants no shell opener, so the system browser is not invoked.
        </p>
      </SectionCard>
    </div>
  )
}
