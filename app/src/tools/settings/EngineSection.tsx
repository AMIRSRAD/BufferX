/**
 * Settings → Engine (UX_SPEC 3.9).
 *
 * The `Legacy ATM Engine` switch, the tooltip text promoted to visible body
 * copy, the framing-consequence table stated rather than applied invisibly, and
 * a preview of what the change does to the current packager with `Apply` /
 * `Cancel`.
 */

import { useState } from 'react'
import { ArrowRight, Cpu } from 'lucide-react'
import { useBuffers } from '@/store/buffers'
import { useSettings } from '@/store/settings'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Switch } from '@/components/ui/Switch'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { SectionCard } from './parts'
import {
  LEGACY_ENGINE_EXPLANATION,
  LEGACY_FRAMING_TABLE,
  applyRule,
  legacyFramingFor,
  previewLegacyFraming,
} from './legacyFraming'

function modeCell(mode: 'none' | 'ascii' | 'binary'): string {
  if (mode === 'ascii') return 'ASCII'
  if (mode === 'binary') return 'Binary'
  return '—'
}

export function EngineSection() {
  const legacyEngine = useSettings((state) => state.legacyEngine)
  const setLegacyEngine = useSettings((state) => state.setLegacyEngine)

  const tabs = useBuffers((state) => state.tabs)
  const activeId = useBuffers((state) => state.activeId)
  const update = useBuffers((state) => state.update)
  const active = tabs.find((tab) => tab.id === activeId)

  /** `null` = no pending change; otherwise the value awaiting `Apply`. */
  const [pending, setPending] = useState<boolean | null>(null)
  const shown = pending ?? legacyEngine

  const preview =
    active && pending === true
      ? previewLegacyFraming(active.packager, active.header, active.autoDetect)
      : null
  const activeRule = active ? legacyFramingFor(active.packager) : null

  function apply() {
    if (pending === null) return
    setLegacyEngine(pending)
    if (pending && active) {
      const next = applyRule(legacyFramingFor(active.packager), active.header)
      update(active.id, { header: next.header, autoDetect: next.autoDetect })
      toast.success(`Legacy ATM engine on · framing applied to ${active.name}`)
    } else {
      toast.success(pending ? 'Legacy ATM engine on' : 'Generic ISO 8583 engine restored')
    }
    setPending(null)
  }

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Engine mode"
        description="Which set of framing and encoding rules the decoder and the builder follow."
      >
        <Switch
          checked={shown}
          onCheckedChange={(next) => setPending(next === legacyEngine ? null : next)}
          label="Legacy ATM Engine"
          description={LEGACY_ENGINE_EXPLANATION}
        />

        <p className="text-xs text-text-secondary">
          Every decode, build, MAC calculation and MAC verification issued while this is on passes{' '}
          <code className="font-mono text-mono-xs text-text">legacyEngine: true</code> to the engine. Results
          from the two modes are not interchangeable — a message built in one mode will not decode in the
          other.
        </p>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary">Command bar shows</span>
          <Badge tone={shown ? 'warn' : 'neutral'} mono dot>
            {shown ? 'ENGINE: LEGACY ATM' : 'ENGINE: GENERIC'}
          </Badge>
        </div>

        {pending !== null ? (
          <InlineAlert
            tone="warn"
            title={pending ? 'Switch to the legacy ATM engine?' : 'Return to the generic engine?'}
            action={
              <div className="flex items-center gap-1">
                <Button size="xs" variant="primary" onClick={apply}>
                  Apply
                </Button>
                <Button size="xs" onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </div>
            }
          >
            {pending ? (
              preview && active ? (
                <div className="flex flex-col gap-1">
                  <span>
                    Framing for <span className="font-mono text-mono-xs">{active.packager}</span> in{' '}
                    <span className="font-mono text-mono-xs">{active.name}</span> will change to the{' '}
                    <span className="font-mono text-mono-xs">{preview.rule.family}</span> rule:
                  </span>
                  <ul className="flex flex-col gap-0.5">
                    {preview.changes.map((change) => (
                      <li
                        key={change.label}
                        className={cn(
                          'flex items-center gap-1.5 text-xs',
                          change.changed ? 'text-text' : 'text-text-tertiary',
                        )}
                      >
                        <span className="min-w-28">{change.label}</span>
                        <span className="font-mono text-mono-xs">{change.before}</span>
                        <ArrowRight size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
                        <span className="font-mono text-mono-xs">{change.after}</span>
                        {change.changed ? null : <span>(no change)</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <span>
                  No buffer is open, so nothing is reframed right now. The rules below apply the next time a
                  packager is chosen.
                </span>
              )
            ) : (
              <span>
                Framing already applied to open buffers is left exactly as it is. The rules below simply stop
                being applied on the next packager change.
              </span>
            )}
          </InlineAlert>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Framing consequences"
        description="What the legacy engine applies per packager family, stated instead of applied invisibly."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-128 border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-cell-x py-cell-y text-left text-2xs tracking-wide text-text-tertiary uppercase">
                  Packager family
                </th>
                <th scope="col" className="px-cell-x py-cell-y text-left text-2xs tracking-wide text-text-tertiary uppercase">
                  Header
                </th>
                <th scope="col" className="px-cell-x py-cell-y text-left text-2xs tracking-wide text-text-tertiary uppercase">
                  Auto
                </th>
                <th scope="col" className="px-cell-x py-cell-y text-left text-2xs tracking-wide text-text-tertiary uppercase">
                  Mode
                </th>
                <th scope="col" className="px-cell-x py-cell-y text-right text-2xs tracking-wide text-text-tertiary uppercase">
                  Size
                </th>
              </tr>
            </thead>
            <tbody>
              {LEGACY_FRAMING_TABLE.map((rule) => {
                const current = activeRule?.id === rule.id
                return (
                  <tr
                    key={rule.id}
                    className={cn(
                      'border-b border-border-subtle last:border-b-0',
                      current && 'bg-accent-muted',
                    )}
                  >
                    <th scope="row" className="px-cell-x py-cell-y text-left font-mono text-mono-xs font-normal text-text">
                      {rule.family}
                      {current ? (
                        <span className="ml-1.5 align-middle">
                          <Badge tone="accent">current</Badge>
                        </span>
                      ) : null}
                    </th>
                    <td className="px-cell-x py-cell-y text-text-secondary">{rule.enabled ? 'on' : 'off'}</td>
                    <td className="px-cell-x py-cell-y text-text-secondary">{rule.autoDetect ? 'on' : 'off'}</td>
                    <td className="px-cell-x py-cell-y text-text-secondary">{modeCell(rule.mode)}</td>
                    <td className="px-cell-x py-cell-y text-right font-mono text-mono-xs text-text-secondary">
                      {rule.size === null ? '—' : rule.size}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {active ? (
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Cpu size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
            <span>
              <span className="font-mono text-mono-xs text-text">{active.packager}</span> matches the{' '}
              <span className="font-mono text-mono-xs text-text">{activeRule?.family}</span> rule.
            </span>
          </p>
        ) : (
          <p className="text-xs text-text-secondary">Open a buffer to see which row applies to it.</p>
        )}
      </SectionCard>
    </div>
  )
}
