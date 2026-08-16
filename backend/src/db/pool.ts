import pg from 'pg'
import { config } from '../config.js'

// Bigint (int8) columns carry money in minor units and counts; values in this
// domain are far below Number.MAX_SAFE_INTEGER, so we parse them to JS numbers
// to match the frontend contract (`*_minor: number`).
pg.types.setTypeParser(20, (v) => {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : v
})

// numeric (oid 1700) columns hold scores, weights, percentages and GPA. Parse
// to numbers; final rounding is applied by the shared half-up helper in code.
pg.types.setTypeParser(1700, (v) => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : v
})

// date (1082) -> 'YYYY-MM-DD' string; time (1083) -> 'HH:MM:SS' string.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1083, (v) => v)

// timestamp (1114) and timestamptz (1184) -> ISO-8601 strings for the client.
pg.types.setTypeParser(1114, (v) => new Date(v.replace(' ', 'T') + 'Z').toISOString())
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString())

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
})

export type DbClient = pg.Pool | pg.PoolClient

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
