import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import type { Queryable } from "../db/types";
import { err } from "../util/errors";
import { recordAudit } from "./audit";

export type RunStatus = "planned" | "in_progress" | "paused" | "completed" | "aborted";

// State machine: planned → in_progress → (paused ⇄ in_progress) → completed | aborted
export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  planned: ["in_progress", "aborted"],
  in_progress: ["paused", "completed", "aborted"],
  paused: ["in_progress", "completed", "aborted"],
  completed: [],
  aborted: [],
};

export async function transitionRun(
  run: { id: string; project_id: string; organization_id: string; status: string },
  to: RunStatus,
  opts: { actorId?: string | null; ip?: string; force?: boolean; reason?: string } = {},
): Promise<void> {
  const from = run.status as RunStatus;
  const allowed = RUN_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw err.invalidTransition(from, to, allowed);
  }

  if (to === "completed") {
    const untested = await query(
      "SELECT COUNT(*)::int AS n FROM test_executions WHERE run_id = $1 AND status = 'untested'",
      [run.id],
    );
    const n = Number(untested.rows[0].n);
    if (n > 0 && !opts.force) {
      throw err.ruleViolation(
        "Run has untested executions; pass { force: true, reason } to complete anyway",
        { untested: n },
      );
    }
    if (n > 0 && opts.force) {
      await recordAudit({
        organizationId: run.organization_id,
        actorId: opts.actorId ?? null,
        action: "run.force_complete",
        entityType: "test_run",
        entityId: run.id,
        metadata: { force: true, reason: opts.reason ?? null, untested: n },
        ip: opts.ip,
      });
    }
  }

  const fields: Record<RunStatus, string> = {
    planned: "now()",
    in_progress: "started_at = COALESCE(started_at, now())",
    paused: "now()",
    completed: "completed_at = now()",
    aborted: "completed_at = now()",
  };
  const extra = fields[to];
  await query(`UPDATE test_runs SET status = $1, ${extra} WHERE id = $2`, [to, run.id]);

  if (to === "completed" || to === "aborted") {
    await refreshRunStats(run.id);
  }
}

export async function refreshRunStats(runId: string): Promise<void> {
  const res = await query(
    `SELECT status, COUNT(*)::int AS n FROM test_executions WHERE run_id = $1 GROUP BY status`,
    [runId],
  );
  const stats: Record<string, number> = { passed: 0, failed: 0, blocked: 0, skipped: 0, untested: 0, retest: 0, total: 0 };
  for (const r of res.rows) {
    stats[r.status] = Number(r.n);
    stats.total += Number(r.n);
  }
  await query("UPDATE test_runs SET stats_json = $1::jsonb WHERE id = $2", [JSON.stringify(stats), runId]);
}

async function resolveCaseIds(projectId: string, opts: { suiteId?: string | null; caseIds?: string[]; filter?: Record<string, unknown> }): Promise<string[]> {
  if (opts.caseIds && opts.caseIds.length) return opts.caseIds;
  if (opts.suiteId) {
    const res = await query(
      "SELECT test_case_id FROM suite_cases WHERE suite_id = $1 ORDER BY position ASC",
      [opts.suiteId],
    );
    return res.rows.map((r) => r.test_case_id);
  }
  if (opts.filter) {
    return resolveFilteredCases(projectId, opts.filter);
  }
  throw err.validation("Provide suiteId, caseIds, or filter");
}

async function resolveFilteredCases(projectId: string, filter: Record<string, unknown>): Promise<string[]> {
  const where = ["project_id = $1", "is_archived = false"];
  const params: unknown[] = [projectId];
  let i = 2;
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "tag") {
      where.push(`EXISTS (SELECT 1 FROM test_case_versions v WHERE v.test_case_id = test_cases.id AND v.version = test_cases.current_version AND $${i} = ANY(v.tags))`);
    } else if (["folder", "type", "priority", "automation_status"].includes(k)) {
      where.push(`${k === "folder" ? "folder_path" : k} = $${i}`);
    } else {
      throw err.validation(`Unsupported filter field '${k}'`);
    }
    params.push(v);
    i++;
  }
  const res = await query(`SELECT id FROM test_cases WHERE ${where.join(" AND ")} ORDER BY ref ASC`, params);
  return res.rows.map((r) => r.id);
}

export async function createRun(input: {
  projectId: string;
  organizationId: string;
  name?: string;
  suiteId?: string | null;
  caseIds?: string[];
  filter?: Record<string, unknown>;
  planId?: string | null;
  buildId?: string | null;
  environmentId: string;
  source?: "manual" | "ci";
  createdBy?: string | null;
}) {
  const env = await query("SELECT id FROM environments WHERE id = $1 AND project_id = $2", [input.environmentId, input.projectId]);
  if (env.rows.length === 0) throw err.notFound("Environment not found");

  const caseIds = await resolveCaseIds(input.projectId, {
    suiteId: input.suiteId,
    caseIds: input.caseIds,
    filter: input.filter,
  });
  if (caseIds.length === 0) throw err.validation("No cases matched the run definition");

  const runId = randomUUID();
  let created: { id: string; executions: number } = { id: runId, executions: 0 };

  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO test_runs (id, project_id, plan_id, suite_id, build_id, environment_id, name, source, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9)`,
      [
        runId,
        input.projectId,
        input.planId ?? null,
        input.suiteId ?? null,
        input.buildId ?? null,
        input.environmentId,
        input.name ?? "Test run",
        input.source ?? "manual",
        input.createdBy ?? null,
      ],
    );

    let count = 0;
    for (const caseId of caseIds) {
      const ver = await tx.query(
        "SELECT id FROM test_case_versions WHERE test_case_id = $1 ORDER BY version DESC LIMIT 1",
        [caseId],
      );
      if (ver.rows.length === 0) continue;
      await tx.query(
        `INSERT INTO test_executions (id, run_id, test_case_id, case_version_id, status, attempt)
         VALUES ($1,$2,$3,$4,'untested',1)`,
        [randomUUID(), runId, caseId, ver.rows[0].id],
      );
      count++;
    }
    created.executions = count;
  });

  return { id: runId, status: "planned", executionCount: created.executions };
}

export async function getRun(projectId: string, runId: string) {
  const res = await query(
    `SELECT r.*, e.name AS environment_name, b.version_label AS build_label
     FROM test_runs r
     JOIN environments e ON e.id = r.environment_id
     LEFT JOIN builds b ON b.id = r.build_id
     WHERE r.id = $1 AND r.project_id = $2`,
    [runId, projectId],
  );
  if (res.rows.length === 0) throw err.notFound("Run not found");
  return toRun(res.rows[0]);
}

export async function listRuns(projectId: string, filters: { status?: string; source?: string; buildId?: string; suiteId?: string } = {}) {
  const where = ["r.project_id = $1"];
  const params: unknown[] = [projectId];
  let i = 2;
  if (filters.status) { where.push(`r.status = $${i++}`); params.push(filters.status); }
  if (filters.source) { where.push(`r.source = $${i++}`); params.push(filters.source); }
  if (filters.buildId) { where.push(`r.build_id = $${i++}`); params.push(filters.buildId); }
  if (filters.suiteId) { where.push(`r.suite_id = $${i++}`); params.push(filters.suiteId); }
  const res = await query(
    `SELECT r.*, e.name AS environment_name, b.version_label AS build_label
     FROM test_runs r
     JOIN environments e ON e.id = r.environment_id
     LEFT JOIN builds b ON b.id = r.build_id
     WHERE ${where.join(" AND ")} ORDER BY r.created_at DESC`,
    params,
  );
  return res.rows.map(toRun);
}

function toRun(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    planId: r.plan_id,
    suiteId: r.suite_id,
    buildId: r.build_id,
    buildLabel: r.build_label ?? null,
    environmentId: r.environment_id,
    environmentName: r.environment_name,
    name: r.name,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    createdBy: r.created_by,
    stats: r.stats_json ?? null,
    createdAt: r.created_at,
  };
}

export async function getExecutions(projectId: string, runId: string) {
  const run = await getRun(projectId, runId);
  const res = await query(
    `SELECT e.*, c.ref AS case_ref, c.title AS case_title
     FROM test_executions e
     JOIN test_cases c ON c.id = e.test_case_id
     WHERE e.run_id = $1 ORDER BY c.ref ASC, e.attempt ASC`,
    [runId],
  );
  return res.rows.map((e) => ({
    id: e.id,
    runId: e.run_id,
    testCaseId: e.test_case_id,
    caseVersionId: e.case_version_id,
    caseRef: e.case_ref,
    caseTitle: e.case_title,
    assignedTo: e.assigned_to,
    status: e.status,
    durationMs: e.duration_ms,
    executedBy: e.executed_by,
    executedAt: e.executed_at,
    comment: e.comment,
    stepResults: e.step_results_json,
    automationRef: e.automation_ref,
    failureSignature: e.failure_signature,
    attempt: e.attempt,
  }));
}

export async function assignRun(input: { projectId: string; runId: string; assignments: Array<{ executionId?: string; caseId?: string; userId: string }> }) {
  const run = await getRun(input.projectId, input.runId);
  if (run.status === "completed" || run.status === "aborted") throw err.runCompleted();
  for (const a of input.assignments) {
    if (a.executionId) {
      await query("UPDATE test_executions SET assigned_to = $1 WHERE id = $2 AND run_id = $3", [a.userId, a.executionId, input.runId]);
    } else if (a.caseId) {
      await query("UPDATE test_executions SET assigned_to = $1 WHERE run_id = $2 AND test_case_id = $3", [a.userId, input.runId, a.caseId]);
    }
  }
  return { assigned: input.assignments.length };
}

// ---------- execution ----------

export async function patchExecution(input: {
  projectId: string;
  executionId: string;
  status?: string;
  comment?: string;
  stepResults?: unknown;
  durationMs?: number;
  actorId?: string | null;
  organizationId: string;
  ip?: string;
}) {
  const res = await query(
    `SELECT e.*, r.status AS run_status, r.project_id FROM test_executions e
     JOIN test_runs r ON r.id = e.run_id WHERE e.id = $1`,
    [input.executionId],
  );
  if (res.rows.length === 0) throw err.notFound("Execution not found");
  const e = res.rows[0];
  if (e.project_id !== input.projectId) throw err.notFound("Execution not found");
  if (e.run_status === "completed" || e.run_status === "aborted") throw err.runCompleted();

  const statuses = ["untested", "passed", "failed", "blocked", "skipped", "retest"];
  const newStatus = input.status ?? e.status;
  if (!statuses.includes(newStatus)) throw err.validation("Invalid execution status");

  let failureSignature = e.failure_signature;
  if (newStatus === "failed") {
    const { failureSignature: sig } = await import("../intelligence/signature");
    const errorType = "assertion";
    const stepResults = input.stepResults ?? e.step_results_json;
    const message = extractFailureMessage(stepResults, input.comment);
    failureSignature = sig({ errorType, message, frames: extractFrames(stepResults) });
  } else if (newStatus === "passed") {
    failureSignature = null;
  }

  await query(
    `UPDATE test_executions
     SET status = $1, comment = $2, step_results_json = $3::jsonb, duration_ms = $4,
         executed_by = $5, executed_at = COALESCE(executed_at, now()), failure_signature = $6
     WHERE id = $7`,
    [
      newStatus,
      input.comment ?? null,
      JSON.stringify(input.stepResults ?? e.step_results_json),
      input.durationMs ?? e.duration_ms,
      input.actorId ?? null,
      failureSignature,
      input.executionId,
    ],
  );

  return { id: input.executionId, status: newStatus };
}

function extractFailureMessage(stepResults: unknown, comment?: string): string {
  if (comment) return comment;
  if (Array.isArray(stepResults)) {
    const failed = stepResults.find((s: any) => s && (s.status === "failed" || s.result === "failed"));
    if (failed) return `${failed.action ?? ""} :: ${failed.actual ?? failed.error ?? ""}`;
  }
  return "failure";
}

function extractFrames(stepResults: unknown): string[] {
  if (Array.isArray(stepResults)) {
    const failed = stepResults.find((s: any) => s && (s.status === "failed" || s.result === "failed"));
    if (failed?.stack) return [failed.stack];
    if (failed?.trace) return [failed.trace];
  }
  return [];
}

export async function retestExecution(input: { projectId: string; executionId: string; actorId?: string | null }) {
  const res = await query(
    `SELECT e.*, r.status AS run_status FROM test_executions e
     JOIN test_runs r ON r.id = e.run_id WHERE e.id = $1`,
    [input.executionId],
  );
  if (res.rows.length === 0) throw err.notFound("Execution not found");
  const e = res.rows[0];
  if (e.project_id !== input.projectId) throw err.notFound("Execution not found");

  const attempt = e.attempt + 1;
  const newId = randomUUID();
  await query(
    `INSERT INTO test_executions (id, run_id, test_case_id, case_version_id, assigned_to, status, attempt)
     VALUES ($1,$2,$3,$4,$5,'untested',$6)`,
    [newId, e.run_id, e.test_case_id, e.case_version_id, e.assigned_to, attempt],
  );
  return { id: newId, testCaseId: e.test_case_id, attempt };
}
