/**
 * The structure ribbon (UX_SPEC 2.3).
 *
 * An 18px proportional map of the whole message, sitting under the view-mode
 * control in all three raw views. Segments are proportional to byte length with
 * a 6px floor so a 1-byte field stays clickable; unmapped runs render hatched
 * and labelled, so a decode problem is something you can *see*.
 *
 * Colour is never the only signal: every segment carries its label, a title
 * with the byte range, and a visually hidden list entry for screen readers.
 */

import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { offsetLabel, type Region } from './model'

const SEGMENT_BG = [
  'bg-hl-1-bg',
  'bg-hl-2-bg',
  'bg-hl-3-bg',
  'bg-hl-4-bg',
  'bg-hl-5-bg',
  'bg-hl-6-bg',
  'bg-hl-7-bg',
  'bg-hl-8-bg',
] as const

const SEGMENT_INK = [
  'text-hl-1',
  'text-hl-2',
  'text-hl-3',
  'text-hl-4',
  'text-hl-5',
  'text-hl-6',
  'text-hl-7',
  'text-hl-8',
] as const

function slot(colorIndex: number): number {
  return ((Math.trunc(colorIndex) % 8) + 8) % 8
}

function shortLabel(region: Region): string {
  if (region.kind === 'field' && region.fieldId !== undefined) return `F${region.fieldId}`
  if (region.kind === 'prefix') return 'len'
  if (region.kind === 'unparsed') return '?'
  return region.label
}

function describe(region: Region): string {
  const bytes = region.end - region.start
  return `${region.label} · ${bytes} byte${bytes === 1 ? '' : 's'} · offset ${offsetLabel(region.start)}–${offsetLabel(Math.max(region.start, region.end - 1))}`
}

export interface StructureRibbonProps {
  regions: readonly Region[]
  totalBytes: number
  selectedFieldId: number | null
  hoveredFieldId: number | null
  onHover(region: Region | null): void
  onSelect(region: Region): void
  className?: string
}

export function StructureRibbon({
  regions,
  totalBytes,
  selectedFieldId,
  hoveredFieldId,
  onHover,
  onSelect,
  className,
}: StructureRibbonProps) {
  if (totalBytes === 0 || regions.length === 0) {
    return (
      <div
        className={cn(
          'flex h-[18px] shrink-0 items-center rounded-xs border border-border-subtle bg-surface-2 px-1.5',
          className,
        )}
      >
        <span className="text-2xs text-text-tertiary">
          {totalBytes === 0 ? 'No bytes yet.' : 'Decode to map the message structure.'}
        </span>
      </div>
    )
  }

  const summary = regions.map((region) => describe(region)).join('; ')

  return (
    <div className={cn('shrink-0', className)}>
      <div
        role="img"
        aria-label={`Message structure: ${summary}`}
        onPointerLeave={() => onHover(null)}
        className="flex h-[18px] w-full items-stretch gap-px overflow-hidden rounded-xs border border-border-subtle bg-surface-2"
      >
        {regions.map((region) => {
          const bytes = Math.max(1, region.end - region.start)
          const index = slot(region.colorIndex)
          const active =
            region.fieldId !== undefined &&
            (region.fieldId === selectedFieldId || region.fieldId === hoveredFieldId)
          const unparsed = region.kind === 'unparsed'

          return (
            <Tooltip key={`${region.kind}-${region.start}-${region.end}`} content={describe(region)}>
              <button
                type="button"
                onPointerEnter={() => onHover(region)}
                onFocus={() => onHover(region)}
                onClick={() => onSelect(region)}
                aria-label={describe(region)}
                style={{ flexGrow: bytes, flexBasis: 0, minWidth: 6 }}
                className={cn(
                  'relative flex min-w-0 items-center justify-center overflow-hidden px-0.5',
                  'text-mono-xs whitespace-nowrap',
                  'transition-opacity duration-fast ease-standard motion-reduce:transition-none',
                  unparsed
                    ? 'bg-surface-3 text-text-tertiary'
                    : cn(SEGMENT_BG[index], SEGMENT_INK[index]),
                  active ? 'opacity-100 inset-ring-1 inset-ring-accent' : 'opacity-80 hover:opacity-100',
                )}
              >
                {unparsed ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0"
                    style={{
                      backgroundImage:
                        'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 5px)',
                      opacity: 0.35,
                    }}
                  />
                ) : null}
                <span className="truncate">{shortLabel(region)}</span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* A picture is not a substitute for structure (UX_SPEC 6.3). */}
      <ol className="sr-only">
        {regions.map((region) => (
          <li key={`sr-${region.kind}-${region.start}`}>
            <button type="button" onClick={() => onSelect(region)}>
              {describe(region)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
