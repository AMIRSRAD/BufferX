import { describe, expect, it } from 'vitest'
import {
  base64ByteLength,
  decodeBase64,
  describeKey,
  findPemBlocks,
  inspectPem,
  maxPlaintextBytes,
} from '../pem'

/** Wraps DER in a PEM envelope the way OpenSSL does, at 64 columns. */
function toPem(label: string, der: ArrayBuffer): string {
  const bytes = new Uint8Array(der)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const body = btoa(binary).replace(/(.{64})/g, '$1\n')
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

async function generatePair(modulusLength: number) {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  return {
    privatePem: toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicPem: toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', pair.publicKey)),
  }
}

describe('inspectPem', () => {
  it('recovers kind and modulus size from a PKCS#8 private key', async () => {
    const { privatePem } = await generatePair(2048)
    const info = inspectPem(privatePem)
    expect(info).not.toBeNull()
    expect(info?.kind).toBe('private')
    expect(info?.modulusBits).toBe(2048)
    expect(info?.modulusBytes).toBe(256)
    expect(describeKey(info!)).toBe('RSA private key · 2048 bit')
  }, 20_000)

  it('recovers kind and modulus size from an SPKI public key', async () => {
    const { publicPem } = await generatePair(1024)
    const info = inspectPem(publicPem)
    expect(info?.kind).toBe('public')
    expect(info?.modulusBits).toBe(1024)
  }, 20_000)

  it('classifies encrypted private keys and certificates', () => {
    expect(inspectPem('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----')?.kind).toBe(
      'encrypted-private',
    )
    expect(inspectPem('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')?.kind).toBe(
      'certificate',
    )
  })

  it('returns null when there is no PEM block', () => {
    expect(inspectPem('not a key')).toBeNull()
    expect(findPemBlocks('-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toHaveLength(0)
  })
})

describe('base64', () => {
  it('tolerates whitespace, url-safe alphabets and missing padding', () => {
    expect(decodeBase64('QUJD')).toEqual(new Uint8Array([65, 66, 67]))
    expect(decodeBase64('QU JD\n')).toEqual(new Uint8Array([65, 66, 67]))
    expect(decodeBase64('QUJDRA')).toEqual(new Uint8Array([65, 66, 67, 68]))
    expect(decodeBase64('a-_w')).not.toBeNull()
  })

  it('rejects non-Base64 text', () => {
    expect(decodeBase64('not base64!')).toBeNull()
    expect(decodeBase64('QUJ==D')).toBeNull()
    expect(decodeBase64('')).toBeNull()
    expect(base64ByteLength('zz zz')).toBe(3)
  })
})

describe('maxPlaintextBytes', () => {
  it('matches the padding overheads for a 2048-bit key', () => {
    expect(maxPlaintextBytes(256, 'oaepsha256')).toBe(190)
    expect(maxPlaintextBytes(256, 'oaepsha1')).toBe(214)
    expect(maxPlaintextBytes(256, 'pkcs1v15')).toBe(245)
  })

  it('is unknown when the key size is unknown, and never negative', () => {
    expect(maxPlaintextBytes(null, 'oaepsha256')).toBeNull()
    expect(maxPlaintextBytes(64, 'oaepsha256')).toBe(0)
  })
})
