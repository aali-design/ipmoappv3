import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { openDb } from './db'

const PORT = Number(process.env.PORT ?? 3000)
const DB_PATH = process.env.IPMO_DB_PATH ?? './data/ipmo.sqlite'
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WEB_DIST = resolve(process.env.IPMO_WEB_DIST ?? `${REPO_ROOT}/apps/web/dist`)

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = openDb(DB_PATH)
const app = createApp(db)

if (existsSync(WEB_DIST)) {
  app.get('*', serveStatic({ root: WEB_DIST, index: 'index.html' }))
  console.log(`ipmo-api serving web app from ${WEB_DIST}`)
} else {
  console.log(`ipmo-api running API only (no web build found at ${WEB_DIST})`)
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`ipmo-api listening on http://localhost:${info.port}`)
})