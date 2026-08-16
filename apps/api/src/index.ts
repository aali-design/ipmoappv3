import { createApp } from './app'
import { openDb } from './db'

const db = openDb(process.env.IPMO_DB_PATH ?? ':memory:')

export default createApp(db)