import { config } from './config.js'
import { logger } from './lib/logger.js'
import { runMigrations } from './db/migrate.js'
import { seedIfEmpty } from './db/seed.js'
import { pool } from './db/pool.js'
import { createApp } from './app.js'

async function main(): Promise<void> {
  await runMigrations()
  await seedIfEmpty()

  const app = createApp()
  const server = app.listen(config.port, () => {
    logger.info('server listening', { port: config.port, env: config.env })
  })

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('shutting down', { signal })
    server.close(() => {
      pool
        .end()
        .catch(() => undefined)
        .finally(() => process.exit(0))
    })
    // Safety net if connections refuse to drain.
    setTimeout(() => process.exit(1), 10_000).unref()
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  const e = err as Error
  logger.error('fatal startup error', { message: e?.message, stack: e?.stack })
  process.exit(1)
})
