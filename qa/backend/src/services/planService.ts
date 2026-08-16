import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import { err } from "../util/errors";

export async function listPlans(projectId: string) {
  const res = await query(
    `SELECT p.id, p.name, p.description, p.status, p.release_id, p.created_by, p.created_at,
            (SELECT COUNT(*) FROM test_runs r WHERE r.plan_id = p.id)::int AS run_count
     FROM test_plans p WHERE p.project_id = $1 ORDER BY p.created_at DESC`,
    [projectId],
  );
  return res.rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    releaseId: p.release_id,
    createdBy: p.created_by,
    runCount: Number(p.run_count),
    createdAt: p.created_at,
  }));
}

export async function createPlan(input: { projectId: string; name: string; description?: string; releaseId?: string | null; createdBy?: string | null }) {
  const id = randomUUID();
  await query(
    "INSERT INTO test_plans (id, project_id, name, description, release_id, created_by) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, input.projectId, input.name, input.description ?? null, input.releaseId ?? null, input.createdBy ?? null],
  );
  return { id, name: input.name, status: "draft" };
}

export async function updatePlan(input: { projectId: string; planId: string; name?: string; description?: string; status?: string; releaseId?: string | null }) {
  const existing = await query("SELECT id FROM test_plans WHERE id = $1 AND project_id = $2", [input.planId, input.projectId]);
  if (existing.rows.length === 0) throw err.notFound("Plan not found");
  if (input.status && !["draft", "active", "closed"].includes(input.status)) throw err.validation("Invalid status");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); params.push(input.name); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description); }
  if (input.status !== undefined) { sets.push(`status = $${i++}`); params.push(input.status); }
  if (input.releaseId !== undefined) { sets.push(`release_id = $${i++}`); params.push(input.releaseId); }
  if (sets.length) {
    params.push(input.planId);
    await query(`UPDATE test_plans SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }
  return { id: input.planId };
}
