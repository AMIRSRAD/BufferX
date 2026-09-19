/**
 * Settings → Framing defaults (UX_SPEC 3.9).
 *
 * "`Auto-detect decode` (default on) · `Include on build` (default off) ·
 * `Header mode` `ASCII`/`Binary` · `Header size` 1–8 default 4. These are the
 * *defaults for new buffers*; each buffer tab then owns its own framing (edited
 * in the raw pane)."
 *
 * The "defaults for new buffers" sentence is the whole point of the section, so
 * it is stated in the UI and an explicit `Apply to the active buffer` action is
 * offered rather than leaving the operator to wonder why nothing moved.
 */

import { useState } from 'react'
import { useBuffers } from '@/store/buffers'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Switch } from '@/components/ui/Switch'
import { toast } from '@/components/ui/toast'
import { SectionCard, SettingRow, Readout, ReadoutGroup } from './parts'
import {
  HEADER_SIZE_MAX,
  HEADER_SIZE_MIN,
  usePreferences,
  type HeaderMode,
} from './preferences'

const MODE_OPTIONS = [
  { value: 'ascii', label: 'ASCII' },
  { value: 'binary', label: 'Binary' },
]

/** Client-side rule: the engine takes 1..8, so nothing else is worth sending. */
function validateSize(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, error: 'Header size is required.' }
  if (!/^\d+$/.test(trimmed)) return { value: null, error: 'Header size must be a whole number of bytes.' }
  const value = Number.parseInt(trimmed, 10)
  if (value < HEADER_SIZE_MIN || value > HEADER_SIZE_MAX) {
    return {
      value: null,
      error: `Header size must be between ${String(HEADER_SIZE_MIN)} and ${String(HEADER_SIZE_MAX)} bytes.`,
    }
  }
  return { value, error: null }
}

export function FramingSection() {
  const framing = usePreferences((state) => state.framing)
  const setFraming = usePreferences((state) => state.setFraming)

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const update = useBuffers((state) => state.update)
  const active = tabs.find((tab) => tab.id === activeId)

  const [sizeText, setSizeText] = useState(String(framing.size))
  const sizeCheck = validateSize(sizeText)

  function commitSize(raw: string) {
    setSizeText(raw)
    const check = validateSize(raw)
    if (check.value !== null) setFraming({ size: check.value })
  }

  function applyToActive() {
    if (!active) return
    update(active.id, {
      autoDetect: framing.autoDetect,
      header: { enabled: framing.includeOnBuild, mode: framing.mode, size: framing.size },
    })
    toast.success(`Framing defaults applied to ${active.name}`)
  }

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Defaults for new buffers"
        description="Each buffer tab owns its own framing afterwards; change a live buffer in the raw pane."
      >
        <Switch
          checked={framing.autoDetect}
          onCheckedChange={(next) => setFraming({ autoDetect: next })}
          label="Auto-detect decode"
          description="Look for a length header before decoding, and adopt the one that is found."
        />

        <Switch
          checked={framing.includeOnBuild}
          onCheckedChange={(next) => setFraming({ includeOnBuild: next })}
          label="Include on build"
          description="Prefix built messages with the length header described below."
        />

        <SettingRow
          labelAs="span"
          label="Header mode"
          hint="ASCII writes zero-padded decimal digits; Binary writes big-endian bytes."
          control={
            <SegmentedControl
              value={framing.mode}
              onValueChange={(next) => setFraming({ mode: next as HeaderMode })}
              options={MODE_OPTIONS}
              aria-label="Header mode"
            />
          }
        />

        <SettingRow
          label="Header size"
          htmlFor="settings-header-size"
          hint={`${String(HEADER_SIZE_MIN)}–${String(HEADER_SIZE_MAX)} bytes. Packagers that declare LenLen override this per buffer.`}
          error={sizeCheck.error}
          control={
            <div className="w-24">
              <Input
                id="settings-header-size"
                value={sizeText}
                onValueChange={commitSize}
                onBlur={() => setSizeText(String(usePreferences.getState().framing.size))}
                inputMode="numeric"
                mono
                invalid={sizeCheck.error !== null}
                aria-describedby="settings-header-size-unit"
                suffix={
                  <span id="settings-header-size-unit" className="text-text-tertiary">
                    B
                  </span>
                }
              />
            </div>
          }
        />
      </SectionCard>

      <SectionCard
        title="Apply now"
        description="Defaults do not retroactively reframe buffers that are already open."
        action={
          <Button size="xs" onClick={applyToActive} disabled={!active}>
            Apply to active buffer
          </Button>
        }
      >
        {active ? (
          <ReadoutGroup>
            <Readout label="Active buffer" value={active.name} />
            <Readout label="Auto-detect" value={active.autoDetect ? 'on' : 'off'} />
            <Readout label="Include on build" value={active.header.enabled ? 'on' : 'off'} />
            <Readout
              label="Header mode"
              value={active.header.mode === 'none' ? 'none' : active.header.mode === 'ascii' ? 'ASCII' : 'Binary'}
            />
            <Readout label="Header size" value={`${String(active.header.size)} bytes`} />
          </ReadoutGroup>
        ) : (
          <p className="text-xs text-text-secondary">
            No buffer is open. New buffers will start with the settings above.
          </p>
        )}
      </SectionCard>
    </div>
  )
}
