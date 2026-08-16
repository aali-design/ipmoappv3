import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { err } from "../util/errors";
import { evaluateGate, type GateInputs, type GatePolicy } from "../intelligence/gate";
import { traceability } from "./metricsService";
import { listQuarantinedCaseIds } from "./flakyService";
import { recordAudit } from "./audit";
import { dispatchWebhook } from "./webhookService";

export async function listReleases(projectId: string) {
  const res = await query(
    `SELECT rl.*, b.version_label AS build_label
     FROM releases rl LEFT JOIN builds b ON b.id = rl.target_build_id
     WHERE rl.project_id = $1 ORDER BY rl.created_at DESC`,
    [projectId],
  );
  return res.rows.map(toRelease);
}

export async function createRelease(input: {
  projectId: string;
  name: string;
  targetBuildId?: string | null;
  plannedDate?: string | null;
  gatePolicy?: GatePolicy;
}) {
  const id = randomUUID();
  await query(
    `INSERT INTO releases (id, project_id, name, target_build_id, planned_date, status, gate_policy_json)
     VALUES ($1,$2,$3,$4,$5,'planning',$6::jsonb)`,
    [id, input.projectId, input.name, input.targetBuildId ?? null, input.plannedDate ?? null, JSON.stringify(input.gatePolicy ?? {})],
  );
  return getRelease(input.projectId, id);
}

export async function getRelease(projectId: string, releaseId: string) {
  const res = await query(
    `SELECT rl.*, b.version_label AS build_label FROM releases rl LEFT JOIN builds b ON b.id = rl.target_build_id
     WHERE rl.id = $1 AND rl.project_id = $2`,
    [releaseId, projectId],
  );
  if (res.rows.length === 0) throw err.notFound("Release not found");
  return toRelease(res.rows[0]);
}

export async function updateRelease(input: {
  projectId: string;
  releaseId: string;
  name?: string;
  targetBuildId?: string | null;
  plannedDate?: string | null;
  status?: string;
  gatePolicy?: GatePolicy;
}) {
  const existing = await query("SELECT * FROM releases WHERE id = $1 AND project_id = $2", [input.releaseId, input.projectId]);
  if (existing.rows.length === 0) throw err.notFound("Release not found");
  const cur = existing.rows[0];

  if (input.status) {
    const valid = ["planning", "testing", "gated", "released", "cancelled"];
    if (!valid.includes(input.status)) throw err.validation("Invalid release status");
    const order = ["planning", "testing", "gated", "released"];
    const fromIdx = order.indexOf(cur.status);
    const toIdx = order.indexOf(input.status);
    // Only forward transitions plus explicit cancellation are allowed.
    if (input.status !== "cancelled" && (fromIdx === -1 || toIdx === -1 || toIdx < fromIdx)) {
      throw err.invalidTransition(cur.status, input.status, ["testing", "gated", "released", "cancelled"]);
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (input.name !== undefined) { sets.push(`name = $${i++}`); params.push(input.name); }
  if (input.targetBuildId !== undefined) { sets.push(`target_build_id = $${i++}`); params.push(input.targetBuildId); }
  if (input.plannedDate !== undefined) { sets.push(`planned_date = $${i++}`); params.push(input.plannedDate); }
  if (input.status !== undefined) { sets.push(`status = $${i++}`); params.push(input.status); }
  if (input.gatePolicy !== undefined) { sets.push(`gate_policy_json = $${i++}::jsonb`); params.push(JSON.stringify(input.gatePolicy)); }
  if (sets.length) {
    params.push(input.releaseId);
    await query(`UPDATE releases SET ${sets.join(", ")} WHERE id = $${i}`, params);
  }
  return getRelease(input.projectId, input.releaseId);
}

async function computeGateInputs(projectId: string, buildId: string): Promise<GateInputs> {
  const quarantined = await listQuarantinedCaseIds(projectId);

  const runs = await query("SELECT id FROM test_runs WHERE project_id = $1 AND build_id = $2", [projectId, buildId]);
  const runIds = runs.rows.map((r) => r.id);

  const passRate = await query(
    `SELECT COUNT(*) FILTER (WHERE e.status = 'passed')::int AS passed,
            COUNT(*) FILTER (WHERE e.status IN ('passed','failed','blocked'))::int AS executed,
            COUNT(*) FILTER (WHERE e.status IN ('passed','failed','blocked') AND e.test_case_id = ANY($2::uuid[]))::int AS quarantined_excluded
     FROM test_executions e WHERE e.run_id = ANY($1::uuid[])`,
    [runIds.length ? runIds : [], quarantined],
  );
  const excludedQuarantined = Number(passRate.rows[0].quarantined_excluded);
  const executed = Number(passRate.rows[0].executed) - excludedQuarantined;
  const passed = Number(passRate.rows[0].passed) - Math.min(excludedQuarantined, Number(passRate.rows[0].passed));

  const openDefects = await query(
    "SELECT severity, id FROM defects WHERE project_id = $1 AND status IN ('new','triaged','in_progress','reopened')",
    [projectId],
  );
  const openDefectsBySeverity: Record<string, number> = {};
  for (const d of openDefects.rows) openDefectsBySeverity[d.severity] = (openDefectsBySeverity[d.severity] ?? 0) + 1;

  const trace = await traceability(projectId, buildId);

  const flakyInSuite = await query(
    `SELECT COUNT(DISTINCT fs.test_case_id)::int AS n
     FROM flaky_signals fs
     JOIN test_cases c ON c.id = fs.test_case_id
     JOIN test_executions e ON e.test_case_id = c.id
     JOIN test_runs r ON r.id = e.run_id
     WHERE c.project_id = $1 AND r.build_id = $2 AND fs.verdict = 'flaky'
       AND fs.id = (SELECT id FROM flaky_signals WHERE test_case_id = c.id ORDER BY computed_at DESC LIMIT 1)`,
    [projectId, buildId],
  );

  const suites = await query(
    `SELECT DISTINCT s.name FROM test_runs r JOIN test_suites s ON s.id = r.suite_id WHERE r.build_id = $1 AND s.name IS NOT NULL`,
    [buildId],
  );
  const suitesPresent = suites.rows.map((s) => s.name);

  return {
    executed,
    passed,
    quarantinedExcluded: excludedQuarantined,
    runIds,
    openDefectsBySeverity,
    openDefectIds: openDefects.rows.map((d) => d.id),
    requirementCoverage: trace.coverage,
    coverageGaps: trace.gaps.map((g) => ({ ref: g.ref, criticality: g.criticality })),
    flakyInSuiteCount: Number(flakyInSuite.rows[0].n),
    flakyCaseIds: [],
    suitesPresent,
  };
}

export async function evaluateReleaseGate(input: {
  projectId: string;
  releaseId: string;
  organizationId: string;
}) {
  const release = await query("SELECT * FROM releases WHERE id = $1 AND project_id = $2", [input.releaseId, input.projectId]);
  if (release.rows.length === 0) throw err.notFound("Release not found");
  const rel = release.rows[0];
  if (!rel.target_build_id) throw err.ruleViolation("Release has no target build to gate");
  if (!["testing", "gated"].includes(rel.status)) {
    throw err.invalidTransition(rel.status, "gated", ["testing", "gated"]);
  }

  const inputs = await computeGateInputs(input.projectId, rel.target_build_id);
  const policy: GatePolicy = rel.gate_policy_json ?? {};
  const result = evaluateGate(policy, inputs);

  // A waiver is permanent: re-evaluating with unchanged data returns the same
  // policyHash + criteria, but the waived verdict persists.
  const prior = rel.gate_result_json ?? {};
  const waiver = prior.waivedBy ? {
    waivedBy: prior.waivedBy,
    waiverReason: prior.waiverReason,
    waivedAt: prior.waivedAt,
  } : {};

  const gateResult = {
    verdict: waiver.waivedBy ? ("waived" as const) : result.verdict,
    evaluatedAt: result.evaluatedAt,
    buildId: rel.target_build_id,
    criteria: result.criteria,
    blocking: result.blocking,
    policyHash: result.policyHash,
    ...waiver,
  };

  await query(
    "UPDATE releases SET gate_result_json = $1::jsonb, gate_decided_at = now() WHERE id = $2",
    [JSON.stringify(gateResult), input.releaseId],
  );

  await recordAudit({
    organizationId: input.organizationId,
    action: "gate.evaluated",
    entityType: "release",
    entityId: input.releaseId,
    metadata: { verdict: result.verdict, policyHash: result.policyHash, blocking: result.blocking },
  });

  await dispatchWebhook("gate.evaluated", { releaseId: input.releaseId, ...gateResult }, input.organizationId);

  return gateResult;
}

export async function overrideGate(input: {
  projectId: string;
  releaseId: string;
  justification: string;
  actorId: string;
  organizationId: string;
  ip?: string;
}) {
  if (!input.justification || input.justification.trim().length === 0) {
    throw err.validation("Override requires a justification");
  }
  const release = await query("SELECT * FROM releases WHERE id = $1 AND project_id = $2", [input.releaseId, input.projectId]);
  if (release.rows.length === 0) throw err.notFound("Release not found");
  const rel = release.rows[0];

  const actor = await query("SELECT email, full_name FROM users WHERE id = $1", [input.actorId]);
  const actorName = actor.rows[0]?.full_name ?? actor.rows[0]?.email ?? "unknown";

  const current = rel.gate_result_json ?? {};
  const waived = {
    ...current,
    verdict: "waived",
    waivedBy: { id: input.actorId, name: actorName },
    waiverReason: input.justification,
    waivedAt: new Date().toISOString(),
  };

  await query("UPDATE releases SET gate_result_json = $1::jsonb, gate_decided_by = $2, gate_decided_at = now() WHERE id = $3", [
    JSON.stringify(waived),
    input.actorId,
    input.releaseId,
  ]);

  await recordAudit({
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: "gate.override",
    entityType: "release",
    entityId: input.releaseId,
    metadata: { justification: input.justification },
    ip: input.ip,
  });

  return waived;
}

export async function releaseReport(projectId: string, releaseId: string) {
  const release = await getRelease(projectId, releaseId);
  const gateResult = release.gateResult;
  const coverage = release.targetBuildId ? await traceability(projectId, release.targetBuildId) : null;
  const openDefects = await query(
    "SELECT id, ref, title, severity, status FROM defects WHERE project_id = $1 AND status IN ('new','triaged','in_progress','reopened') ORDER BY severity DESC, created_at ASC",
    [projectId],
  );
  const runs = await query(
    `SELECT id, name, status, source, created_at FROM test_runs WHERE project_id = $1 AND build_id = $2 ORDER BY created_at ASC`,
    [projectId, release.targetBuildId],
  );

  return {
    release: {
      id: release.id,
      name: release.name,
      status: release.status,
      targetBuildId: release.targetBuildId,
      buildLabel: release.buildLabel,
    },
    gate: gateResult,
    coverage: coverage ? { coverage: coverage.coverage, gaps: coverage.gaps } : null,
    openDefects: openDefects.rows,
    runs: runs.rows,
  };
}

function toRelease(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    targetBuildId: r.target_build_id,
    buildLabel: r.build_label ?? null,
    plannedDate: r.planned_date,
    status: r.status,
    gatePolicy: r.gate_policy_json,
    gateResult: r.gate_result_json,
    gateDecidedBy: r.gate_decided_by,
    gateDecidedAt: r.gate_decided_at,
    createdAt: r.created_at,
  };
}
