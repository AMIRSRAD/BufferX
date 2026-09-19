/**
 * Settings → Appearance (UX_SPEC 3.9).
 *
 * "Theme `System` / `Dark` / `Light` (light ships at full parity) · Density
 * `Compact` / `Comfortable` · UI scale 90–150% · Monospace font choice ·
 * `Reduce motion` (`System` / `Always`) · field color palette on/off for the
 * ribbon and byte view."
 *
 * Plus the rail-label switch, which the shell owns and which belongs with the
 * other view preferences rather than hiding in a rail context menu.
 */

import { Monitor, Moon, RotateCcw, Sun } from 'lucide-react'
import { useSettings, type Density } from '@/store/settings'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'
import { SectionCard, SettingRow, Divider } from './parts'
import {
  MONO_FACES,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  resolveTheme,
  usePreferences,
  type MotionPreference,
  type ThemeSource,
} from './preferences'

const THEME_OPTIONS = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
]

const DENSITY_OPTIONS = [
  { value: 'dense', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
]

const MOTION_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'always', label: 'Always' },
]

const SCALE_STEPS = [90, 100, 110, 125, 150] as const

export function AppearanceSection() {
  const theme = useSettings((state) => state.theme)
  const density = useSettings((state) => state.density)
  const setDensity = useSettings((state) => state.setDensity)
  const railLabeled = useSettings((state) => state.railLabeled)
  const toggleRail = useSettings((state) => state.toggleRail)

  const themeSource = usePreferences((state) => state.themeSource)
  const setThemeSource = usePreferences((state) => state.setThemeSource)
  const uiScale = usePreferences((state) => state.uiScale)
  const setUiScale = usePreferences((state) => state.setUiScale)
  const monoFace = usePreferences((state) => state.monoFace)
  const setMonoFace = usePreferences((state) => state.setMonoFace)
  const reduceMotion = usePreferences((state) => state.reduceMotion)
  const setReduceMotion = usePreferences((state) => state.setReduceMotion)
  const fieldColors = usePreferences((state) => state.fieldColors)
  const setFieldColors = usePreferences((state) => state.setFieldColors)
  const resetAppearance = usePreferences((state) => state.resetAppearance)

  const resolved = resolveTheme(themeSource)

  return (
    <div className="flex flex-col gap-group">
      <SectionCard
        title="Theme and density"
        action={
          <Button size="xs" variant="ghost" icon={RotateCcw} onClick={resetAppearance}>
            Reset appearance
          </Button>
        }
      >
        <SettingRow
          labelAs="span"
          label="Theme"
          hint={
            themeSource === 'system'
              ? `Following the operating system — currently ${resolved}.`
              : 'Light ships at full parity with dark; both meet the same contrast targets.'
          }
          control={
            <SegmentedControl
              value={themeSource}
              onValueChange={(next) => setThemeSource(next as ThemeSource)}
              options={THEME_OPTIONS}
              aria-label="Theme"
            />
          }
        />

        <SettingRow
          labelAs="span"
          label="Density"
          hint="Affects control heights and padding only. Type sizes and colours do not change."
          control={
            <SegmentedControl
              value={density}
              onValueChange={(next) => setDensity(next as Density)}
              options={DENSITY_OPTIONS}
              aria-label="Density"
            />
          }
        />

        <Switch
          checked={railLabeled}
          onCheckedChange={toggleRail}
          label="Show rail labels"
          description="Widens the left rail from icons only to icons with names."
        />

        <Divider />

        <SettingRow
          labelAs="span"
          label="UI scale"
          hint={`${String(UI_SCALE_MIN)}–${String(UI_SCALE_MAX)}%. Scales every control, table row and type size together.`}
          control={
            <span className="flex items-center gap-1.5">
              <input
                type="range"
                min={UI_SCALE_MIN}
                max={UI_SCALE_MAX}
                step={5}
                value={uiScale}
                aria-label="UI scale percent"
                aria-valuetext={`${String(uiScale)} percent`}
                onChange={(event) => setUiScale(Number(event.target.value))}
                className="h-control-sm w-40 accent-accent"
              />
              <span className="w-12 text-right font-mono text-mono-sm text-text">{uiScale}%</span>
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-1">
          {SCALE_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setUiScale(step)}
              aria-pressed={uiScale === step}
              className={cn(
                'rounded-xs border px-1.5 py-0.5 font-mono text-mono-xs',
                'transition-colors duration-fast ease-standard',
                uiScale === step
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border-subtle bg-surface-2 text-text-secondary hover:bg-surface-raised',
              )}
            >
              {step}%
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Type and colour">
        <SettingRow
          label="Monospace font"
          htmlFor="settings-mono-face"
          hint="Used by every hex dump, field value and key input. Faces that are not installed fall back automatically."
          control={
            <div className="w-64">
              <Select
                id="settings-mono-face"
                value={monoFace}
                onValueChange={setMonoFace}
                options={MONO_FACES.map((face) => ({ value: face.id, label: face.label }))}
              />
            </div>
          }
        />

        <div className="rounded-sm border border-border-subtle bg-surface-inset px-cell-x py-cell-y">
          <span className="font-mono text-mono-sm text-text">
            0123456789 ABCDEF · 6011 0009 9013 9424 · F52 8A3C1D0E9B7F4A62
          </span>
        </div>

        <Switch
          checked={fieldColors}
          onCheckedChange={setFieldColors}
          label="Field colour palette"
          description="Colour-codes fields in the ribbon and bytes in the hex view. Off keeps the ranges but drops the hues."
        />

        <div className="flex flex-wrap items-center gap-1" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
            <span
              key={slot}
              className={cn(
                'rounded-xs px-1.5 py-0.5 font-mono text-mono-xs',
                slot === 1 && 'bg-hl-1-bg text-hl-1',
                slot === 2 && 'bg-hl-2-bg text-hl-2',
                slot === 3 && 'bg-hl-3-bg text-hl-3',
                slot === 4 && 'bg-hl-4-bg text-hl-4',
                slot === 5 && 'bg-hl-5-bg text-hl-5',
                slot === 6 && 'bg-hl-6-bg text-hl-6',
                slot === 7 && 'bg-hl-7-bg text-hl-7',
                slot === 8 && 'bg-hl-8-bg text-hl-8',
              )}
            >
              F{slot}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Motion">
        <SettingRow
          labelAs="span"
          label="Reduce motion"
          hint="System follows the OS setting. Always suppresses every transition and animation, keeping the static equivalents."
          control={
            <SegmentedControl
              value={reduceMotion}
              onValueChange={(next) => setReduceMotion(next as MotionPreference)}
              options={MOTION_OPTIONS}
              aria-label="Reduce motion"
            />
          }
        />
        <p className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Badge tone={reduceMotion === 'always' ? 'accent' : 'neutral'}>
            {reduceMotion === 'always' ? 'suppressed' : 'OS decides'}
          </Badge>
          Row flashes become a persistent outline and skeletons stop shimmering; no cue is lost.
        </p>
      </SectionCard>

      <SectionCard title="Applied now" description="What the shell is rendering with at this moment.">
        <dl className="grid grid-cols-2 gap-x-group gap-y-1 text-xs">
          <dt className="text-text-secondary">Theme</dt>
          <dd className="font-mono text-mono-xs text-text">
            {theme} {themeSource === 'system' ? '(system)' : ''}
          </dd>
          <dt className="text-text-secondary">Density</dt>
          <dd className="font-mono text-mono-xs text-text">{density}</dd>
          <dt className="text-text-secondary">Scale</dt>
          <dd className="font-mono text-mono-xs text-text">{uiScale}%</dd>
          <dt className="text-text-secondary">Mono face</dt>
          <dd className="font-mono text-mono-xs text-text">{monoFace}</dd>
        </dl>
      </SectionCard>
    </div>
  )
}
