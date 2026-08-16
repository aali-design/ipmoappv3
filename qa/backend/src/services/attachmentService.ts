import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { query } from "../db/client";
import { config } from "../config";
import { err } from "../util/errors";

function ensureDir(): string {
  const dir = config.storageDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// Sanitize the original filename to a bare basename (path-traversal-safe).
export function sanitizeFilename(name: string): string {
  const base = (name ?? "attachment").replace(/\\/g, "/").split("/").pop() ?? "attachment";
  return base.replace(/[^\w.\- ]/g, "_").slice(0, 255) || "attachment";
}

export async function saveAttachment(input: {
  organizationId: string;
  entityType: string;
  entityId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  buffer: Buffer;
  actorId?: string | null;
}) {
  if (input.sizeBytes > config.maxAttachmentBytes) throw err.payloadTooLarge("Attachment exceeds 10 MB");

  const storagePath = randomUUID();
  const dir = ensureDir();
  writeFileSync(join(dir, storagePath), input.buffer);

  const id = randomUUID();
  await query(
    `INSERT INTO attachments (id, organization_id, entity_type, entity_id, filename, content_type, size_bytes, storage_path, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.organizationId,
      input.entityType,
      input.entityId,
      sanitizeFilename(input.filename),
      input.contentType,
      input.sizeBytes,
      storagePath,
      input.actorId ?? null,
    ],
  );

  return { id, filename: sanitizeFilename(input.filename), sizeBytes: input.sizeBytes };
}

export async function getAttachment(organizationId: string, attachmentId: string) {
  const res = await query(
    "SELECT * FROM attachments WHERE id = $1 AND organization_id = $2",
    [attachmentId, organizationId],
  );
  if (res.rows.length === 0) throw err.notFound("Attachment not found");
  const a = res.rows[0];
  const filePath = join(config.storageDir, a.storage_path);
  return {
    id: a.id,
    entityType: a.entity_type,
    entityId: a.entity_id,
    filename: a.filename,
    contentType: a.content_type,
    sizeBytes: Number(a.size_bytes),
    filePath,
  };
}

export async function listAttachments(organizationId: string, entityType: string, entityId: string) {
  const res = await query(
    "SELECT id, entity_type, entity_id, filename, content_type, size_bytes, created_at FROM attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY created_at DESC",
    [organizationId, entityType, entityId],
  );
  return res.rows.map((a) => ({
    id: a.id,
    filename: a.filename,
    contentType: a.content_type,
    sizeBytes: Number(a.size_bytes),
    createdAt: a.created_at,
  }));
}
