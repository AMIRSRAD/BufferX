/**
 * The PIN tool (UX_SPEC 3.2) — the largest surface in the app.
 *
 * The four sub-tools that used to share one combobox and one set of half-hidden
 * controls are four sub-tabs with fully independent state. All state, including
 * every result, lives in this component: the sub-tabs are views over it, so
 * switching tabs preserves work while a value typed in one sub-tool can never
 * bleed into another. The only sharing is the explicit `Carry over` action,
 * which stamps visible provenance (`PAN from Visa PVV`).
 *
 * Secrets discipline (UX_SPEC 3.2 "PIN-wide rules" and 5.5): every key, clear
 * PIN, PAN and PIN block here is a `SecretInput`, held in memory only, and
 * wiped on tool close (unmount), on `Ctrl+Alt+L`, and after 15 minutes idle.
 * Nothing in this tool is persisted, logged, or placed in a URL.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Tabs } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/toast'
import { reportToolStatus } from '@/shell/toolStatus'
import {
  SHELL_ACTION_EVENT,
  SHELL_COMMAND_EVENT,
  type ShellActionDetail,
  type ShellCommandDetail,
} from '@/shell/useShortcuts'
import { useTools } from '@/store/tools'
import { Ibm3624Tab } from './Ibm3624Tab'
import { PinBlocksTab } from './PinBlocksTab'
import { TranslateTab } from './TranslateTab'
import { VisaPvvTab } from './VisaPvvTab'
import type { CarryOverItem } from './parts'
import {
  BLOCKS_INITIAL,
  IBM_INITIAL,
  PVV_INITIAL,
  TRANSLATE_INITIAL,
  useRunner,
  useTabModel,
  type TabActions,
} from './state'

type SubTab = 'blocks' | 'pvv' | 'ibm' | 'translate'

const TAB_LABEL: Record<SubTab, string> = {
  blocks: 'PIN Blocks',
  pvv: 'Visa PVV',
  ibm: 'IBM 3624',
  translate: 'Translate',
}

/** Which carried values each sub-tab can accept. */
const ACCEPTS: Record<SubTab, { pan: boolean; pin: boolean }> = {
  blocks: { pan: true, pin: true },
  pvv: { pan: true, pin: true },
  ibm: { pan: false, pin: true },
  translate: { pan: true, pin: false },
}

/** Idle timeout before in-memory secrets are wiped (UX_SPEC 3.2). */
const IDLE_WIPE_MS = 15 * 60 * 1000

export default function PinPanel() {
  const [tab, setTab] = useState<SubTab>('blocks')

  const blocks = useTabModel(BLOCKS_INITIAL)
  const pvv = useTabModel(PVV_INITIAL)
  const ibm = useTabModel(IBM_INITIAL)
  const translate = useTabModel(TRANSLATE_INITIAL)

  const blocksRunner = useRunner(blocks.version)
  const pvvRunner = useRunner(pvv.version)
  const ibmRunner = useRunner(ibm.version)
  const translateRunner = useRunner(translate.version)

  const actionsRef = useRef<TabActions | null>(null)
  const promoted = useTools((store) => store.promoted)

  /** `PAN from Visa PVV`, shown as a chip next to the carry-over trigger. */
  const [carriedFrom, setCarriedFrom] = useState<Partial<Record<SubTab, string>>>({})

  /* ── Carry over ───────────────────────────────────────────────────────── */

  const applyCarry = useCallback(
    (target: SubTab, kind: 'PAN' | 'Clear PIN', from: string, value: string) => {
      switch (target) {
        case 'blocks':
          blocks.patch(kind === 'PAN' ? { pan: value } : { clearPin: value })
          break
        case 'pvv':
          pvv.patch(kind === 'PAN' ? { pan: value } : { clearPin: value })
          break
        case 'ibm':
          if (kind === 'Clear PIN') ibm.patch({ clearPin: value })
          break
        case 'translate':
          if (kind === 'PAN') translate.patch({ pan: value })
          break
      }
      setCarriedFrom((current) => ({ ...current, [target]: `${kind} from ${from}` }))
      toast.info(`Carried the ${kind.toLowerCase()} from ${from}.`)
    },
    [blocks, ibm, pvv, translate],
  )

  const carryFor = useCallback(
    (target: SubTab): CarryOverItem[] => {
      const sources: { id: SubTab; pan?: string; pin?: string }[] = [
        { id: 'blocks', pan: blocks.state.pan, pin: blocks.state.clearPin },
        { id: 'pvv', pan: pvv.state.pan, pin: pvv.state.clearPin },
        { id: 'ibm', pin: ibm.state.clearPin },
        { id: 'translate', pan: translate.state.pan },
      ]
      const accepts = ACCEPTS[target]
      const items: CarryOverItem[] = []

      for (const source of sources) {
        if (source.id === target) continue
        const label = TAB_LABEL[source.id]
        if (accepts.pan && source.pan) {
          const value = source.pan
          items.push({
            label: `PAN from ${label}`,
            value,
            onApply: () => applyCarry(target, 'PAN', label, value),
          })
        }
        if (accepts.pin && source.pin) {
          const value = source.pin
          items.push({
            label: `Clear PIN from ${label}`,
            value,
            onApply: () => applyCarry(target, 'Clear PIN', label, value),
          })
        }
      }
      return items
    },
    [applyCarry, blocks.state.clearPin, blocks.state.pan, ibm.state.clearPin, pvv.state.clearPin, pvv.state.pan, translate.state.pan],
  )

  /* ── Secret wipe ──────────────────────────────────────────────────────── */

  const holdsSecret =
    blocks.state.pan.length +
      blocks.state.clearPin.length +
      blocks.state.clearBlock.length +
      blocks.state.encryptedBlock.length +
      blocks.state.key.length +
      pvv.state.pan.length +
      pvv.state.clearPin.length +
      pvv.state.pvk.length +
      ibm.state.clearPin.length +
      ibm.state.pvk.length +
      ibm.state.offset.length +
      translate.state.sourceBlock.length +
      translate.state.sourceKey.length +
      translate.state.destinationKey.length +
      translate.state.pan.length >
    0

  const wipeSecrets = useCallback(() => {
    blocks.patch({ pan: '', clearPin: '', clearBlock: '', encryptedBlock: '', key: '' })
    pvv.patch({ pan: '', clearPin: '', pvk: '' })
    ibm.patch({ clearPin: '', pvk: '', offset: '' })
    translate.patch({ sourceBlock: '', sourceKey: '', destinationKey: '', pan: '' })
    blocksRunner.clear()
    pvvRunner.clear()
    ibmRunner.clear()
    translateRunner.clear()
    setCarriedFrom({})
  }, [blocks, blocksRunner, ibm, ibmRunner, pvv, pvvRunner, translate, translateRunner])

  // `Ctrl+Alt+L` — the shell broadcasts, every holder of secret material wipes.
  useEffect(() => {
    function onCommand(event: Event) {
      const detail = (event as CustomEvent<ShellCommandDetail>).detail
      if (detail?.command === 'clear-secrets') wipeSecrets()
    }
    document.addEventListener(SHELL_COMMAND_EVENT, onCommand)
    return () => document.removeEventListener(SHELL_COMMAND_EVENT, onCommand)
  }, [wipeSecrets])

  // Idle wipe. The timer restarts on every edit in any sub-tab.
  const activity = blocks.version + pvv.version + ibm.version + translate.version
  useEffect(() => {
    if (!holdsSecret) return
    const timer = window.setTimeout(() => {
      wipeSecrets()
      toast.info('PIN tool secrets were wiped after 15 minutes idle.')
    }, IDLE_WIPE_MS)
    return () => window.clearTimeout(timer)
  }, [activity, holdsSecret, wipeSecrets])

  /* ── Rail state dot ───────────────────────────────────────────────────── */

  const runners = useMemo(
    () => [blocksRunner, pvvRunner, ibmRunner, translateRunner],
    [blocksRunner, ibmRunner, pvvRunner, translateRunner],
  )

  useEffect(() => {
    reportToolStatus('pin', {
      result: runners.some((runner) => runner.result !== null),
      stale: runners.some((runner) => runner.stale),
      error: runners.some((runner) => runner.error !== null),
      secret: holdsSecret,
    })
  }, [holdsSecret, runners])

  /* ── Ctrl+Enter / Ctrl+Shift+Enter ────────────────────────────────────── */

  useEffect(() => {
    function onAction(event: Event) {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (!detail) return
      const mine =
        detail.tool === 'pin' || (promoted === 'pin' && detail.region === 'workspace')
      if (!mine) return
      const actions = actionsRef.current
      if (!actions) return
      if (detail.kind === 'primary') actions.primary()
      else actions.secondary?.()
    }
    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    return () => document.removeEventListener(SHELL_ACTION_EVENT, onAction)
  }, [promoted])

  /* ── Render ───────────────────────────────────────────────────────────── */

  const tabs = (Object.keys(TAB_LABEL) as SubTab[]).map((id) => ({
    value: id,
    label: TAB_LABEL[id],
  }))

  return (
    <div className="flex min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as SubTab)}
        tabs={tabs}
        aria-label="PIN sub-tools"
        listClassName="px-panel"
      >
        {tab === 'blocks' && (
          <PinBlocksTab
            model={blocks}
            runner={blocksRunner}
            carry={carryFor('blocks')}
            provenance={carriedFrom.blocks}
            actionsRef={actionsRef}
          />
        )}
        {tab === 'pvv' && (
          <VisaPvvTab
            model={pvv}
            runner={pvvRunner}
            carry={carryFor('pvv')}
            provenance={carriedFrom.pvv}
            actionsRef={actionsRef}
          />
        )}
        {tab === 'ibm' && (
          <Ibm3624Tab
            model={ibm}
            runner={ibmRunner}
            carry={carryFor('ibm')}
            provenance={carriedFrom.ibm}
            actionsRef={actionsRef}
          />
        )}
        {tab === 'translate' && (
          <TranslateTab
            model={translate}
            runner={translateRunner}
            carry={carryFor('translate')}
            provenance={carriedFrom.translate}
            actionsRef={actionsRef}
          />
        )}
      </Tabs>

      <p className="flex items-start gap-1.5 border-t border-border-subtle px-panel py-2 text-2xs text-text-tertiary">
        <ShieldCheck size={14} strokeWidth={1.25} absoluteStrokeWidth className="mt-px shrink-0" aria-hidden="true" />
        Clear PINs and keys are held in memory only. Nothing here is saved or logged.
      </p>
    </div>
  )
}
