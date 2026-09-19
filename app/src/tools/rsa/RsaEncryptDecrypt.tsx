/**
 * The Encrypt / Decrypt sub-tab (UX_SPEC 3.4).
 *
 * `Padding` · `Plaintext` · `Ciphertext (Base64)`, then results, then the
 * `Encrypt` / `Decrypt` pair. Decryption lands in its own result block with an
 * explicit `↑ use as plaintext` action — it never overwrites the plaintext the
 * operator is still working from.
 */

import { ArrowUp, Lock, LockOpen, ShieldQuestion } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { base64ByteLength, PADDING_LABEL, type RsaPadding } from './pem'
import { ActionBar, ErrorStrip, ResultBlock, Section } from './parts'
import type { EncryptDecryptModel } from './useEncryptDecrypt'

const PADDING_OPTIONS = [
  { value: 'oaepsha256', label: PADDING_LABEL.oaepsha256, hint: 'default · modulus − 66 bytes' },
  { value: 'oaepsha1', label: PADDING_LABEL.oaepsha1, hint: 'modulus − 42 bytes' },
  { value: 'pkcs1v15', label: PADDING_LABEL.pkcs1v15, hint: 'legacy · modulus − 11 bytes' },
]

function asPadding(value: string): RsaPadding {
  return value === 'oaepsha1' || value === 'pkcs1v15' ? value : 'oaepsha256'
}

export function RsaEncryptDecrypt({ model }: { model: EncryptDecryptModel }) {
  const ciphertextBytes = base64ByteLength(model.ciphertext)
  const nothingYet = model.encrypted === null && model.decrypted === null

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-group p-panel">
        <Section title="Cipher">
          <Field
            label="Padding"
            hint={
              model.capacity === null
                ? 'Load a public key to see how much plaintext fits.'
                : `Carries at most ${model.capacity} bytes under the loaded public key.`
            }
          >
            <Select
              value={model.padding}
              onValueChange={(value) => model.setPadding(asPadding(value))}
              options={PADDING_OPTIONS}
              aria-label="Padding"
            />
          </Field>

          <Field
            label="Plaintext"
            hint={`${model.plaintextBytes.toLocaleString()} bytes, UTF-8`}
            error={model.plaintext === '' ? null : model.problems.plaintext}
          >
            <Textarea
              value={model.plaintext}
              onValueChange={model.setPlaintext}
              mono
              rows={4}
              autoResize
              spellCheck={false}
              invalid={model.plaintext !== '' && model.problems.plaintext !== null}
              placeholder="Data to encrypt with the public key"
            />
          </Field>

          <div className="flex flex-col gap-1">
            <div className="flex min-h-6 items-center justify-between gap-2">
              <span className="text-xs text-text-secondary" id="rsa-ciphertext-label">
                Ciphertext (Base64)
                {ciphertextBytes === null ? null : (
                  <span className="text-text-tertiary"> · {ciphertextBytes} bytes</span>
                )}
              </span>
              {model.ciphertext === '' ? null : (
                <CopyButton value={model.ciphertext} label="Copy ciphertext" size="xs" />
              )}
            </div>
            <Textarea
              value={model.ciphertext}
              onValueChange={model.setCiphertext}
              mono
              rows={3}
              spellCheck={false}
              invalid={model.ciphertext !== '' && model.problems.ciphertext !== null}
              className="break-all"
              placeholder="Base64 ciphertext — produced by Encrypt, or pasted here to Decrypt"
              aria-labelledby="rsa-ciphertext-label"
              aria-describedby="rsa-ciphertext-error"
            />
            <p id="rsa-ciphertext-error" className="text-xs text-error empty:hidden">
              {model.ciphertext !== '' && model.problems.ciphertext !== null
                ? model.problems.ciphertext
                : ''}
            </p>
          </div>
        </Section>

        <Section title="Result">
          {nothingYet ? (
            <EmptyState
              icon={ShieldQuestion}
              title="Nothing encrypted or decrypted yet."
              description="Encrypt the plaintext with the public key, or paste a ciphertext and decrypt it with the private key."
            />
          ) : null}

          {model.encrypted ? (
            <ResultBlock
              title="Ciphertext"
              stale={model.ciphertextStale}
              provenance={model.encrypted.provenance}
              copyValue={model.ciphertext}
              copyLabel="Copy ciphertext"
            >
              <p className="text-sm text-text-secondary">
                {ciphertextBytes === null
                  ? 'Written to the ciphertext box above.'
                  : `${ciphertextBytes} bytes of Base64, written to the ciphertext box above.`}
              </p>
            </ResultBlock>
          ) : null}

          {model.decrypted ? (
            <ResultBlock
              title="Decrypted plaintext"
              stale={model.decryptedStale}
              provenance={model.decrypted.provenance}
              copyValue={model.decrypted.plaintext}
              copyLabel="Copy decrypted plaintext"
              actions={
                <Button
                  size="xs"
                  variant="ghost"
                  icon={ArrowUp}
                  onClick={model.useDecryptedAsPlaintext}
                >
                  Use as plaintext
                </Button>
              }
            >
              <pre className="max-h-48 overflow-auto rounded-xs bg-surface-2 p-2 font-mono text-mono-xs break-all whitespace-pre-wrap text-text">
                {model.decrypted.plaintext}
              </pre>
              <p className="text-2xs text-text-tertiary">
                Held in memory only. It is not saved, and the Problems log records its size only.
              </p>
            </ResultBlock>
          ) : null}
        </Section>

        {model.error ? <ErrorStrip error={model.error} onDismiss={model.dismissError} /> : null}

        {!model.canEncrypt && model.problems.publicKey ? (
          <p className="text-xs text-text-tertiary">{model.problems.publicKey}</p>
        ) : null}
        {!model.canDecrypt && model.problems.privateKey ? (
          <p className="text-xs text-text-tertiary">{model.problems.privateKey}</p>
        ) : null}
      </div>

      <ActionBar>
        <Button
          variant="primary"
          icon={Lock}
          loading={model.busy === 'encrypt'}
          disabled={!model.canEncrypt}
          title={
            model.canEncrypt
              ? 'Ctrl+Enter'
              : (model.problems.publicKey ?? model.problems.plaintext ?? undefined)
          }
          onClick={() => void model.encrypt()}
        >
          Encrypt
        </Button>
        <Button
          icon={LockOpen}
          loading={model.busy === 'decrypt'}
          disabled={!model.canDecrypt}
          title={
            model.canDecrypt
              ? 'Ctrl+Shift+Enter'
              : (model.problems.privateKey ?? model.problems.ciphertext ?? undefined)
          }
          onClick={() => void model.decrypt()}
        >
          Decrypt
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={model.clear}>
          Clear
        </Button>
      </ActionBar>
    </div>
  )
}
