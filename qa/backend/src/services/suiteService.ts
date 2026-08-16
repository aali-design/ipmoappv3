import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { err } from "../util/errors";

export async function listSuites(projectId: string) {
  const res = await query(
    `SELECT s.id, s.name, s.description, s.filter_json, s.created_at,
            (SELECT COUNT(*) FROM suite_cases sc WHERE sc.suite_id = s.id)::int AS case_count
     FROM test_suites s WHERE s.project_id = $1 ORDER BY s.created_at ASC`,
    [projectId],
  );
  return res.rows.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    filter: s.filter_json,
    caseCount: Number(s.case_count),
    createdAt: s.created_at,
  }));
}

export async function createSuite(input: { projectId: string; name: string; description?: string; filter?: Record<string, unknown> | null }) {
  const id = randomUUID();
  await query(
    "INSERT INTO test_suites (id, project_id, name, description, filter_json) VALUES ($1,$2,$3,$4,$5)",
    [id, input.projectId, input.name, input.description ?? null, input.filter ? JSON.stringify(input.filter) : null],
  );
  return { id, name: input.name };
}

export async function updateSuite(input: { projectId: string; suiteId: string; name?: string; description?: string; filter?: Record<string, unknown> | null }) {
  const existing = await query("SELECT id FROM test_suites WHERE id = $1 AND project_id = $2", [input.suiteId, input.projectId]);
  if (existing.rows.length === 0) throw err.notFound("Suite not found");
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); params.push(input.name); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description); }
  if (input.filter !== undefined) { sets.push(`filter_json = $${i++}`); params.push(input.filter ? JSON.stringify(input.filter) : null); }
  if (sets.length) {
    params.push(input.suiteId);
    await query(`UPDATE test_suites SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }
  return { id: input.suiteId };
}

export async function addCasesToSuite(input: { projectId: string; suiteId: string; caseIds: string[] }) {
  const existing = await query("SELECT id FROM test_suites WHERE id = $1 AND project_id = $2", [input.suiteId, input.projectId]);
  if (existing.rows.length === 0) throw err.notFound("Suite not found");
  await withTransaction(async (tx) => {
    for (let i = 0; i < input.caseIds.length; i++) {
      const c = await tx.query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [input.caseIds[i], input.projectId]);
      if (c.rows.length === 0) throw err.notFound(`Case ${input.caseIds[i]} not found`);
      await tx.query(
        "INSERT INTO suite_cases (suite_id, test_case_id, position) VALUES ($1,$2,$3) ON CONFLICT (suite_id, test_case_id) DO UPDATE SET position = EXCLUDED.position",
        [input.suiteId, input.caseIds[i], i],
      );
    }
  });
  return { suiteId: input.suiteId, added: input.caseIds.length };
}

export async function getSuiteCases(projectId: string, suiteId: string) {
  const res = await query(
    `SELECT c.id, c.ref, c.title, c.current_version, c.folder_path, c.priority, c.type, c.automation_status, sc.position
     FROM suite_cases sc JOIN test_cases c ON c.id = sc.test_case_id
     WHERE sc.suite_id = $1 AND c.project_id = $2 ORDER BY sc.position ASC`,
    [suiteId, projectId],
  );
  return res.rows.map((c) => ({
    id: c.id,
    ref: c.ref,
    title: c.title,
    position: c.position,
  }));
}
