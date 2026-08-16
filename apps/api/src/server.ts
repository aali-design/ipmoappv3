import { serve } from '@hono/node-server'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createApp } from './app'
import { openDb } from './db'

const PORT = Number(process.env.PORT ?? 3000)
const DB_PATH = process.env.IPMO_DB_PATH ?? './data/ipmo.sqlite'

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = openDb(DB_PATH)
const app = createApp(db)

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`ipmo-api listening on http://localhost:${info.port}`)
})