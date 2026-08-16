import { describe, expect, it } from 'vitest'
import { authCookie, makeTestApp } from './test-utils'

describe('auth flow', () => {
  const { fetch, db } = makeTestApp()

  it('health check responds ok', async () => {
    const res = await fetch('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, service: 'ipmo-api' })
  })

  it('rejects signup with invalid body', async () => {
    const res = await fetch('/api/auth/signup', { method: 'POST', body: JSON.stringify({}) })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_body')
  })

  it('rejects signup with weak password', async () => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.com', password: 'short' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('weak_password')
  })

  it('signs up a user, sets a session cookie, and /me works', async () => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@ipmo.app', password: 'password123' }),
    })
    expect(res.status).toBe(201)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^ipmo_session=/)

    const cookie = setCookie.split(';')[0] ?? ''
    const me = await fetch('/api/auth/me', { headers: { cookie } })
    expect(me.status).toBe(200)
    expect((await me.json()).user.email).toBe('alice@ipmo.app')
  })

  it('rejects duplicate signup', async () => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@ipmo.app', password: 'password123' }),
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('email_taken')
  })

  it('logs in with correct credentials', async () => {
    const cookie = await authCookie(fetch, 'alice@ipmo.app')
    expect(cookie).toMatch(/^ipmo_session=/)
    const me = await fetch('/api/auth/me', { headers: { cookie } })
    expect((await me.json()).user.email).toBe('alice@ipmo.app')
  })

  it('rejects login with wrong password', async () => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'alice@ipmo.app', password: 'wrongpassword' }),
    })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('invalid_credentials')
  })

  it('requires auth for /me', async () => {
    const res = await fetch('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('logout invalidates the session', async () => {
    const cookie = await authCookie(fetch, 'alice@ipmo.app')
    const logout = await fetch('/api/auth/logout', { method: 'POST', headers: { cookie } })
    expect(logout.status).toBe(200)
    const me = await fetch('/api/auth/me', { headers: { cookie } })
    expect(me.status).toBe(401)
  })

  it('stores passwords hashed, never plaintext', () => {
    const row = db.raw.prepare('SELECT password_hash FROM users WHERE email = ?').get('alice@ipmo.app') as
      | { password_hash: string }
      | undefined
    expect(row?.password_hash).toBeDefined()
    expect(row?.password_hash).not.toContain('password123')
    expect(row?.password_hash).toMatch(/^scrypt\$/)
  })
})