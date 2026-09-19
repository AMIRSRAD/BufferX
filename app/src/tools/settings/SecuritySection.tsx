/**
 * Settings → Security (UX_SPEC 3.9).
 *
 * "A read-only statement of the persistence rules (Section 5.5), the idle-wipe
 * timeout (default 15 minutes, configurable 1–120 or off), `Mask PAN in field
 * table` toggle (default off), and a `Clear all secrets now` button."
 *
 * The persistence statement is generated from the same constants the storage
 * layer enforces, so it cannot drift into a comforting lie.
 */

import { useEffect, useState } from 'react'
import { Check, Lock, ShieldAlert, X } from 'lucide-react'
import { useToolStatuses, secretHolders } from '@/shell/toolStatus'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { InlineAlert } from '@/components/ui/InlineAlert'
import { Switch } from '@/components/ui/Switch'
import { Kbd } from '@/components/ui/Kbd'
import { toast } from '@/components/ui/toast'
import { formatShortcut } from '@/shell/useShortcuts'
import { SectionCard, SettingRow } from './parts'
import { IDLE_WIPE_MAX, IDLE_WIPE_MIN, usePreferences } from './preferences'
import { IDLE_WIPE_EVENT, clearAllSecretsNow } from './secretsWipe'

const NEVER_PERSISTED: readonly string[] = [
  'Clear PINs and PIN blocks, encrypted or not',
  'PAN entered in the PIN tool',
  'Any symmetric key: MAC, PIN, AES, PVK, crypto key, IV, ATM source and destination keys',
  'RSA private and public key PEMs',
  'Decrypted plaintexts, recovered PINs, natural PINs, PVVs and offsets',
  'Anything typed into a control marked secret',
]

const PERSISTED: readonly string[] = [
  'Layout: rail state, dock contents and pinning, splitter positions, active tab',
  'Appearance: theme, density, scale, monospace face, motion, field colours',
  'Packager: file path, active packager name, legacy engine mode',
  'Framing defaults: auto-detect, include-on-build, mode, size',
  'Recent buffer paths — never their contents',
  'Non-secret tool selections: algorithms, digests, formats, field ids, padding modes',
]

const HARD_RULES: readonly string[] = [
  'Never in a URL — routing is in memory; there is no query or hash state.',
  'Never in a log — the engine bridge logs operation names and byte counts, never bodies.',
  'Never in diagnostics — Copy diagnostics emits versions, layout and redacted problems only.',
  'Never in a buffer file — tool secrets are not part of the document format.',
]

function validateMinutes(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim()
  if (trimmed === '') return { value: null, error: 'Enter a timeout in minutes, or switch the wipe off.' }
  if (!/^\d+$/.test(trimmed)) return { value: null, error: 'The timeout must be a whole number of minutes.' }
  const value = Number.parseInt(trimmed, 10)
  if (value < IDLE_WIPE_MIN || value > IDLE_WIPE_MAX) {
    return {
      value: null,
      error: `The timeout must be between ${String(IDLE_WIPE_MIN)} and ${String(IDLE_WIPE_MAX)} minutes.`,
    }
  }
  return { value, error: null }
}

export function SecuritySection() {
  const idleWipeMinutes = usePreferences((state) => state.idleWipeMinutes)
  const setIdleWipeMinutes = usePreferences((state) => state.setIdleWipeMinutes)
  const maskAccountNumbers = usePreferences((state) => state.maskAccountNumbers)
  const setMaskAccountNumbers = usePreferences((state) => state.setMaskAccountNumbers)

  const statuses = useToolStatuses()
  const holders = secretHolders(statuses)

  const [minutesText, setMinutesText] = useState(String(idleWipeMinutes ?? 15))
  const check = validateMinutes(minutesText)
  const wipeOn = idleWipeMinutes !== null

  useEffect(() => {
    const onWipe = () => toast.info('Secrets cleared after inactivity')
    document.addEventListener(IDLE_WIPE_EVENT, onWipe)
    return () => document.removeEventListener(IDLE_WIPE_EVENT, onWipe)
  }, [])

  function commitMinutes(raw: string) {
    setMinutesText(raw)
    const parsed = validateMinutes(raw)
    if (parsed.value !== null) setIdleWipeMinutes(parsed.value)
  }

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Resident secrets"
        description="Keys, PINs and PEMs live in memory only, for as long as their tool is open."
        action={
          <Button size="xs" variant="danger" icon={ShieldAlert} onClick={() => {
            clearAllSecretsNow()
            toast.success('All secrets cleared')
          }}>
            Clear all secrets now
          </Button>
        }
      >
        {holders.length === 0 ? (
          <InlineAlert tone="ok" title="No secret is resident">
            No open tool is holding key material right now.
          </InlineAlert>
        ) : (
          <InlineAlert tone="warn" title={`${String(holders.length)} tool(s) hold a secret`}>
            {/* Tool ids, not titles: this section must not pull the whole tool
                registry (and every lazy panel with it) into its module graph. */}
            {holders.map((id) => id.toUpperCase()).join(', ')}. Listed by tool, never by value.
          </InlineAlert>
        )}

        <p className="flex flex-wrap items-center gap-1 text-xs text-text-secondary">
          <Lock size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
          Also bound to
          <Kbd>{formatShortcut('Ctrl+Alt+L')}</Kbd>
          and run automatically on tool close and window close.
        </p>
      </SectionCard>

      <SectionCard title="Idle wipe">
        <Switch
          checked={wipeOn}
          onCheckedChange={(next) => {
            if (next) {
              const parsed = validateMinutes(minutesText)
              setIdleWipeMinutes(parsed.value ?? 15)
              if (parsed.value === null) setMinutesText('15')
            } else {
              setIdleWipeMinutes(null)
            }
          }}
          label="Wipe secrets after inactivity"
          description="Pointer, keyboard, scroll and focus activity all reset the timer."
        />

        <SettingRow
          label="Timeout"
          htmlFor="settings-idle-minutes"
          hint={`${String(IDLE_WIPE_MIN)}–${String(IDLE_WIPE_MAX)} minutes. Default 15.`}
          error={wipeOn ? check.error : null}
          control={
            <div className="w-28">
              <Input
                id="settings-idle-minutes"
                value={minutesText}
                onValueChange={commitMinutes}
                inputMode="numeric"
                mono
                disabled={!wipeOn}
                invalid={wipeOn && check.error !== null}
                suffix={<span className="text-text-tertiary">min</span>}
              />
            </div>
          }
        />

        <p className="text-xs text-text-secondary">
          {wipeOn ? (
            <>
              Secrets are cleared after <span className="font-mono text-mono-xs text-text">{idleWipeMinutes}</span>{' '}
              minutes without activity.
            </>
          ) : (
            'The idle wipe is off. Secrets stay resident until a tool is closed or you clear them.'
          )}
        </p>
      </SectionCard>

      <SectionCard title="Field table">
        <Switch
          checked={maskAccountNumbers}
          onCheckedChange={setMaskAccountNumbers}
          label="Mask PAN in field table"
          description="Shows PAN-shaped values as ●●●● ●●●● ●●●● 1234 until the row is focused. Copying is unaffected."
        />
      </SectionCard>

      <SectionCard
        title="Persistence rules"
        description="Read-only. These are enforced by the storage layer, not by convention."
      >
        <div className="grid gap-group md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <h4 className="flex items-center gap-1 text-2xs tracking-wide text-text-tertiary uppercase">
              <X size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
              Never persisted
            </h4>
            <ul className="flex flex-col gap-0.5">
              {NEVER_PERSISTED.map((rule) => (
                <li key={rule} className="text-xs text-text-secondary">
                  {rule}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="flex items-center gap-1 text-2xs tracking-wide text-text-tertiary uppercase">
              <Check size={12} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" />
              Persisted
            </h4>
            <ul className="flex flex-col gap-0.5">
              {PERSISTED.map((rule) => (
                <li key={rule} className="text-xs text-text-secondary">
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ul className="flex flex-col gap-0.5">
          {HARD_RULES.map((rule) => (
            <li key={rule} className="flex items-start gap-1.5 text-xs text-text-secondary">
              <Badge tone="neutral">rule</Badge>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}
