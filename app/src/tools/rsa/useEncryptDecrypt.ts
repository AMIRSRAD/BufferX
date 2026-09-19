/**
 * Encrypt / Decrypt state for the RSA tool (UX_SPEC 3.4).
 *
 * The decisive fix over the old panel: `Decrypt` writes to its own result
 * block, never over the plaintext the operator still needs. Moving a result
 * back into an input is an explicit `↑ use as plaintext` action.
 *
 * The recovered plaintext is treated as secret material (UX_SPEC 5.5 lists
 * decrypted plaintexts among the never-persisted values): it is held in memory,
 * kept out of the Problems log — which records byte counts only — and wiped by
 * `clearSecrets`.
 */

import { useCallback, useMemo, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { tryCall } from '@/engine/client'
import { useProblems } from '@/store/problems'
import {
  byteCount,
  clockTime,
  provenance,
  toToolError,
  unexpectedError,
  type KeyState,
  type ToolError,
} from './model'
import {
  base64ByteLength,
  maxPlaintextBytes,
  PADDING_LABEL,
  utf8ByteLength,
  type RsaPadding,
} from './pem'
import { base64Problem, isClear, plaintextProblem, privateKeyProblem, publicKeyProblem } from './validation'
import { useDelayedFlag } from './useDelayedFlag'

interface RunMeta {
  at: number
  provenance: string
  snapshot: string
}

export interface DecryptedResult extends RunMeta {
  plaintext: string
}

export interface EncryptDecryptModel {
  padding: RsaPadding
  setPadding(padding: RsaPadding): void
  plaintext: string
  setPlaintext(plaintext: string): void
  ciphertext: string
  setCiphertext(ciphertext: string): void

  plaintextBytes: number
  /** Largest plaintext the current key and padding accept, when knowable. */
  capacity: number | null

  busy: 'encrypt' | 'decrypt' | null
  showProgress: boolean
  error: ToolError | null
  dismissError(): void

  encrypted: RunMeta | null
  ciphertextStale: boolean
  decrypted: DecryptedResult | null
  decryptedStale: boolean

  problems: {
    privateKey: string | null
    publicKey: string | null
    plaintext: string | null
    ciphertext: string | null
  }
  canEncrypt: boolean
  canDecrypt: boolean

  encrypt(): Promise<void>
  decrypt(): Promise<void>
  useDecryptedAsPlaintext(): void
  clear(): void
  /** Wipes the recovered plaintext without disturbing the operator's inputs. */
  clearSecrets(): void
  hasResult: boolean
}

/** `2048-bit key`, or nothing when the modulus could not be recovered. */
function keyBits(key: KeyState): string | null {
  const bits = key.info?.modulusBits
  return typeof bits === 'number' ? `${bits}-bit key` : null
}

export function useEncryptDecrypt(
  privateKey: KeyState,
  publicKey: KeyState,
): EncryptDecryptModel {
  const addProblem = useProblems((state) => state.add)

  const [padding, setPadding] = useState<RsaPadding>('oaepsha256')
  const [plaintext, setPlaintext] = useState('')
  const [ciphertext, setCiphertext] = useState('')
  const [busy, setBusy] = useState<'encrypt' | 'decrypt' | null>(null)
  const [error, setError] = useState<ToolError | null>(null)
  const [encrypted, setEncrypted] = useState<RunMeta | null>(null)
  const [decrypted, setDecrypted] = useState<DecryptedResult | null>(null)

  const showProgress = useDelayedFlag(busy !== null)
  const plaintextBytes = utf8ByteLength(plaintext)

  const encryptSnapshot = useMemo(
    () => [padding, plaintext, publicKey.pem].join(' '),
    [padding, plaintext, publicKey.pem],
  )
  const decryptSnapshot = useMemo(
    () => [padding, ciphertext, privateKey.pem].join(' '),
    [padding, ciphertext, privateKey.pem],
  )

  const encryptKeyProblem = publicKeyProblem(publicKey, 'Encrypt')
  const decryptKeyProblem = privateKeyProblem(privateKey, 'Decrypt')
  const plaintextIssue = plaintextProblem(
    plaintextBytes,
    padding,
    publicKey.info?.modulusBytes ?? null,
    publicKey.info?.modulusBits ?? null,
  )
  const ciphertextIssue = base64Problem(
    ciphertext,
    'Ciphertext',
    privateKey.info?.modulusBytes ?? null,
    privateKey.info?.modulusBits ?? null,
  )

  const problems = {
    privateKey: decryptKeyProblem,
    publicKey: encryptKeyProblem,
    plaintext: plaintextIssue,
    ciphertext: ciphertextIssue,
  }

  const canEncrypt = busy === null && isClear({ key: encryptKeyProblem, plaintext: plaintextIssue })
  const canDecrypt = busy === null && isClear({ key: decryptKeyProblem, ciphertext: ciphertextIssue })

  const encrypt = useCallback(async () => {
    if (!canEncrypt) return
    setBusy('encrypt')
    setError(null)
    try {
      const result = await tryCall<{ ciphertext: string }>('rsa.encrypt', {
        payload: plaintext,
        publicKeyPem: publicKey.pem,
        padding,
      })
      if (!result.ok) {
        const failure = toToolError(result.error, 'Encryption failed')
        setError(failure)
        addProblem({ severity: 'error', source: 'RSA', message: `Encrypt · ${failure.message}` })
        return
      }
      const at = Date.now()
      const outBytes = base64ByteLength(result.data.ciphertext) ?? 0
      setCiphertext(result.data.ciphertext)
      setEncrypted({
        at,
        snapshot: [padding, plaintext, publicKey.pem].join(' '),
        provenance: provenance(
          PADDING_LABEL[padding],
          keyBits(publicKey),
          `${plaintextBytes} in / ${outBytes} out`,
          `encrypted ${clockTime(at)}`,
        ),
      })
      toast.success('Encrypted.')
      addProblem({
        severity: 'info',
        source: 'RSA',
        message: `Encrypted ${plaintextBytes} bytes to ${outBytes} bytes with ${PADDING_LABEL[padding]}.`,
      })
    } catch (cause) {
      setError(unexpectedError(cause, 'rsa.encrypt', 'Encryption failed'))
    } finally {
      setBusy(null)
    }
  }, [addProblem, canEncrypt, padding, plaintext, plaintextBytes, publicKey])

  const decrypt = useCallback(async () => {
    if (!canDecrypt) return
    setBusy('decrypt')
    setError(null)
    try {
      const result = await tryCall<{ plaintext: string }>('rsa.decrypt', {
        ciphertext,
        privateKeyPem: privateKey.pem,
        padding,
      })
      if (!result.ok) {
        const failure = toToolError(result.error, 'Decryption failed')
        setError(failure)
        addProblem({ severity: 'error', source: 'RSA', message: `Decrypt · ${failure.message}` })
        return
      }
      const at = Date.now()
      const recovered = result.data.plaintext
      const inBytes = base64ByteLength(ciphertext) ?? 0
      setDecrypted({
        plaintext: recovered,
        at,
        snapshot: [padding, ciphertext, privateKey.pem].join(' '),
        provenance: provenance(
          PADDING_LABEL[padding],
          keyBits(privateKey),
          `${inBytes} in / ${byteCount(utf8ByteLength(recovered), 'plaintext')}`,
          `decrypted ${clockTime(at)}`,
        ),
      })
      toast.success('Decrypted.')
      addProblem({
        severity: 'info',
        source: 'RSA',
        // Byte counts only: the recovered plaintext never enters the log.
        message: `Decrypted ${inBytes} bytes to ${utf8ByteLength(recovered)} bytes with ${PADDING_LABEL[padding]}.`,
      })
    } catch (cause) {
      setError(unexpectedError(cause, 'rsa.decrypt', 'Decryption failed'))
    } finally {
      setBusy(null)
    }
  }, [addProblem, canDecrypt, ciphertext, padding, privateKey])

  const useDecryptedAsPlaintext = useCallback(() => {
    if (!decrypted) return
    setPlaintext(decrypted.plaintext)
    toast.info('Decrypted plaintext moved into the plaintext box.')
  }, [decrypted])

  const clearSecrets = useCallback(() => {
    setDecrypted(null)
  }, [])

  const clear = useCallback(() => {
    setPlaintext('')
    setCiphertext('')
    setEncrypted(null)
    setDecrypted(null)
    setError(null)
  }, [])

  return {
    padding,
    setPadding,
    plaintext,
    setPlaintext,
    ciphertext,
    setCiphertext,
    plaintextBytes,
    capacity: maxPlaintextBytes(publicKey.info?.modulusBytes ?? null, padding),
    busy,
    showProgress,
    error,
    dismissError: () => setError(null),
    encrypted,
    ciphertextStale: encrypted !== null && encrypted.snapshot !== encryptSnapshot,
    decrypted,
    decryptedStale: decrypted !== null && decrypted.snapshot !== decryptSnapshot,
    problems,
    canEncrypt,
    canDecrypt,
    encrypt,
    decrypt,
    useDecryptedAsPlaintext,
    clear,
    clearSecrets,
    hasResult: encrypted !== null || decrypted !== null,
  }
}
