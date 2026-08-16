import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import { err } from "../util/errors";
import { nextRef } from "./refs";

const CRITICALITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["draft", "active", "deprecated"];

export async function listRequirements(projectId: string, filters: { status?: string; criticality?: string; q?: string } = {}) {
  const where = ["project_id = $1"];
  const params: unknown[] = [projectId];
  let i = 2;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.criticality) {
    where.push(`criticality = $${i++}`);
    params.push(filters.criticality);
  }
  if (filters.q) {
    where.push(`(ref ILIKE $${i} OR title ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const res = await query(
    `SELECT * FROM requirements WHERE ${where.join(" AND ")} ORDER BY ref ASC`,
    params,
  );
  return res.rows.map(toReq);
}

export async function createRequirement(input: {
  projectId: string;
  ref?: string;
  title: string;
  description?: string;
  criticality?: string;
  status?: string;
}) {
  if (input.criticality && !CRITICALITIES.includes(input.criticality)) throw err.validation("Invalid criticality");
  if (input.status && !STATUSES.includes(input.status)) throw err.validation("Invalid status");
  const id = randomUUID();
  const ref = input.ref || (await nextRef(input.projectId, "REQ"));
  const dup = await query("SELECT id FROM requirements WHERE project_id = $1 AND ref = $2", [input.projectId, ref]);
  if (dup.rows.length > 0) throw err.conflict("A requirement with this ref already exists");
  await query(
    `INSERT INTO requirements (id, project_id, ref, title, description, criticality, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, input.projectId, ref, input.title, input.description ?? null, input.criticality ?? "medium", input.status ?? "active"],
  );
  return getRequirement(input.projectId, id);
}

export async function getRequirement(projectId: string, id: string) {
  const res = await query("SELECT * FROM requirements WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (res.rows.length === 0) throw err.notFound("Requirement not found");
  return toReq(res.rows[0]);
}

export async function updateRequirement(input: {
  projectId: string;
  id: string;
  title?: string;
  description?: string;
  criticality?: string;
  status?: string;
}) {
  const existing = await query("SELECT id FROM requirements WHERE id = $1 AND project_id = $2", [input.id, input.projectId]);
  if (existing.rows.length === 0) throw err.notFound("Requirement not found");
  if (input.criticality && !CRITICALITIES.includes(input.criticality)) throw err.validation("Invalid criticality");
  if (input.status && !STATUSES.includes(input.status)) throw err.validation("Invalid status");

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.title !== undefined) { sets.push(`title = $${i++}`); params.push(input.title); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description); }
  if (input.criticality !== undefined) { sets.push(`criticality = $${i++}`); params.push(input.criticality); }
  if (input.status !== undefined) { sets.push(`status = $${i++}`); params.push(input.status); }
  if (sets.length) {
    params.push(input.id);
    await query(`UPDATE requirements SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }
  return getRequirement(input.projectId, input.id);
}

export async function deleteRequirement(projectId: string, id: string) {
  await query("DELETE FROM requirements WHERE id = $1 AND project_id = $2", [id, projectId]);
  return { ok: true };
}

function toReq(r: any) {
  return {
    id: r.id,
    ref: r.ref,
    title: r.title,
    description: r.description,
    criticality: r.criticality,
    status: r.status,
    createdAt: r.created_at,
  };
}
