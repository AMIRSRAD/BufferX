/**
 * The RSA tool (UX_SPEC 3.4).
 *
 * Two sub-tabs over one shared pair of PEM keys:
 *
 *   [ Sign / Verify ]  [ Encrypt / Decrypt ]
 *
 * The split is the point. In the old Qt panel a single text area carried both
 * the signature and the ciphertext, so `Encrypt` after `Sign` destroyed the
 * signature and `Decrypt` overwrote the payload the operator still needed. Here
 * each sub-tab owns its own model — held in this component, so switching tabs
 * never discards work — and decryption writes to its own result block.
 *
 * Secrets (UX_SPEC 5.5): both PEM boxes and any recovered plaintext are memory
 * only. Nothing in this tool is persisted, no key material reaches the Problems
 * log (which records sizes and settings), and `Clear all secrets` — the shell's
 * `Ctrl+Alt+L` — wipes the keys and the decrypted plaintext.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { SHELL_ACTION_EVENT, SHELL_COMMAND_EVENT } from '@/shell/useShortcuts'
import type { ShellActionDetail, ShellCommandDetail } from '@/shell/useShortcuts'
import { reportToolStatus } from '@/shell/toolStatus'
import { useProblems } from '@/store/problems'
import { EMPTY_KEY_SLOT, readKeyState, type KeySlot } from './model'
import { BusyBar, Divider } from './parts'
import { RsaEncryptDecrypt } from './RsaEncryptDecrypt'
import { RsaKeysSection } from './RsaKeysSection'
import { RsaSignVerify } from './RsaSignVerify'
import { useEncryptDecrypt } from './useEncryptDecrypt'
import { useSignVerify } from './useSignVerify'

const TOOL_ID = 'rsa'

type SubTab = 'sign' | 'crypt'

const TABS = [
  { value: 'sign', label: 'Sign / Verify' },
  { value: 'crypt', label: 'Encrypt / Decrypt' },
]

export default function RsaPanel() {
  const addProblem = useProblems((state) => state.add)

  const [tab, setTab] = useState<SubTab>('sign')
  const [privateSlot, setPrivateSlot] = useState<KeySlot>(EMPTY_KEY_SLOT)
  const [publicSlot, setPublicSlot] = useState<KeySlot>(EMPTY_KEY_SLOT)

  const privateKey = useMemo(() => readKeyState(privateSlot), [privateSlot])
  const publicKey = useMemo(() => readKeyState(publicSlot), [publicSlot])

  const signModel = useSignVerify(privateKey, publicKey)
  const cryptModel = useEncryptDecrypt(privateKey, publicKey)

  /* ── Key material ─────────────────────────────────────────────────────── */

  const onKeyChange = useCallback(
    (which: 'private' | 'public', pem: string, source: string | null) => {
      const apply = (current: KeySlot): KeySlot => {
        if (pem.trim() === '') return EMPTY_KEY_SLOT
        // Typing into an already-loaded box keeps the original timestamp, so
        // the summary line does not tick on every keystroke.
        const keepStamp =
          source === 'pasted' && current.pem.trim() !== '' && current.source === 'pasted'
        return { pem, source, loadedAt: keepStamp ? current.loadedAt : Date.now() }
      }
      if (which === 'private') setPrivateSlot(apply)
      else setPublicSlot(apply)
    },
    [],
  )

  // Stable across renders (both are `useCallback([])` in their hooks), so the
  // shell listeners below subscribe once rather than on every keystroke.
  const clearDecrypted = cryptModel.clearSecrets

  const clearKeys = useCallback(
    (announce: boolean) => {
      setPrivateSlot(EMPTY_KEY_SLOT)
      setPublicSlot(EMPTY_KEY_SLOT)
      clearDecrypted()
      if (announce) {
        toast.success('RSA key material cleared.')
        addProblem({
          severity: 'info',
          source: 'RSA',
          message: 'Key material and any recovered plaintext were cleared from memory.',
        })
      }
    },
    [addProblem, clearDecrypted],
  )

  /* ── Shell integration ────────────────────────────────────────────────── */

  // `Ctrl+Alt+L` / the palette's `Clear all secrets`.
  useEffect(() => {
    function onCommand(event: Event) {
      const detail = (event as CustomEvent<ShellCommandDetail>).detail
      if (detail?.command === 'clear-secrets') clearKeys(false)
    }
    document.addEventListener(SHELL_COMMAND_EVENT, onCommand)
    return () => document.removeEventListener(SHELL_COMMAND_EVENT, onCommand)
  }, [clearKeys])

  // `Ctrl+Enter` / `Ctrl+Shift+Enter` while this tool has focus (UX_SPEC 4.2).
  // The handler reads the models through a ref so the subscription is set up
  // once, while still invoking the current run functions.
  const latest = useRef({ tab, signModel, cryptModel })
  latest.current = { tab, signModel, cryptModel }

  useEffect(() => {
    function onAction(event: Event) {
      const detail = (event as CustomEvent<ShellActionDetail>).detail
      if (!detail || detail.tool !== TOOL_ID) return
      const current = latest.current
      if (current.tab === 'sign') {
        if (detail.kind === 'primary') void current.signModel.sign()
        else void current.signModel.verify()
        return
      }
      if (detail.kind === 'primary') void current.cryptModel.encrypt()
      else void current.cryptModel.decrypt()
    }
    document.addEventListener(SHELL_ACTION_EVENT, onAction)
    return () => document.removeEventListener(SHELL_ACTION_EVENT, onAction)
  }, [])

  // Rail dot and the command bar's secret indicator (UX_SPEC 1.2, 5.5 rule 5).
  const holdsSecret =
    privateSlot.pem !== '' || publicSlot.pem !== '' || cryptModel.decrypted !== null
  const hasResult = signModel.hasResult || cryptModel.hasResult
  const isStale =
    signModel.signatureStale || cryptModel.ciphertextStale || cryptModel.decryptedStale
  const hasError = signModel.error !== null || cryptModel.error !== null

  useEffect(() => {
    reportToolStatus(TOOL_ID, {
      secret: holdsSecret,
      result: hasResult,
      stale: isStale,
      error: hasError,
    })
  }, [hasError, hasResult, holdsSecret, isStale])

  /* ── Render ───────────────────────────────────────────────────────────── */

  const busy = signModel.showProgress || cryptModel.showProgress
  // A key box only turns red once it holds text that cannot serve the active
  // sub-tab; an empty box is a prerequisite, stated by the action bar instead.
  const privateError =
    privateSlot.pem.trim() === ''
      ? null
      : tab === 'sign'
        ? signModel.problems.privateKey
        : cryptModel.problems.privateKey
  const publicError =
    publicSlot.pem.trim() === ''
      ? null
      : tab === 'sign'
        ? signModel.problems.publicKey
        : cryptModel.problems.publicKey

  return (
    <div className="flex min-h-0 flex-col">
      <BusyBar active={busy} label="Running the RSA operation" />

      <div className={cn('flex flex-col gap-group p-panel pb-0')}>
        <RsaKeysSection
          privateKey={privateKey}
          publicKey={publicKey}
          onChange={onKeyChange}
          onClear={() => clearKeys(true)}
          privateError={privateError}
          publicError={publicError}
        />
        <Divider />
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === 'crypt' ? 'crypt' : 'sign')}
        tabs={TABS}
        aria-label="RSA operation"
        listClassName="px-2"
      >
        {tab === 'sign' ? (
          <RsaSignVerify model={signModel} />
        ) : (
          <RsaEncryptDecrypt model={cryptModel} />
        )}
      </Tabs>
    </div>
  )
}
