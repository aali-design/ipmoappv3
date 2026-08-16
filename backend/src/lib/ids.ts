import type { DbClient } from '../db/pool.js'

/**
 * Per-school sequential counters (invoice numbers, receipt numbers). A row is
 * locked with SELECT ... FOR UPDATE inside the caller's transaction so that
 * concurrent payments mint distinct, gapless numbers (spec §7). Never SELECT
 * max()+1.
 */
export async function nextCounter(
  db: DbClient,
  schoolId: string,
  name: string,
  initial = 0n,
): Promise<bigint> {
  const ensure = await db.query(
    `INSERT INTO counters (school_id, name, value) VALUES ($1, $2, $3)
     ON CONFLICT (school_id, name) DO NOTHING`,
    [schoolId, name, initial.toString()],
  )
  void ensure
  const result = await db.query<{ value: string }>(
    `UPDATE counters SET value = value + 1 WHERE school_id = $1 AND name = $2 RETURNING value`,
    [schoolId, name],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`counter not found: ${name}`)
  return BigInt(row.value)
}
