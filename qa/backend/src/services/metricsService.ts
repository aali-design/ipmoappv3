import { query } from "../db/client";
import { err } from "../util/errors";
import { computeRiskScore, normalizeWeights, type RiskWeights } from "../intelligence/risk";

// ---------- Traceability & coverage (spec §4.4) ----------

export type RequirementStatus = "covered_passing" | "covered_failing" | "covered_untested" | "uncovered";

const CRIT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export async function traceability(projectId: string, buildId?: string | null) {
  const reqs = await query(
    "SELECT id, ref, title, criticality, status FROM requirements WHERE project_id = $1 AND status = 'active' ORDER BY ref ASC",
    [projectId],
  );

  const links = await query(
    `SELECT cr.requirement_id, cr.test_case_id, c.ref AS case_ref, c.title AS case_title
     FROM case_requirements cr
     JOIN test_cases c ON c.id = cr.test_case_id
     JOIN requirements r ON r.id = cr.requirement_id
     WHERE r.project_id = $1 AND r.status = 'active' AND c.is_archived = false`,
    [projectId],
  );

  // Latest execution status per (case, build) — restricted to the build's runs.
  let execStatus = new Map<string, string>();
  if (buildId) {
    const execs = await query(
      `SELECT DISTINCT ON (e.test_case_id) e.test_case_id, e.status
       FROM test_executions e
       JOIN test_runs r ON r.id = e.run_id
       WHERE r.project_id = $1 AND r.build_id = $2
       ORDER BY e.test_case_id, e.executed_at DESC`,
      [projectId, buildId],
    );
    for (const e of execs.rows) execStatus.set(e.test_case_id, e.status);
  } else {
    const execs = await query(
      `SELECT DISTINCT ON (e.test_case_id) e.test_case_id, e.status
       FROM test_executions e
       JOIN test_runs r ON r.id = e.run_id
       WHERE r.project_id = $1
       ORDER BY e.test_case_id, e.executed_at DESC`,
      [projectId],
    );
    for (const e of execs.rows) execStatus.set(e.test_case_id, e.status);
  }

  const byReq = new Map<string, Array<{ testCaseId: string; caseRef: string; caseTitle: string; status: string }>>();
  for (const l of links.rows) {
    const arr = byReq.get(l.requirement_id) ?? [];
    arr.push({ testCaseId: l.test_case_id, caseRef: l.case_ref, caseTitle: l.case_title, status: execStatus.get(l.test_case_id) ?? "untested" });
    byReq.set(l.requirement_id, arr);
  }

  const matrix: Array<{ requirement: { id: string; ref: string; title: string; criticality: string }; status: RequirementStatus; cases: Array<{ testCaseId: string; caseRef: string; caseTitle: string; status: string }> }> = [];
  const gaps: Array<{ id: string; ref: string; title: string; criticality: string }> = [];
  let passingReqs = 0;

  for (const r of reqs.rows) {
    const cases = byReq.get(r.id) ?? [];
    let status: RequirementStatus = "uncovered";
    if (cases.length === 0) {
      status = "uncovered";
    } else if (cases.some((c) => c.status === "passed")) {
      status = "covered_passing";
      passingReqs++;
    } else if (cases.some((c) => c.status === "failed" || c.status === "blocked")) {
      status = "covered_failing";
    } else {
      status = "covered_untested";
    }
    if (status === "uncovered") gaps.push({ id: r.id, ref: r.ref, title: r.title, criticality: r.criticality });
    matrix.push({
      requirement: { id: r.id, ref: r.ref, title: r.title, criticality: r.criticality },
      status,
      cases,
    });
  }

  gaps.sort((a, b) => CRIT_RANK[b.criticality] - CRIT_RANK[a.criticality]);
  const activeCount = reqs.rows.length;
  const coverage = activeCount > 0 ? Math.round((passingReqs / activeCount) * 10000) / 10000 : 0;

  return { matrix, gaps, coverage, totalRequirements: activeCount, passingRequirements: passingReqs, buildId: buildId ?? null };
}

// ---------- Suggested order (spec §4.3) ----------

export async function suggestedOrder(projectId: string) {
  const proj = await query("SELECT settings_json FROM projects WHERE id = $1", [projectId]);
  if (proj.rows.length === 0) throw err.notFound("Project not found");
  const weights: RiskWeights = normalizeWeights(proj.rows[0].settings_json?.riskWeights);

  const cases = await query(
    "SELECT id, ref, title, priority, folder_path, updated_at FROM test_cases WHERE project_id = $1 AND is_archived = false",
    [projectId],
  );
  const caseIds = cases.rows.map((c) => c.id);
  if (caseIds.length === 0) return { items: [], weights };

  const critRes = await query(
    `SELECT cr.test_case_id,
            MAX(CASE r.criticality WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END) AS crit
     FROM case_requirements cr JOIN requirements r ON r.id = cr.requirement_id
     WHERE cr.test_case_id = ANY($1::uuid[]) GROUP BY cr.test_case_id`,
    [caseIds],
  );
  const critMap = new Map<string, string>();
  const critName = ["", "low", "medium", "high", "critical"];
  for (const r of critRes.rows) critMap.set(r.test_case_id, critName[r.crit] ?? "low");

  const failRes = await query(
    `SELECT test_case_id,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status IN ('passed','failed') THEN 1 ELSE 0 END) AS total
     FROM test_executions WHERE test_case_id = ANY($1::uuid[]) AND executed_at > now() - interval '90 days'
     GROUP BY test_case_id`,
    [caseIds],
  );
  const failMap = new Map<string, number>();
  for (const r of failRes.rows) failMap.set(r.test_case_id, Number(r.total) > 0 ? Number(r.failed) / Number(r.total) : 0);

  const flakeRes = await query(
    `SELECT DISTINCT ON (test_case_id) test_case_id, flake_score
     FROM flaky_signals WHERE test_case_id = ANY($1::uuid[]) ORDER BY test_case_id, computed_at DESC`,
    [caseIds],
  );
  const flakeMap = new Map<string, number>();
  for (const r of flakeRes.rows) flakeMap.set(r.test_case_id, Number(r.flake_score));

  const buildRes = await query(
    `SELECT e.test_case_id, MAX(b.created_at) AS latest
     FROM test_executions e
     JOIN test_runs r ON r.id = e.run_id
     JOIN builds b ON b.id = r.build_id
     WHERE e.test_case_id = ANY($1::uuid[])
     GROUP BY e.test_case_id`,
    [caseIds],
  );
  const buildMap = new Map<string, string>();
  for (const r of buildRes.rows) buildMap.set(r.test_case_id, r.latest);

  const now = Date.now();
  const items = cases.rows.map((c) => {
    const recentFailureRate = failMap.get(c.id) ?? 0;
    const latestBuild = buildMap.get(c.id);
    const refDate = latestBuild ? new Date(latestBuild).getTime() : new Date(c.updated_at).getTime();
    const daysSince = (now - refDate) / 86400000;
    const recencyOfCodeChange = Math.max(0, Math.min(1, 1 - daysSince / 30));
    const result = computeRiskScore(
      {
        requirementCriticality: critMap.get(c.id) ?? "low",
        recentFailureRate,
        recencyOfCodeChange,
        casePriority: c.priority,
        flakeScore: flakeMap.get(c.id) ?? 0,
      },
      weights,
    );
    return {
      testCaseId: c.id,
      ref: c.ref,
      title: c.title,
      folderPath: c.folder_path,
      priority: c.priority,
      riskScore: result.riskScore,
      factors: result.factors,
    };
  });

  items.sort((a, b) => b.riskScore - a.riskScore);
  return { items, weights };
}

// ---------- Quality metrics (spec §4.5, SQL-computed) ----------

export async function metrics(projectId: string) {
  const passRateTrend = await query(
    `SELECT b.version_label AS build, b.id AS build_id,
            SUM(CASE WHEN e.status='passed' THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN e.status IN ('passed','failed','blocked') THEN 1 ELSE 0 END) AS executed
     FROM builds b
     JOIN test_runs r ON r.build_id = b.id
     JOIN test_executions e ON e.run_id = r.id
     WHERE b.project_id = $1
     GROUP BY b.id, b.version_label
     ORDER BY b.created_at ASC`,
    [projectId],
  );
  const trend = passRateTrend.rows.map((r) => ({
    build: r.build,
    buildId: r.build_id,
    passRate: Number(r.executed) > 0 ? Math.round((Number(r.passed) / Number(r.executed)) * 10000) / 10000 : null,
    passed: Number(r.passed),
    executed: Number(r.executed),
  }));

  const defectDensity = await query(
    `SELECT (SELECT COUNT(*)::int FROM defects WHERE project_id = $1) AS defects,
            (SELECT COUNT(*)::int FROM test_executions e JOIN test_runs r ON r.id = e.run_id WHERE r.project_id = $1) AS executed`,
    [projectId],
  );
  const density = Number(defectDensity.rows[0].executed) > 0
    ? Math.round((Number(defectDensity.rows[0].defects) / Number(defectDensity.rows[0].executed)) * 10000) / 10000
    : 0;

  const mttr = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)))::float AS mttr_sec FROM defects WHERE project_id = $1 AND resolved_at IS NOT NULL`,
    [projectId],
  );
  const mttd = await query(
    `SELECT AVG(EXTRACT(EPOCH FROM (first_seen_at - created_at)))::float AS mttd_sec FROM defects WHERE project_id = $1 AND first_seen_at IS NOT NULL`,
    [projectId],
  );

  const reopenRate = await query(
    `SELECT (SELECT COUNT(*)::int FROM defect_events de JOIN defects d ON d.id = de.defect_id WHERE d.project_id = $1 AND de.to_status = 'reopened') AS reopened,
            (SELECT COUNT(*)::int FROM defect_events de JOIN defects d ON d.id = de.defect_id WHERE d.project_id = $1 AND de.to_status = 'resolved') AS resolved`,
    [projectId],
  );
  const reopen = Number(reopenRate.rows[0].resolved) > 0 ? Number(reopenRate.rows[0].reopened) / Number(reopenRate.rows[0].resolved) : 0;

  const escape = await query(
    `SELECT (SELECT COUNT(*)::int FROM defects WHERE project_id = $1 AND escaped_to_prod = true) AS escaped,
            (SELECT COUNT(*)::int FROM defects WHERE project_id = $1) AS total`,
    [projectId],
  );
  const escapeRate = Number(escape.rows[0].total) > 0 ? Number(escape.rows[0].escaped) / Number(escape.rows[0].total) : 0;

  const openBySeverity = await query(
    `SELECT severity, COUNT(*)::int AS n FROM defects WHERE project_id = $1 AND status IN ('new','triaged','in_progress','reopened') GROUP BY severity`,
    [projectId],
  );

  const burnDown = await query(
    `SELECT r.id, r.name, r.status, r.stats_json, r.created_at,
            (SELECT COUNT(*)::int FROM test_executions e WHERE e.run_id = r.id AND e.status = 'untested') AS remaining
     FROM test_runs r
     JOIN test_plans p ON p.id = r.plan_id
     WHERE r.project_id = $1 AND p.status = 'active'
     ORDER BY r.created_at ASC LIMIT 20`,
    [projectId],
  );

  const flakiest = await query(
    `SELECT DISTINCT ON (c.id) c.id AS case_id, c.ref, c.title, fs.flake_score, fs.verdict
     FROM flaky_signals fs JOIN test_cases c ON c.id = fs.test_case_id
     WHERE c.project_id = $1 ORDER BY c.id, fs.computed_at DESC`,
    [projectId],
  );
  flakiest.rows.sort((a: any, b: any) => Number(b.flake_score) - Number(a.flake_score));

  return {
    passRateTrend: trend,
    defectDensity: density,
    totalDefects: Number(defectDensity.rows[0].defects),
    meanTimeToResolveSeconds: mttr.rows[0]?.mttr_sec ?? null,
    meanTimeToDetectSeconds: mttd.rows[0]?.mttd_sec ?? null,
    reopenRate: Math.round(reopen * 10000) / 10000,
    escapeRate: Math.round(escapeRate * 10000) / 10000,
    openDefectsBySeverity: Object.fromEntries(openBySeverity.rows.map((r: any) => [r.severity, Number(r.n)])),
    activePlanBurnDown: burnDown.rows.map((r) => ({
      runId: r.id,
      name: r.name,
      status: r.status,
      remaining: Number(r.remaining),
      createdAt: r.created_at,
    })),
    topFlakyCases: flakiest.rows.slice(0, 10).map((r: any) => ({
      caseId: r.case_id,
      ref: r.ref,
      title: r.title,
      flakeScore: Number(r.flake_score),
      verdict: r.verdict,
    })),
  };
}
