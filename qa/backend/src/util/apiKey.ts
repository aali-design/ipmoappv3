import { createHash, randomBytes } from "node:crypto";

export interface GeneratedApiKey {
  key: string; // full plaintext (shown once)
  prefix: string; // first 12 chars for display
  hash: string; // sha256 hex stored in api_keys.key_hash
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = `qa_${randomBytes(4).toString("hex")}`; // 11 chars
  const secret = randomBytes(24).toString("base64url");
  const key = `${prefix}_${secret}`;
  return {
    key,
    prefix: key.slice(0, 12),
    hash: hashApiKey(key),
  };
}
