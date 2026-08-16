import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import type { Queryable } from "../db/types";

export async function recordAudit(
  input: {
    organizationId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string;
  },
  tx?: Queryable,
): Promise<void> {
  const q: Queryable = tx ?? { query };
  await q.query(
    `INSERT INTO audit_log (id, organization_id, actor_id, action, entity_type, entity_id, metadata_json, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      randomUUID(),
      input.organizationId,
      input.actorId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.ip ?? null,
    ],
  );
}
