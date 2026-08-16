import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import type { Queryable } from "../db/types";
import { err } from "../util/errors";
import { nextRef } from "./refs";
import { recordAudit } from "./audit";

export type DefectStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "resolved"
  | "verified"
  | "closed"
  | "reopened"
  | "wont_fix"
  | "duplicate";

export const DEFECT_TRANSITIONS: Record<DefectStatus, DefectStatus[]> = {
  new: ["triaged", "in_progress", "wont_fix", "duplicate"],
  triaged: ["in_progress", "wont_fix", "duplicate"],
  in_progress: ["resolved", "wont_fix", "duplicate"],
  resolved: ["verified", "reopened", "closed"],
  verified: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["in_progress", "wont_fix", "duplicate"],
  wont_fix: [],
  duplicate: [],
};

const SEVERITIES = ["trivial", "minor", "major", "critical", "blocker"];
const PRIORITIES = ["low", "medium", "high", "urgent"];

// Pure transition validation (§3). Enforces the defect state machine,
// the duplicate-of rule, and the self-verification block. Kept free of DB
// access so it can be unit-tested in isolation.
export function validateDefectTransition(opts: {
  fromStatus: DefectStatus;
  toStatus: DefectStatus;
  duplicateOfId?: string | null;
  resolverId?: string | null;
  actorId?: string | null;
}): void {
  const { fromStatus, toStatus, duplicateOfId, resolverId, actorId } = opts;
  if (toStatus === fromStatus) return;
  const allowed = DEFECT_TRANSITIONS[fromStatus] ?? [];
  if (!allowed.includes(toStatus)) {
    throw err.invalidTransition(fromStatus, toStatus, allowed);
  }
  if (toStatus === "duplicate" && !duplicateOfId) {
    throw err.ruleViolation("Marking duplicate requires duplicateOfId");
  }
  if (toStatus === "verified" && resolverId && actorId && resolverId === actorId) {
    throw err.selfVerification();
  }
}

export async function listDefects(
  projectId: string,
  filters: { status?: string; severity?: string; priority?: string; q?: string; assignedTo?: string } = {},
) {
  const where = ["d.project_id = $1"];
  const params: unknown[] = [projectId];
  let i = 2;
  if (filters.status) { where.push(`d.status = $${i++}`); params.push(filters.status); }
  if (filters.severity) { where.push(`d.severity = $${i++}`); params.push(filters.severity); }
  if (filters.priority) { where.push(`d.priority = $${i++}`); params.push(filters.priority); }
  if (filters.assignedTo) { where.push(`d.assigned_to = $${i++}`); params.push(filters.assignedTo); }
  if (filters.q) { where.push(`(d.ref ILIKE $${i} OR d.title ILIKE $${i})`); params.push(`%${filters.q}%`); i++; }
  const res = await query(
    `SELECT d.*, u.email AS reporter_email, a.email AS assignee_email
     FROM defects d
     LEFT JOIN users u ON u.id = d.reported_by
     LEFT JOIN users a ON a.id = d.assigned_to
     WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC`,
    params,
  );
  return res.rows.map(toDefect);
}

export async function createDefect(input: {
  projectId: string;
  title?: string;
  description?: string;
  severity?: string;
  priority?: string;
  status?: string;
  reportedBy?: string | null;
  assignedTo?: string | null;
  foundInBuildId?: string | null;
  environmentId?: string | null;
  fromExecutionIds?: string[];
  actorId?: string | null;
  organizationId: string;
  ip?: string;
}) {
  if (input.severity && !SEVERITIES.includes(input.severity)) throw err.validation("Invalid severity");
  if (input.priority && !PRIORITIES.includes(input.priority)) throw err.validation("Invalid priority");

  let title = input.title;
  let description = input.description;
  let environmentId = input.environmentId ?? null;
  let foundInBuildId = input.foundInBuildId ?? null;
  const linkedExecutions: string[] = [];

  if (input.fromExecutionIds?.length) {
    for (const execId of input.fromExecutionIds) {
      const e = await query(
        `SELECT e.id, e.test_case_id, e.comment, e.step_results_json, e.failure_signature, e.status,
                r.environment_id, r.build_id, r.project_id, c.title AS case_title
         FROM test_executions e
         JOIN test_runs r ON r.id = e.run_id
         JOIN test_cases c ON c.id = e.test_case_id
         WHERE e.id = $1`,
        [execId],
      );
      if (e.rows.length === 0) throw err.notFound(`Execution ${execId} not found`);
      const ex = e.rows[0];
      if (ex.project_id !== input.projectId) throw err.notFound(`Execution ${execId} not found`);
      linkedExecutions.push(ex.id);
      if (!title) title = `Failure in ${ex.case_title}`;
      if (!description) description = `Failure signature ${ex.failure_signature ?? "unknown"}\n\n${ex.comment ?? JSON.stringify(ex.step_results_json ?? {})}`;
      if (!environmentId) environmentId = ex.environment_id;
      if (!foundInBuildId) foundInBuildId = ex.build_id;
    }
  }

  const id = randomUUID();
  const ref = await nextRef(input.projectId, "BUG");
  const status: DefectStatus = (input.status as DefectStatus) ?? "new";
  await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO defects (id, project_id, ref, title, description, severity, priority, status, reported_by, assigned_to, found_in_build_id, environment_id, first_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())`,
      [
        id,
        input.projectId,
        ref,
        title ?? "Untitled defect",
        description ?? null,
        input.severity ?? "major",
        input.priority ?? "medium",
        status,
        input.reportedBy ?? input.actorId ?? null,
        input.assignedTo ?? null,
        foundInBuildId,
        environmentId,
      ],
    );
    await tx.query(
      "INSERT INTO defect_events (id, defect_id, actor_id, from_status, to_status, comment) VALUES ($1,$2,$3,NULL,$4,'Created')",
      [randomUUID(), id, input.actorId ?? null, status],
    );
    for (const execId of linkedExecutions) {
      await tx.query("INSERT INTO defect_links (defect_id, execution_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, execId]);
    }
  });

  await recordAudit({
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    action: "defect.created",
    entityType: "defect",
    entityId: id,
    metadata: { ref, fromExecutionIds: linkedExecutions },
    ip: input.ip,
  });

  return getDefect(input.projectId, id);
}

export async function getDefect(projectId: string, defectId: string) {
  const res = await query(
    `SELECT d.*, u.email AS reporter_email, a.email AS assignee_email
     FROM defects d
     LEFT JOIN users u ON u.id = d.reported_by
     LEFT JOIN users a ON a.id = d.assigned_to
     WHERE d.id = $1 AND d.project_id = $2`,
    [defectId, projectId],
  );
  if (res.rows.length === 0) throw err.notFound("Defect not found");
  const d = res.rows[0];

  const events = await query(
    `SELECT e.*, u.email AS actor_email FROM defect_events e
     LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.defect_id = $1 ORDER BY e.created_at ASC`,
    [defectId],
  );
  const links = await query(
    `SELECT dl.execution_id, e.test_case_id, c.ref AS case_ref, e.status, e.executed_at
     FROM defect_links dl
     JOIN test_executions e ON e.id = dl.execution_id
     JOIN test_cases c ON c.id = e.test_case_id
     WHERE dl.defect_id = $1`,
    [defectId],
  );

  return {
    ...toDefect(d),
    events: events.rows.map((ev) => ({
      id: ev.id,
      actorId: ev.actor_id,
      actorEmail: ev.actor_email,
      fromStatus: ev.from_status,
      toStatus: ev.to_status,
      fieldChanges: ev.field_changes_json,
      comment: ev.comment,
      createdAt: ev.created_at,
    })),
    linkedExecutions: links.rows.map((l) => ({
      executionId: l.execution_id,
      testCaseId: l.test_case_id,
      caseRef: l.case_ref,
      status: l.status,
      executedAt: l.executed_at,
    })),
  };
}

export async function updateDefect(input: {
  projectId: string;
  defectId: string;
  status?: string;
  title?: string;
  description?: string;
  severity?: string;
  priority?: string;
  assignedTo?: string | null;
  resolution?: string | null;
  duplicateOfId?: string | null;
  actorId?: string | null;
  organizationId: string;
  ip?: string;
}) {
  const res = await query("SELECT * FROM defects WHERE id = $1 AND project_id = $2", [input.defectId, input.projectId]);
  if (res.rows.length === 0) throw err.notFound("Defect not found");
  const d = res.rows[0];

  if (input.severity && !SEVERITIES.includes(input.severity)) throw err.validation("Invalid severity");
  if (input.priority && !PRIORITIES.includes(input.priority)) throw err.validation("Invalid priority");

  const fromStatus = d.status as DefectStatus;
  const toStatus = (input.status as DefectStatus) ?? fromStatus;

  let resolverId: string | null = null;
  if (toStatus !== fromStatus && toStatus === "verified") {
    const resolver = await query(
      "SELECT actor_id FROM defect_events WHERE defect_id = $1 AND to_status = 'resolved' ORDER BY created_at DESC LIMIT 1",
      [input.defectId],
    );
    resolverId = resolver.rows.length > 0 ? (resolver.rows[0].actor_id ?? null) : null;
  }
  validateDefectTransition({
    fromStatus,
    toStatus,
    duplicateOfId: input.duplicateOfId,
    resolverId,
    actorId: input.actorId ?? null,
  });

  await withTransaction(async (tx) => {
    const sets: string[] = ["updated_at = now()"];
    const params: unknown[] = [];
    let i = 1;

    if (toStatus !== fromStatus) {
      sets.push(`status = $${i++}`);
      params.push(toStatus);
      if (toStatus === "resolved") { sets.push(`resolved_at = now()`); }
      if (toStatus === "closed") { sets.push(`closed_at = now()`); }
      if (toStatus === "reopened") { sets.push(`resolved_at = NULL, closed_at = NULL`); }
      if (toStatus === "wont_fix" || toStatus === "duplicate") { sets.push(`closed_at = now()`); }
    }
    if (input.title !== undefined) { sets.push(`title = $${i++}`); params.push(input.title); }
    if (input.description !== undefined) { sets.push(`description = $${i++}`); params.push(input.description); }
    if (input.severity !== undefined) { sets.push(`severity = $${i++}`); params.push(input.severity); }
    if (input.priority !== undefined) { sets.push(`priority = $${i++}`); params.push(input.priority); }
    if (input.assignedTo !== undefined) { sets.push(`assigned_to = $${i++}`); params.push(input.assignedTo); }
    if (input.resolution !== undefined) { sets.push(`resolution = $${i++}`); params.push(input.resolution); }
    if (input.duplicateOfId !== undefined) { sets.push(`duplicate_of_id = $${i++}`); params.push(input.duplicateOfId); }

    params.push(input.defectId);
    await tx.query(`UPDATE defects SET ${sets.join(", ")} WHERE id = $${i}`, params);

    const fieldChanges: Record<string, unknown> = {};
    if (input.title !== undefined) fieldChanges.title = input.title;
    if (input.severity !== undefined) fieldChanges.severity = input.severity;
    if (input.priority !== undefined) fieldChanges.priority = input.priority;
    if (input.assignedTo !== undefined) fieldChanges.assignedTo = input.assignedTo;

    await tx.query(
      "INSERT INTO defect_events (id, defect_id, actor_id, from_status, to_status, field_changes_json, comment) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)",
      [randomUUID(), input.defectId, input.actorId ?? null, fromStatus, toStatus, JSON.stringify(fieldChanges), toStatus === fromStatus ? "Updated" : null],
    );

    if (toStatus === "duplicate" && input.duplicateOfId) {
      // Merge links onto the canonical defect.
      await tx.query(
        "INSERT INTO defect_links (defect_id, execution_id) SELECT $1, execution_id FROM defect_links WHERE defect_id = $2 ON CONFLICT DO NOTHING",
        [input.duplicateOfId, input.defectId],
      );
    }
  });

  await recordAudit({
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    action: "defect.updated",
    entityType: "defect",
    entityId: input.defectId,
    metadata: { fromStatus, toStatus },
    ip: input.ip,
  });

  return getDefect(input.projectId, input.defectId);
}

export async function addDefectComment(input: {
  projectId: string;
  defectId: string;
  comment: string;
  actorId?: string | null;
}) {
  const res = await query("SELECT id, status FROM defects WHERE id = $1 AND project_id = $2", [input.defectId, input.projectId]);
  if (res.rows.length === 0) throw err.notFound("Defect not found");
  const status = res.rows[0].status;
  await query(
    "INSERT INTO defect_events (id, defect_id, actor_id, from_status, to_status, comment) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), input.defectId, input.actorId ?? null, status, status, input.comment],
  );
  return getDefect(input.projectId, input.defectId);
}

export async function markDuplicate(input: {
  projectId: string;
  defectId: string;
  duplicateOfId: string;
  actorId?: string | null;
  organizationId: string;
  ip?: string;
}) {
  return updateDefect({
    projectId: input.projectId,
    defectId: input.defectId,
    status: "duplicate",
    duplicateOfId: input.duplicateOfId,
    actorId: input.actorId,
    organizationId: input.organizationId,
    ip: input.ip,
  });
}

function toDefect(d: any) {
  return {
    id: d.id,
    ref: d.ref,
    title: d.title,
    description: d.description,
    severity: d.severity,
    priority: d.priority,
    status: d.status,
    resolution: d.resolution,
    reportedBy: d.reported_by,
    reporterEmail: d.reporter_email ?? null,
    assignedTo: d.assigned_to,
    assigneeEmail: d.assignee_email ?? null,
    foundInBuildId: d.found_in_build_id,
    fixedInBuildId: d.fixed_in_build_id,
    duplicateOfId: d.duplicate_of_id,
    environmentId: d.environment_id,
    slaDueAt: d.sla_due_at,
    firstSeenAt: d.first_seen_at,
    resolvedAt: d.resolved_at,
    closedAt: d.closed_at,
    escapedToProd: d.escaped_to_prod,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}
