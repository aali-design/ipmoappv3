import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'
import { pool } from './pool.js'
import { logger } from '../lib/logger.js'

/**
 * Applies db/schema.sql (idempotent) then db/migrations/*.sql in filename
 * order, tracking applied migrations in schema_migrations. Runs before the
 * server serves traffic (spec §2, §10).
 */
export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const schemaPath = path.join(config.dbDir, 'schema.sql')
  if (fs.existsSync(schemaPath)) {
    logger.info('applying schema.sql')
    await pool.query(fs.readFileSync(schemaPath, 'utf8'))
  } else {
    logger.warn('schema.sql not found', { path: schemaPath })
  }

  const migrationsDir = path.join(config.dbDir, 'migrations')
  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    : []

  for (const file of files) {
    const seen = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file])
    if (seen.rowCount) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file])
      await client.query('COMMIT')
      logger.info('applied migration', { file })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
