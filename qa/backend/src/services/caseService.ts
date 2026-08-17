import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { err } from "../util/errors";
import { nextRef } from "./refs";

const PRIORITIES = ["low", "medium", "high", "critical"];
const TYPES = ["functional", "regression", "smoke", "integration", "e2e", "performance", "security"];
const AUTOMATION = ["manual", "automated", "candidate"];

export interface Step {
  index: number;
  action: string;
  expected: string;
}

interface CaseInput {
  projectId: string;
  title: string;
  ref?: string;
  folderPath?: string;
  priority?: string;
  type?: string;
  automationStatus?: string;
  automationKey?: string | null;
  ownerId?: string | null;
  preconditions?: string;
  steps?: Step[];
  expectedResult?: string;
  tags?: string[];
  estimatedMinutes?: number | null;
  requirementIds?: string[];
  changeNote?: string;
  authorId?: string | null;
}

export async function listCases(
  projectId: string,
  filters: { folder?: string; tag?: string; type?: string; priority?: string; automation_status?: string; q?: string } = {},
  pagination: { page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? 25));
  const where = ["c.project_id = $1", "c.is_archived = false"];
  const params: unknown[] = [projectId];
  let i = 2;
  if (filters.folder) {
    where.push(`c.folder_path = $${i++}`);
    params.push(filters.folder);
  }
  if (filters.type) {
    where.push(`c.type = $${i++}`);
    params.push(filters.type);
  }
  if (filters.priority) {
    where.push(`c.priority = $${i++}`);
    params.push(filters.priority);
  }
  if (filters.automation_status) {
    where.push(`c.automation_status = $${i++}`);
    params.push(filters.automation_status);
  }
  if (filters.tag) {
    where.push(`EXISTS (SELECT 1 FROM test_case_versions v WHERE v.test_case_id = c.id AND v.version = c.current_version AND $${i} = ANY(v.tags))`);
    params.push(filters.tag);
    i++;
  }
  if (filters.q) {
    where.push(`(c.ref ILIKE $${i} OR c.title ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }

  const whereSql = where.join(" AND ");
  const countRes = await query(`SELECT COUNT(*)::int AS n FROM test_cases c WHERE ${whereSql}`, params);
  const total = Number(countRes.rows[0].n);

  const items = await query(
    `SELECT c.id, c.ref, c.title, c.current_version, c.folder_path, c.priority, c.type,
            c.automation_status, c.automation_key, c.owner_id, c.created_at, c.updated_at,
            v.steps_json, v.tags, v.expected_result
     FROM test_cases c
     LEFT JOIN test_case_versions v ON v.test_case_id = c.id AND v.version = c.current_version
     WHERE ${whereSql}
     ORDER BY c.ref ASC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...params, pageSize, (page - 1) * pageSize],
  );

  return {
    items: items.rows.map((c) => ({
      id: c.id,
      ref: c.ref,
      title: c.title,
      currentVersion: c.current_version,
      folderPath: c.folder_path,
      priority: c.priority,
      type: c.type,
      automationStatus: c.automation_status,
      automationKey: c.automation_key,
      ownerId: c.owner_id,
      tags: c.tags ?? [],
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
    total,
    page,
    pageSize,
  };
}

export async function createCase(input: CaseInput) {
  if (input.priority && !PRIORITIES.includes(input.priority)) throw err.validation("Invalid priority");
  if (input.type && !TYPES.includes(input.type)) throw err.validation("Invalid type");
  if (input.automationStatus && !AUTOMATION.includes(input.automationStatus)) throw err.validation("Invalid automation_status");

  const caseId = randomUUID();
  const ref = input.ref || (await nextRef(input.projectId, "TC"));

  await withTransaction(async (tx) => {
    const dup = await tx.query("SELECT id FROM test_cases WHERE project_id = $1 AND ref = $2", [input.projectId, ref]);
    if (dup.rows.length > 0) throw err.conflict("A case with this ref already exists");
    if (input.automationKey) {
      const kdup = await tx.query("SELECT id FROM test_cases WHERE project_id = $1 AND automation_key = $2", [input.projectId, input.automationKey]);
      if (kdup.rows.length > 0) throw err.conflict("automation_key already in use");
    }

    await tx.query(
      `INSERT INTO test_cases (id, project_id, ref, title, current_version, folder_path, priority, type, automation_status, automation_key, owner_id)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`,
      [
        caseId,
        input.projectId,
        ref,
        input.title,
        input.folderPath ?? "/",
        input.priority ?? "medium",
        input.type ?? "functional",
        input.automationStatus ?? "manual",
        input.automationKey ?? null,
        input.ownerId ?? null,
      ],
    );
    await insertVersion(tx, caseId, 1, input);
    if (input.requirementIds?.length) {
      for (const r of input.requirementIds) {
        await tx.query("INSERT INTO case_requirements (test_case_id, requirement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [caseId, r]);
      }
    }
  });

  return getCase(input.projectId, caseId);
}

async function insertVersion(tx: { query: Function }, caseId: string, version: number, input: CaseInput) {
  await tx.query(
    `INSERT INTO test_case_versions (id, test_case_id, version, title, preconditions, steps_json, expected_result, tags, estimated_minutes, authored_by, change_note)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      caseId,
      version,
      input.title,
      input.preconditions ?? null,
      JSON.stringify(input.steps ?? []),
      input.expectedResult ?? null,
      input.tags ?? [],
      input.estimatedMinutes ?? null,
      input.authorId ?? null,
      input.changeNote ?? null,
    ],
  );
}

export async function getCase(projectId: string, caseId: string) {
  const res = await query(
    `SELECT c.* FROM test_cases c WHERE c.id = $1 AND c.project_id = $2`,
    [caseId, projectId],
  );
  if (res.rows.length === 0) throw err.notFound("Test case not found");
  const c = res.rows[0];

  const versions = await query(
    "SELECT * FROM test_case_versions WHERE test_case_id = $1 ORDER BY version ASC",
    [caseId],
  );
  const reqs = await query(
    `SELECT r.id, r.ref, r.title, r.criticality FROM case_requirements cr
     JOIN requirements r ON r.id = cr.requirement_id WHERE cr.test_case_id = $1 ORDER BY r.ref`,
    [caseId],
  );

  const current = versions.rows.find((v) => v.version === c.current_version) ?? versions.rows[versions.rows.length - 1];

  return {
    id: c.id,
    ref: c.ref,
    title: c.title,
    currentVersion: c.current_version,
    folderPath: c.folder_path,
    priority: c.priority,
    type: c.type,
    automationStatus: c.automation_status,
    automationKey: c.automation_key,
    ownerId: c.owner_id,
    isArchived: c.is_archived,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    steps: current?.steps_json ?? [],
    preconditions: current?.preconditions ?? null,
    expectedResult: current?.expected_result ?? null,
    tags: current?.tags ?? [],
    estimatedMinutes: current?.estimated_minutes ?? null,
    requirements: reqs.rows.map((r) => ({ id: r.id, ref: r.ref, title: r.title, criticality: r.criticality })),
    versions: versions.rows.map((v) => ({
      version: v.version,
      title: v.title,
      preconditions: v.preconditions,
      steps: v.steps_json,
      expectedResult: v.expected_result,
      tags: v.tags,
      estimatedMinutes: v.estimated_minutes,
      authoredBy: v.authored_by,
      changeNote: v.change_note,
      createdAt: v.created_at,
    })),
  };
}

// PATCH -> always creates a new immutable version (N+1).
export async function updateCase(input: {
  projectId: string;
  caseId: string;
  title?: string;
  folderPath?: string;
  priority?: string;
  type?: string;
  automationStatus?: string;
  automationKey?: string | null;
  ownerId?: string | null;
  preconditions?: string;
  steps?: Step[];
  expectedResult?: string;
  tags?: string[];
  estimatedMinutes?: number | null;
  changeNote?: string;
  authorId?: string | null;
}) {
  const res = await query("SELECT * FROM test_cases WHERE id = $1 AND project_id = $2", [input.caseId, input.projectId]);
  if (res.rows.length === 0) throw err.notFound("Test case not found");
  const c = res.rows[0];

  if (input.priority && !PRIORITIES.includes(input.priority)) throw err.validation("Invalid priority");
  if (input.type && !TYPES.includes(input.type)) throw err.validation("Invalid type");
  if (input.automationStatus && !AUTOMATION.includes(input.automationStatus)) throw err.validation("Invalid automation_status");

  const newVersion = c.current_version + 1;
  const currentVersion = await query(
    "SELECT * FROM test_case_versions WHERE test_case_id = $1 AND version = $2",
    [input.caseId, c.current_version],
  );
  const cur = currentVersion.rows[0];

  const newTitle = input.title ?? c.title;
  const newSteps = input.steps ?? cur.steps_json;
  const newPreconditions = input.preconditions !== undefined ? input.preconditions : cur.preconditions;
  const newExpected = input.expectedResult !== undefined ? input.expectedResult : cur.expected_result;
  const newTags = input.tags ?? cur.tags;
  const newEst = input.estimatedMinutes !== undefined ? input.estimatedMinutes : cur.estimated_minutes;

  await withTransaction(async (tx) => {
    if (input.automationKey !== undefined && input.automationKey !== null) {
      const kdup = await tx.query(
        "SELECT id FROM test_cases WHERE project_id = $1 AND automation_key = $2 AND id <> $3",
        [input.projectId, input.automationKey, input.caseId],
      );
      if (kdup.rows.length > 0) throw err.conflict("automation_key already in use");
    }
    await tx.query(
      `INSERT INTO test_case_versions (id, test_case_id, version, title, preconditions, steps_json, expected_result, tags, estimated_minutes, authored_by, change_note)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)`,
      [
        randomUUID(),
        input.caseId,
        newVersion,
        newTitle,
        newPreconditions,
        JSON.stringify(newSteps),
        newExpected,
        newTags,
        newEst,
        input.authorId ?? null,
        input.changeNote ?? null,
      ],
    );
    const sets: string[] = [`current_version = $1`, `updated_at = now()`];
    const params: unknown[] = [newVersion];
    let i = 2;
    if (input.title !== undefined) { sets.push(`title = $${i++}`); params.push(input.title); }
    if (input.folderPath !== undefined) { sets.push(`folder_path = $${i++}`); params.push(input.folderPath); }
    if (input.priority !== undefined) { sets.push(`priority = $${i++}`); params.push(input.priority); }
    if (input.type !== undefined) { sets.push(`type = $${i++}`); params.push(input.type); }
    if (input.automationStatus !== undefined) { sets.push(`automation_status = $${i++}`); params.push(input.automationStatus); }
    if (input.automationKey !== undefined) { sets.push(`automation_key = $${i++}`); params.push(input.automationKey); }
    if (input.ownerId !== undefined) { sets.push(`owner_id = $${i++}`); params.push(input.ownerId); }
    params.push(input.caseId);
    await tx.query(`UPDATE test_cases SET ${sets.join(", ")} WHERE id = $${i}`, params);
  });

  return getCase(input.projectId, input.caseId);
}

export async function getCaseVersion(projectId: string, caseId: string, version: number) {
  const c = await query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [caseId, projectId]);
  if (c.rows.length === 0) throw err.notFound("Test case not found");
  const res = await query(
    "SELECT * FROM test_case_versions WHERE test_case_id = $1 AND version = $2",
    [caseId, version],
  );
  if (res.rows.length === 0) throw err.notFound("Version not found");
  const v = res.rows[0];
  return {
    version: v.version,
    title: v.title,
    preconditions: v.preconditions,
    steps: v.steps_json,
    expectedResult: v.expected_result,
    tags: v.tags,
    estimatedMinutes: v.estimated_minutes,
    authoredBy: v.authored_by,
    changeNote: v.change_note,
    createdAt: v.created_at,
  };
}

export async function linkRequirements(projectId: string, caseId: string, requirementIds: string[]) {
  const c = await query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [caseId, projectId]);
  if (c.rows.length === 0) throw err.notFound("Test case not found");
  for (const r of requirementIds) {
    const req = await query("SELECT id FROM requirements WHERE id = $1 AND project_id = $2", [r, projectId]);
    if (req.rows.length === 0) throw err.notFound(`Requirement ${r} not found`);
    await query(
      "INSERT INTO case_requirements (test_case_id, requirement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [caseId, r],
    );
  }
  return getCase(projectId, caseId);
}

export async function bulkAction(input: {
  projectId: string;
  caseIds: string[];
  action: "move" | "tag" | "archive" | "unarchive";
  folderPath?: string;
  tags?: string[];
}) {
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const id of input.caseIds) {
    try {
      const c = await query("SELECT id, folder_path FROM test_cases WHERE id = $1 AND project_id = $2", [id, input.projectId]);
      if (c.rows.length === 0) {
        results.push({ id, ok: false, error: "not found" });
        continue;
      }
      if (input.action === "move") {
        await query("UPDATE test_cases SET folder_path = $1 WHERE id = $2", [input.folderPath ?? "/", id]);
      } else if (input.action === "archive") {
        await query("UPDATE test_cases SET is_archived = true WHERE id = $1", [id]);
      } else if (input.action === "unarchive") {
        await query("UPDATE test_cases SET is_archived = false WHERE id = $1", [id]);
      } else if (input.action === "tag") {
        const cur = await query("SELECT tags FROM test_case_versions WHERE test_case_id = $1 ORDER BY version DESC LIMIT 1", [id]);
        const merged = Array.from(new Set([...(cur.rows[0]?.tags ?? []), ...(input.tags ?? [])]));
        await query("UPDATE test_case_versions SET tags = $1 WHERE test_case_id = $2 AND version = (SELECT MAX(version) FROM test_case_versions WHERE test_case_id = $2)", [merged, id]);
      }
      results.push({ id, ok: true });
    } catch (e: any) {
      results.push({ id, ok: false, error: e?.message });
    }
  }
  return { results };
}

export async function getCaseHistory(projectId: string, caseId: string) {
  const c = await query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [caseId, projectId]);
  if (c.rows.length === 0) throw err.notFound("Test case not found");

  const execs = await query(
    `SELECT e.id, e.status, e.executed_at, e.duration_ms, e.comment, e.attempt, e.failure_signature,
            r.id AS run_id, r.name AS run_name, b.version_label AS build, b.commit_sha
     FROM test_executions e
     JOIN test_runs r ON r.id = e.run_id
     LEFT JOIN builds b ON b.id = r.build_id
     WHERE e.test_case_id = $1
     ORDER BY e.executed_at ASC`,
    [caseId],
  );

  const flaky = await query(
    "SELECT * FROM flaky_signals WHERE test_case_id = $1 ORDER BY computed_at DESC LIMIT 1",
    [caseId],
  );

  return {
    caseId,
    timeline: execs.rows.map((e) => ({
      executionId: e.id,
      runId: e.run_id,
      runName: e.run_name,
      build: e.build,
      commitSha: e.commit_sha,
      status: e.status,
      executedAt: e.executed_at,
      durationMs: e.duration_ms,
      comment: e.comment,
      attempt: e.attempt,
    })),
    flake: flaky.rows[0]
      ? {
          score: Number(flaky.rows[0].flake_score),
          verdict: flaky.rows[0].verdict,
          totalRuns: flaky.rows[0].total_runs,
          transitions: flaky.rows[0].transitions,
        }
      : null,
  };
}
