import { describe, expect, it } from 'vitest'
import { signWebhook } from './webhooks.js'
import { hmacSha256Hex } from '../lib/crypto.js'

describe('webhooks — signature', () => {
  it('produces an X-Scholarion-Signature header value', () => {
    const signature = signWebhook('wh-secret', '{"event":"payment.recorded"}')
    expect(signature).toBe(`sha256=${hmacSha256Hex('wh-secret', '{"event":"payment.recorded"}')}`)
    expect(signature.startsWith('sha256=')).toBe(true)
  })
})
