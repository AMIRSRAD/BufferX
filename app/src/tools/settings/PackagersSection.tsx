/**
 * Settings → Packagers (UX_SPEC 3.9).
 *
 * "Source path (elided, with `Reveal in folder` on desktop) · `Browse…` ·
 * `Reload` · active packager picker (all 32 options) · a read-only table of the
 * active packager's field definitions (`Bit`, `Name`, `Type`, `Len`) which is
 * useful reference material that the old app loaded but never showed · MAC
 * metadata readout."
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, FolderSearch, RefreshCw, Table2, Upload } from 'lucide-react'
import { tryCall, hostCapabilities } from '@/engine/client'
import { capabilityHint } from '@/engine/protocol'
import { useBuffers } from '@/store/buffers'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { CopyButton } from '@/components/ui/CopyButton'
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable'
import { EmptyState } from '@/components/ui/EmptyState'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Skeleton } from '@/components/ui/Skeleton'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/toast'
import type { SelectOption } from '@/components/ui/Select'
import { cn } from '@/lib/cn'
import { Divider, Readout, ReadoutGroup, SectionCard, SettingRow } from './parts'
import {
  CANONICAL_PACKAGERS,
  groupOf,
  toFieldDefs,
  usePackagerSource,
  validatePackagerXml,
  type PackagerFieldDef,
  type PackagerSummary,
} from './packagerSource'
import {
  canUseNativeFiles,
  elidePath,
  pickTextFileNative,
  readBrowserFile,
  readTextFileNative,
} from './hostFiles'
import { usePreferences } from './preferences'

const XML_FILTERS = [{ name: 'Packager definitions', extensions: ['xml'] }]

/** `LenLen 4 · MAC FULL/8 · 64 fields` — the picker row subtitle from 2.2. */
function summaryHint(summary: PackagerSummary): string {
  const mac = summary.macConfigured ? `MAC ${summary.macMethod}/${String(summary.macSize)}` : 'no MAC'
  return `LenLen ${String(summary.lenLen)} · ${mac} · ${String(summary.fieldDefinitionCount)} fields`
}

const FIELD_COLUMNS: DataTableColumn<PackagerFieldDef>[] = [
  { key: 'id', header: 'Bit', width: 64, align: 'right', mono: true, render: (row) => row.id },
  {
    key: 'desc',
    header: 'Name',
    render: (row) => (row.desc === '' ? <span className="text-text-tertiary">—</span> : row.desc),
  },
  { key: 'type', header: 'Type', width: 96, mono: true, render: (row) => row.type },
  {
    key: 'length',
    header: 'Len',
    width: 96,
    align: 'right',
    mono: true,
    render: (row) => (
      <span>
        {row.length}
        {row.variable ? <span className="ml-1 text-text-tertiary">var</span> : null}
      </span>
    ),
  },
]

export function PackagersSection() {
  const capabilities = hostCapabilities()
  const nativeFiles = canUseNativeFiles()

  const packagers = usePackagerSource((state) => state.packagers)
  const source = usePackagerSource((state) => state.source)
  const status = usePackagerSource((state) => state.status)
  const registryError = usePackagerSource((state) => state.error)
  const refresh = usePackagerSource((state) => state.refresh)
  const loadXml = usePackagerSource((state) => state.loadXml)
  const reload = usePackagerSource((state) => state.reload)

  const packagerPath = usePreferences((state) => state.packagerPath)
  const setPackagerPath = usePreferences((state) => state.setPackagerPath)

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const update = useBuffers((state) => state.update)
  const active = tabs.find((tab) => tab.id === activeId)

  const [busy, setBusy] = useState<'browse' | 'reload' | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const [selected, setSelected] = useState<string>(active?.packager ?? 'SLM')
  const [fieldDefs, setFieldDefs] = useState<PackagerFieldDef[] | null>(null)
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [fieldsLoading, setFieldsLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (usePackagerSource.getState().status === 'idle') void refresh()
  }, [refresh])

  // Follow the active buffer, so the reference table describes the packager the
  // operator is actually decoding with.
  useEffect(() => {
    if (active?.packager) setSelected(active.packager)
  }, [active?.packager])

  useEffect(() => {
    let cancelled = false
    if (selected === '') return
    setFieldsLoading(true)
    void tryCall('packager.fields', { packager: selected }).then((result) => {
      if (cancelled) return
      setFieldsLoading(false)
      if (result.ok) {
        setFieldDefs(toFieldDefs(result.data))
        setFieldsError(null)
      } else {
        setFieldDefs(null)
        setFieldsError(result.error.message)
      }
    })
    return () => {
      cancelled = true
    }
  }, [selected, packagers])

  const options: SelectOption[] = useMemo(() => {
    if (packagers.length > 0) {
      return packagers.map((summary) => ({
        value: summary.name,
        label: summary.name,
        hint: `${groupOf(summary.name)} · ${summaryHint(summary)}`,
      }))
    }
    // The engine is unavailable: never shorten the option list because of it.
    return CANONICAL_PACKAGERS.map((name) => ({
      value: name,
      label: name,
      hint: `${groupOf(name)} · from the shipped default set`,
    }))
  }, [packagers])

  const summary = packagers.find((entry) => entry.name === selected) ?? null

  const adoptFile = useCallback(
    async (name: string, path: string | null, contents: string) => {
      const problem = validatePackagerXml(contents)
      if (problem !== null) {
        setFileError(problem)
        return
      }
      setFileError(null)
      const ok = await loadXml(contents, { label: name, path })
      if (ok) {
        setPackagerPath(path)
        toast.success(`Loaded ${name}`)
      }
    },
    [loadXml, setPackagerPath],
  )

  async function onBrowse() {
    setFileError(null)
    if (!nativeFiles) {
      inputRef.current?.click()
      return
    }
    setBusy('browse')
    try {
      const picked = await pickTextFileNative('Choose a packager definition file', XML_FILTERS)
      if (picked) await adoptFile(picked.name, picked.path, picked.contents)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The file could not be read.')
    } finally {
      setBusy(null)
    }
  }

  async function onReload() {
    setFileError(null)
    setBusy('reload')
    try {
      if (nativeFiles && packagerPath) {
        const contents = await readTextFileNative(packagerPath)
        const name = packagerPath.split(/[\\/]/).pop() ?? packagerPath
        await adoptFile(name, packagerPath, contents)
      } else {
        const ok = await reload()
        if (ok) toast.success('Packager registry reloaded')
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The file could not be re-read.')
    } finally {
      setBusy(null)
    }
  }

  async function onFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    setFileError(null)
    try {
      const picked = await readBrowserFile(file)
      await adoptFile(picked.name, null, picked.contents)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'The file could not be read.')
    }
  }

  const sourceLabel = source?.path ?? source?.label ?? 'Engine defaults'
  const sourceDisplay = source?.path ? elidePath(source.path) : sourceLabel

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Source"
        description="Where the packager definitions came from. Loading a file replaces the whole registry."
        action={
          <>
            <Button
              size="xs"
              icon={nativeFiles ? FolderOpen : Upload}
              onClick={() => void onBrowse()}
              loading={busy === 'browse'}
            >
              Browse…
            </Button>
            <Button
              size="xs"
              icon={RefreshCw}
              onClick={() => void onReload()}
              loading={busy === 'reload'}
            >
              Reload
            </Button>
          </>
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml,application/xml"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void onFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void onFiles(event.dataTransfer.files)
          }}
          className={cn(
            'flex flex-col gap-1 rounded-sm border border-dashed p-panel transition-colors duration-fast ease-standard',
            dragging ? 'border-accent bg-accent-muted' : 'border-border-subtle bg-surface-inset',
          )}
        >
          <span className="text-2xs tracking-wide text-text-tertiary uppercase">Current file</span>
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono text-mono-sm text-text" title={sourceLabel}>
              {sourceDisplay}
            </span>
            <CopyButton value={sourceLabel} size="xs" variant="ghost" />
            {source?.kind === 'builtin' ? <Badge tone="neutral">built in</Badge> : null}
          </span>
          <span className="text-xs text-text-secondary">
            {nativeFiles
              ? 'Drop an XML file here, or use Browse…'
              : `Drop an XML file here, or use Browse…. ${capabilityHint('files')}`}
          </span>
        </div>

        <SettingRow
          labelAs="span"
          label="Reveal in folder"
          hint={
            capabilities.desktop
              ? 'Needs the shell opener, which this build does not grant. Copy the path above instead.'
              : capabilityHint('files')
          }
          control={
            <Tooltip
              content={
                capabilities.desktop
                  ? 'The desktop capability set grants file read and write, not a shell opener.'
                  : capabilityHint('files')
              }
            >
              <span>
                <Button size="xs" icon={FolderSearch} disabled>
                  Reveal
                </Button>
              </span>
            </Tooltip>
          }
        />

        {fileError ? (
          <InlineAlert tone="error" title="That file could not be loaded" onDismiss={() => setFileError(null)}>
            {fileError}
          </InlineAlert>
        ) : null}

        {registryError ? (
          <InlineAlert
            tone="error"
            title="The packager registry is unavailable"
            action={
              <Button size="xs" onClick={() => void refresh()}>
                Retry
              </Button>
            }
          >
            {registryError}
          </InlineAlert>
        ) : null}

        <ReadoutGroup>
          <Readout
            label="Packagers loaded"
            value={String(packagers.length)}
            display={
              status === 'loading' ? <Skeleton width={40} height={12} /> : `${String(packagers.length)} of 32`
            }
          />
          <Readout label="Size" value={source?.bytes === null || source === null ? '' : `${String(source.bytes)} bytes`} />
          <Readout label="Hash" value={source?.hash ?? ''} />
          <Readout
            label="Loaded"
            value={source && source.loadedAt > 0 ? new Date(source.loadedAt).toLocaleString() : ''}
          />
        </ReadoutGroup>
      </SectionCard>

      <SectionCard
        title="Active packager"
        description="All 32 shipped definitions. Choosing one here retargets the active buffer."
      >
        <SettingRow
          label="Packager"
          htmlFor="settings-packager"
          hint={
            active
              ? `Applies to ${active.name}.`
              : 'No buffer is open, so this only changes what the table below describes.'
          }
          control={
            <div className="w-64">
              <Combobox
                id="settings-packager"
                value={selected}
                onValueChange={(next) => {
                  setSelected(next)
                  if (active) update(active.id, { packager: next })
                }}
                options={options}
                placeholder="Choose a packager"
                emptyText="No packager matches."
                mono
              />
            </div>
          }
        />

        <Divider />

        <div className="flex flex-col gap-1">
          <span className="text-2xs tracking-wide text-text-tertiary uppercase">MAC metadata</span>
          {summary ? (
            <ReadoutGroup>
              <Readout label="MAC configured" value={summary.macConfigured ? 'yes' : 'no'} />
              <Readout label="MAC method" value={summary.macMethod} />
              <Readout label="MAC size" value={`${String(summary.macSize)} bytes`} />
              <Readout
                label="MAC-capable fields"
                value={summary.macFieldIds.length === 0 ? '' : summary.macFieldIds.join(', ')}
              />
              <Readout label="Bitmap index" value={String(summary.bitmapIndex)} />
              <Readout label="Second bitmap" value={summary.secondPartBitmap ? 'yes' : 'no'} />
              <Readout label="Field count" value={String(summary.fieldCount)} />
              <Readout label="Length format" value={summary.lenFormat} />
              <Readout label="LenLen" value={String(summary.lenLen)} />
            </ReadoutGroup>
          ) : (
            <p className="text-xs text-text-secondary">
              {status === 'loading'
                ? 'Reading the registry…'
                : `The engine has no metadata for ${selected}. Load the packager file that defines it.`}
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Field definitions"
        description={`Read-only reference for ${selected}.`}
        action={
          fieldDefs && fieldDefs.length > 0 ? (
            <CopyButton
              value={fieldDefs
                .map((def) => `${String(def.id)}\t${def.desc}\t${def.type}\t${String(def.length)}`)
                .join('\n')}
              label="Copy table"
              size="xs"
              variant="ghost"
            />
          ) : null
        }
      >
        {fieldsError ? (
          <InlineAlert tone="error" title="Field definitions unavailable">
            {fieldsError}
          </InlineAlert>
        ) : null}

        {fieldsLoading && fieldDefs === null ? (
          <div className="flex flex-col gap-0.5">
            <Skeleton height={24} />
            <Skeleton height={24} />
            <Skeleton height={24} />
          </div>
        ) : (
          <div className="h-72 overflow-hidden rounded-sm border border-border-subtle">
            <DataTable<PackagerFieldDef>
              columns={FIELD_COLUMNS}
              rows={fieldDefs ?? []}
              getRowId={(row) => String(row.id)}
              /* A packager defines at most 128 bits. That is small enough to
                 render whole, which keeps the reference table complete for a
                 screen reader and for Ctrl+F. */
              virtualized={false}
              emptyState={
                <EmptyState
                  icon={Table2}
                  title="No field definitions"
                  description={
                    fieldsError
                      ? 'The engine could not describe this packager.'
                      : `${selected} defines no fields in the loaded file.`
                  }
                />
              }
            />
          </div>
        )}
      </SectionCard>
    </div>
  )
}
