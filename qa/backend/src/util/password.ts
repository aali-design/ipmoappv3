import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
// format: scrypt$N$r$p$salt$hash (salt and hash base64url)
const N = 16384;
const r = 8;
const p = 1;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    _scrypt(password, salt, KEYLEN, { N, r, p }, (err, key) => {
      if (err) reject(err);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts[0] !== "scrypt" || parts.length !== 6) {
      // Legacy/plain fallback is intentionally unsupported.
      return false;
    }
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const actual = await derive(password, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
