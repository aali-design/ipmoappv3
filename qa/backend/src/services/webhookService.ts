import { createHmac, randomUUID } from "node:crypto";
import { query } from "../db/client";
import { config } from "../config";
import { err } from "../util/errors";
import { log } from "../util/logger";

const MAX_ATTEMPTS = 5;

export async function listWebhooks(organizationId: string) {
  const res = await query(
    "SELECT id, url, events, is_active, created_at FROM webhooks WHERE organization_id = $1 ORDER BY created_at DESC",
    [organizationId],
  );
  return res.rows.map((w) => ({
    id: w.id,
    url: w.url,
    events: w.events,
    isActive: w.is_active,
    createdAt: w.created_at,
  }));
}

export async function createWebhook(input: { organizationId: string; url: string; secret?: string; events: string[] }) {
  const id = randomUUID();
  await query(
    "INSERT INTO webhooks (id, organization_id, url, secret, events) VALUES ($1,$2,$3,$4,$5)",
    [id, input.organizationId, input.url, input.secret ?? null, input.events],
  );
  return { id, url: input.url, events: input.events };
}

export async function deleteWebhook(organizationId: string, webhookId: string) {
  const existing = await query("SELECT id FROM webhooks WHERE id = $1 AND organization_id = $2", [webhookId, organizationId]);
  if (existing.rows.length === 0) throw err.notFound("Webhook not found");
  await query("DELETE FROM webhooks WHERE id = $1", [webhookId]);
  return { ok: true };
}

function signature(secret: string | null | undefined, body: string): string {
  const key = secret || config.webhookSecret || "";
  if (!key) return "sha256=unsigned";
  return "sha256=" + createHmac("sha256", key).update(body).digest("hex");
}

async function deliver(webhook: any, event: string, payload: Record<string, unknown>): Promise<void> {
  const bodyObj = { event, ...payload, deliveredAt: new Date().toISOString() };
  const body = JSON.stringify(bodyObj);
  const deliveryId = randomUUID();

  const attemptOnce = async (attempt: number): Promise<void> => {
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-QA-Signature": signature(webhook.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10000),
      });
      status = res.status;
    } catch (e: any) {
      error = e?.message ?? "network error";
    }

    const success = status !== null && status >= 200 && status < 300;
    const nextRetry = success || attempt >= MAX_ATTEMPTS ? null : new Date(Date.now() + 1000 * 2 ** (attempt - 1)).toISOString();

    await query(
      `UPDATE webhook_deliveries SET attempt = $1, response_status = $2, delivered_at = COALESCE(delivered_at, $3), next_retry_at = $4 WHERE id = $5`,
      [attempt, status, success ? new Date().toISOString() : null, nextRetry, deliveryId],
    );

    if (!success && attempt < MAX_ATTEMPTS) {
      setTimeout(() => {
        void attemptOnce(attempt + 1).catch(() => {});
      }, 1000 * 2 ** (attempt - 1));
    } else if (!success) {
      log.warn("webhook delivery failed after retries", { webhookId: webhook.id, event, status, error });
    }
  };

  await query(
    "INSERT INTO webhook_deliveries (id, webhook_id, event, payload_json, attempt) VALUES ($1,$2,$3,$4::jsonb,1)",
    [deliveryId, webhook.id, event, JSON.stringify(payload)],
  );
  void attemptOnce(1);
}

export async function dispatchWebhook(event: string, payload: Record<string, unknown>, organizationId: string): Promise<void> {
  const res = await query(
    "SELECT id, url, secret, events FROM webhooks WHERE organization_id = $1 AND is_active = true AND $2 = ANY(events)",
    [organizationId, event],
  );
  for (const w of res.rows) {
    void deliver(w, event, payload).catch((e) => log.warn("webhook dispatch error", { webhookId: w.id, event, err: e?.message }));
  }
}
