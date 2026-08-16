import { pool } from '../db/pool.js'
import { hmacSha256Hex } from '../lib/crypto.js'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'

export type WebhookEvent =
  | 'attendance.absence_alert'
  | 'report_card.published'
  | 'invoice.issued'
  | 'payment.recorded'

export function signWebhook(secret: string, body: string): string {
  return `sha256=${hmacSha256Hex(secret, body)}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function deliverWithRetry(url: string, body: string, signature: string, attempts = 5): Promise<void> {
  let delay = 1000
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scholarion-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) return
    } catch {
      /* retry */
    }
    if (i < attempts - 1) await sleep(delay)
    delay *= 2
  }
  throw new Error('webhook delivery failed after retries')
}

/**
 * Fire-and-forget outbound webhook with HMAC signature (spec §8). Delivery
 * happens asynchronously; failures are logged, not surfaced to the caller.
 */
export function dispatchWebhook(event: WebhookEvent, schoolId: string, payload: unknown): void {
  pool
    .query(`SELECT id, url, secret FROM webhooks WHERE event = $1 AND school_id = $2 AND is_active = true`, [
      event,
      schoolId,
    ])
    .then(({ rows }) => {
      const body = JSON.stringify(payload)
      for (const wh of rows) {
        const secret = (wh.secret as string) || config.webhookSecret
        deliverWithRetry(wh.url as string, body, signWebhook(secret, body)).catch((e) =>
          logger.warn('webhook delivery failed', {
            webhookId: wh.id,
            event,
            error: (e as Error).message,
          }),
        )
      }
    })
    .catch((e) => logger.warn('webhook lookup failed', { event, error: (e as Error).message }))
}
