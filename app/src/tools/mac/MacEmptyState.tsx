/**
 * UX_SPEC 3.1 — the empty state shown when the active packager declares no MAC
 * configuration. The old app rendered a dead panel with a grey sentence; this
 * one names what is missing and offers all three exits.
 */

import { useState } from 'react'
import { FileCode2, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Input } from '@/components/ui/Input'
import { Popover } from '@/components/ui/Popover'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from '@/components/ui/toast'
import { hostCapabilities, tryCall } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import type { PackagerSummary } from './macModel'

export interface MacEmptyStateProps {
  /** The packager the active buffer is using. */
  packagerName: string
  /** Every loaded packager that does declare a MAC configuration. */
  candidates: readonly PackagerSummary[]
  onChoosePackager: (name: string) => void
  /** Called after `packager.loadXml` succeeds, so the caller can re-list. */
  onXmlLoaded: () => void
  onConfigureManually: () => void
}

/** Reads a packager XML file through the desktop host, or pasted text on web. */
async function readPackagerFile(path: string): Promise<{ ok: true; xml: string } | { ok: false; error: string }> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const xml = (await invoke('read_text_file', { path })) as string
    return { ok: true, xml }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : 'The file could not be read.' }
  }
}

function PackagerChooser({
  candidates,
  onChoosePackager,
}: {
  candidates: readonly PackagerSummary[]
  onChoosePackager: (name: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="center"
      trigger={<Button size="sm" variant="primary">Choose a packager with MAC…</Button>}
    >
      <div className="flex w-64 flex-col gap-1">
        <p className="text-2xs tracking-wider text-text-tertiary uppercase">
          Packagers declaring a MAC
        </p>
        {candidates.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No loaded packager declares a MAC configuration. Load a packager XML, or configure the
            tool manually.
          </p>
        ) : (
          <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {candidates.map((candidate) => (
              <li key={candidate.name}>
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth
                  className="justify-between"
                  onClick={() => {
                    onChoosePackager(candidate.name)
                    setOpen(false)
                  }}
                >
                  <span className="font-mono text-mono-sm">{candidate.name}</span>
                  <span className="text-2xs text-text-tertiary">
                    {candidate.macMethod || 'MAC'} · {candidate.macSize}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popover>
  )
}

function PackagerXmlLoader({ onXmlLoaded }: { onXmlLoaded: () => void }) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [xml, setXml] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const files = hostCapabilities().files

  async function load(source: 'file' | 'paste') {
    setBusy(true)
    setError(null)
    try {
      let contents = xml
      if (source === 'file') {
        if (path.trim().length === 0) {
          setError('Enter the path to a packager XML file.')
          return
        }
        const read = await readPackagerFile(path.trim())
        if (!read.ok) {
          setError(read.error)
          return
        }
        contents = read.xml
      }
      if (contents.trim().length === 0) {
        setError('Paste the packager XML first.')
        return
      }
      const result = await tryCall<{ count: number }>('packager.loadXml', { xml: contents })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      toast.success(`Loaded ${result.data.count} packagers.`)
      setOpen(false)
      setPath('')
      setXml('')
      onXmlLoaded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="center"
      trigger={
        <Button size="sm" variant="default" icon={FileCode2}>
          Open packager XML…
        </Button>
      }
    >
      <div className="flex w-80 flex-col gap-group">
        <Field
          label="File path"
          hint={files ? 'Absolute path to the packager XML.' : capabilityHint('files')}
        >
          <Input
            value={path}
            onValueChange={setPath}
            mono
            disabled={!files}
            placeholder="C:\\BufferX\\packagers.xml"
          />
        </Field>
        <Button size="sm" variant="default" disabled={!files || busy} loading={busy} onClick={() => void load('file')}>
          Load from disk
        </Button>

        <div className="border-t border-border-subtle" />

        <Field label="Or paste the XML" hint="The loaded set replaces the current registry.">
          <Textarea value={xml} onValueChange={setXml} mono rows={5} autoResize />
        </Field>
        <Button size="sm" variant="primary" disabled={busy} loading={busy} onClick={() => void load('paste')}>
          Load pasted XML
        </Button>

        {error && <InlineAlert tone="error" title="Packager XML not loaded">{error}</InlineAlert>}
      </div>
    </Popover>
  )
}

export function MacEmptyState({
  packagerName,
  candidates,
  onChoosePackager,
  onXmlLoaded,
  onConfigureManually,
}: MacEmptyStateProps) {
  return (
    <EmptyState
      icon={ShieldOff}
      title={`This packager (${packagerName}) declares no MAC configuration.`}
      description="MAC calculation needs a MAC field id, method, and size."
      action={
        <>
          <PackagerChooser candidates={candidates} onChoosePackager={onChoosePackager} />
          <PackagerXmlLoader onXmlLoaded={onXmlLoaded} />
          <Button size="sm" variant="subtle" onClick={onConfigureManually}>
            Configure manually
          </Button>
        </>
      }
      hint="Manual configuration MACs with the values you supply, and is labelled as not coming from the packager."
    />
  )
}
