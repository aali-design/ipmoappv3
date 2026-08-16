import { openDb, type Db } from './db'
import { createApp } from './app'

export interface TestApp {
  db: Db
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export function makeTestApp(): TestApp {
  const db = openDb(':memory:')
  const app = createApp(db)
  const request = app.request.bind(app) as (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  return { db, fetch: request }
}

export async function signup(fetchFn: typeof fetch, email: string, password = 'password123'): Promise<string> {
  const res = await fetchFn('/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 201) throw new Error(`signup failed: ${res.status}`)
  const setCookie = res.headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0] ?? ''
}

export function authCookie(fetchFn: typeof fetch, email: string, password = 'password123'): Promise<string> {
  return fetchFn('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((res) => {
    if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
    return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  })
}