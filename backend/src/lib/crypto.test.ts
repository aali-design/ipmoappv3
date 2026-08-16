import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  hashPassword,
  hmacSha256Hex,
  sha256Hex,
  verifyPassword,
} from './crypto.js'

describe('crypto — password hashing (scrypt)', () => {
  it('verifies a correct password', () => {
    const hash = hashPassword('s3cret-password')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('s3cret-password', hash)).toBe(true)
  })

  it('rejects a wrong password', () => {
    const hash = hashPassword('correct-horse')
    expect(verifyPassword('wrong-horse', hash)).toBe(false)
  })

  it('rejects a tampered hash', () => {
    expect(verifyPassword('anything', 'not-a-scrypt-hash')).toBe(false)
  })
})

describe('crypto — sha256 and hmac', () => {
  it('produces deterministic 64-char sha256 hex', () => {
    const a = sha256Hex('hello')
    const b = sha256Hex('hello')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(a).not.toBe(sha256Hex('hello!'))
  })

  it('produces deterministic HMAC hex', () => {
    expect(hmacSha256Hex('secret', 'body')).toBe(hmacSha256Hex('secret', 'body'))
    expect(hmacSha256Hex('secret', 'body')).not.toBe(hmacSha256Hex('other', 'body'))
  })
})

describe('crypto — canonicalJson', () => {
  it('sorts keys deterministically', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }))
  })
})
