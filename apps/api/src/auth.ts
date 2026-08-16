import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from './db'

const SCRYPT_KEYLEN = 64
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const SESSION_COOKIE = 'ipmo_session'

export interface SessionUser {
  id: number
  email: string
}

export interface AppError extends Error {
  status: number
  code: string
}

export function appError(status: number, code: string, message: string): AppError {
  const err = new Error(message) as AppError
  err.status = status
  err.code = code
  return err
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN)
  return `scrypt$${salt}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hashHex] = parts
  const derived = scryptSync(password, salt ?? '', SCRYPT_KEYLEN)
  const expected = Buffer.from(hashHex ?? '', 'hex')
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

interface UserRow {
  id: number
  email: string
  password_hash: string
}

export function findUserByEmail(db: Db, email: string): UserRow | undefined {
  return db.raw.prepare('SELECT id, email, password_hash FROM users WHERE email = ?').get(email) as
    | UserRow
    | undefined
}

export function findUserById(db: Db, id: number): { id: number; email: string } | undefined {
  return db.raw.prepare('SELECT id, email FROM users WHERE id = ?').get(id) as
    | { id: number; email: string }
    | undefined
}

export function createUser(db: Db, email: string, passwordHash: string): number {
  const result = db.raw.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash)
  return Number(result.lastInsertRowid)
}

export function createSession(db: Db, userId: number): string {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.raw.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt)
  return token
}

export function deleteSession(db: Db, token: string): void {
  db.raw.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function resolveSession(db: Db, token: string): SessionUser | undefined {
  const row = db.raw
    .prepare(
      `SELECT s.token, u.id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as { token: string; id: number; email: string } | undefined
  if (!row) return undefined
  return { id: row.id, email: row.email }
}