/**
 * The Sign / Verify sub-tab (UX_SPEC 3.4).
 *
 * Control order follows the spec exactly: `Digest` · `Payload` ·
 * `Signature (Base64)`, then the results, then the sticky `Sign` / `Verify`
 * pair. The signature box is both the output of `Sign` and the input of
 * `Verify`, which is safe now that the ciphertext lives in its own sub-tab.
 */

import { FileSignature, PenLine, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CopyButton } from '@/components/ui/CopyButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { base64ByteLength, DIGEST_LABEL, type RsaDigest } from './pem'
import { ActionBar, ErrorStrip, ResultBlock, Section, VerdictChip } from './parts'
import type { SignVerifyModel } from './useSignVerify'

const DIGEST_OPTIONS = [
  { value: 'sha256', label: DIGEST_LABEL.sha256, hint: 'default' },
  { value: 'sha1', label: DIGEST_LABEL.sha1, hint: 'legacy hosts' },
  { value: 'sha512', label: DIGEST_LABEL.sha512 },
]

function asDigest(value: string): RsaDigest {
  return value === 'sha1' || value === 'sha512' ? value : 'sha256'
}

export function RsaSignVerify({ model }: { model: SignVerifyModel }) {
  const signatureBytes = base64ByteLength(model.signature)
  const nothingYet = model.signed === null && model.verdict === null

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-group p-panel">
        <Section title="Signature">
          <Field label="Digest" hint="Hash the payload is reduced to before the RSA operation.">
            <Select
              value={model.digest}
              onValueChange={(value) => model.setDigest(asDigest(value))}
              options={DIGEST_OPTIONS}
              aria-label="Digest"
            />
          </Field>

          <Field
            label="Payload"
            hint={`${model.payloadBytes.toLocaleString()} bytes, UTF-8`}
            error={model.problems.payload}
          >
            <Textarea
              value={model.payload}
              onValueChange={model.setPayload}
              mono
              rows={4}
              autoResize
              spellCheck={false}
              invalid={model.problems.payload !== null}
              placeholder="Data to sign, or the data a received signature covers"
            />
          </Field>

          <div className="flex flex-col gap-1">
            <div className="flex min-h-6 items-center justify-between gap-2">
              <span className="text-xs text-text-secondary" id="rsa-signature-label">
                Signature (Base64)
                {signatureBytes === null ? null : (
                  <span className="text-text-tertiary"> · {signatureBytes} bytes</span>
                )}
              </span>
              {model.signature === '' ? null : (
                <CopyButton value={model.signature} label="Copy signature" size="xs" />
              )}
            </div>
            <Textarea
              value={model.signature}
              onValueChange={model.setSignature}
              mono
              rows={3}
              spellCheck={false}
              invalid={model.signature !== '' && model.problems.signature !== null}
              className="break-all"
              placeholder="Base64 signature — produced by Sign, or pasted here to Verify"
              aria-labelledby="rsa-signature-label"
              aria-describedby="rsa-signature-error"
            />
            <p id="rsa-signature-error" className="text-xs text-error empty:hidden">
              {model.signature !== '' && model.problems.signature !== null
                ? model.problems.signature
                : ''}
            </p>
          </div>
        </Section>

        <Section title="Result">
          {nothingYet ? (
            <EmptyState
              icon={FileSignature}
              title="Nothing signed or verified yet."
              description="Sign the payload with the private key, or paste a signature and verify it against the public key."
            />
          ) : null}

          {model.signed ? (
            <ResultBlock
              title="Signature"
              stale={model.signatureStale}
              provenance={model.signed.provenance}
              copyValue={model.signature}
              copyLabel="Copy signature"
            >
              <p className="text-sm text-text-secondary">
                {signatureBytes === null
                  ? 'Written to the signature box above.'
                  : `${signatureBytes} bytes of Base64, written to the signature box above.`}
              </p>
            </ResultBlock>
          ) : null}

          {model.verdict ? (
            <ResultBlock
              title="Verification"
              provenance={model.verdict.provenance}
              copyValue={`${model.verdict.valid ? 'MATCH' : 'MISMATCH'} · ${model.verdict.provenance}`}
              copyLabel="Copy verdict"
            >
              <div className="flex flex-wrap items-center gap-2">
                <VerdictChip valid={model.verdict.valid} />
                <span className="text-sm text-text-secondary">
                  {model.verdict.valid
                    ? 'The signature matches this payload under the public key.'
                    : 'Signature did not match. The payload, the digest, or the key differs from the signer.'}
                </span>
              </div>
            </ResultBlock>
          ) : null}
        </Section>

        {model.error ? <ErrorStrip error={model.error} onDismiss={model.dismissError} /> : null}

        {!model.canSign && model.problems.privateKey ? (
          <p className="text-xs text-text-tertiary">{model.problems.privateKey}</p>
        ) : null}
        {!model.canVerify && model.problems.publicKey ? (
          <p className="text-xs text-text-tertiary">{model.problems.publicKey}</p>
        ) : null}
      </div>

      <ActionBar>
        <Button
          variant="primary"
          icon={PenLine}
          loading={model.busy === 'sign'}
          disabled={!model.canSign}
          title={model.canSign ? 'Ctrl+Enter' : (model.problems.privateKey ?? model.problems.payload ?? undefined)}
          onClick={() => void model.sign()}
        >
          Sign
        </Button>
        <Button
          icon={ShieldCheck}
          loading={model.busy === 'verify'}
          disabled={!model.canVerify}
          title={
            model.canVerify
              ? 'Ctrl+Shift+Enter'
              : (model.problems.publicKey ?? model.problems.signature ?? model.problems.payload ?? undefined)
          }
          onClick={() => void model.verify()}
        >
          Verify
        </Button>
        <Button variant="ghost" className="ml-auto" onClick={model.clear}>
          Clear
        </Button>
      </ActionBar>
    </div>
  )
}
