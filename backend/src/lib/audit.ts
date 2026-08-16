import type { DbClient } from '../db/pool.js'

/**
 * Append an audit-log row. The audit_log table is append-only: there is no
 * UPDATE or DELETE path anywhere in the code (spec §2, §8).
 */
export async function writeAudit(
  db: DbClient,
  entry: {
    schoolId: string
    actorId?: string | null
    action: string
    entityType?: string | null
    entityId?: string | null
    metadata?: Record<string, unknown> | null
    ip?: string | null
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (school_id, actor_id, action, entity_type, entity_id, metadata_json, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.schoolId,
      entry.actorId ?? null,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ip ?? null,
    ],
  )
}
