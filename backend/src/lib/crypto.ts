import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto'

const SCRYPT_KEYLEN = 64

/**
 * Password hashing via Node's built-in scrypt (spec §8: a KDF that survives
 * container copies). Format: scrypt$N$r$p$saltB64$hashB64.
 */
export function hashPassword(password: string): string {
  const N = 16384
  const r = 8
  const p = 1
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, { N, r, p })
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts
  const N = Number.parseInt(nStr, 10)
  const r = Number.parseInt(rStr, 10)
  const p = Number.parseInt(pStr, 10)
  const salt = Buffer.from(saltB64, 'base64')
  const expected = Buffer.from(hashB64, 'base64')
  const derived = scryptSync(password, salt, expected.length, { N, r, p })
  return timingSafeEqual(derived, expected)
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function hmacSha256Hex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
  return `{${parts.join(',')}}`
}

export function newUuid(): string {
  return randomUUID()
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}
