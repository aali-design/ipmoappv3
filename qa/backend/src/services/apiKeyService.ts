import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import { generateApiKey } from "../util/apiKey";
import { err } from "../util/errors";

export async function listApiKeys(organizationId: string) {
  const res = await query(
    `SELECT k.id, k.name, k.key_prefix, k.scopes, k.expires_at, k.revoked_at, k.project_id, k.created_at
     FROM api_keys k WHERE k.organization_id = $1 ORDER BY k.created_at DESC`,
    [organizationId],
  );
  return res.rows.map((k) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    scopes: k.scopes,
    expiresAt: k.expires_at,
    revokedAt: k.revoked_at,
    projectId: k.project_id,
    createdAt: k.created_at,
  }));
}

export async function createApiKey(input: {
  organizationId: string;
  projectId?: string | null;
  name: string;
  scopes?: string[];
  expiresAt?: string | null;
  actorId: string;
}) {
  const generated = generateApiKey();
  const id = randomUUID();
  await query(
    `INSERT INTO api_keys (id, organization_id, project_id, name, key_prefix, key_hash, scopes, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.organizationId,
      input.projectId ?? null,
      input.name,
      generated.prefix,
      generated.hash,
      input.scopes ?? ["ingest"],
      input.expiresAt ?? null,
      input.actorId,
    ],
  );
  // The plaintext key is returned exactly once.
  return {
    id,
    name: input.name,
    key: generated.key,
    keyPrefix: generated.prefix,
    scopes: input.scopes ?? ["ingest"],
    expiresAt: input.expiresAt ?? null,
  };
}

export async function revokeApiKey(organizationId: string, keyId: string) {
  const existing = await query(
    "SELECT id FROM api_keys WHERE id = $1 AND organization_id = $2",
    [keyId, organizationId],
  );
  if (existing.rows.length === 0) throw err.notFound("API key not found");
  await query("UPDATE api_keys SET revoked_at = now() WHERE id = $1", [keyId]);
  return { id: keyId, revoked: true };
}
