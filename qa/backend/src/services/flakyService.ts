import { randomUUID } from "node:crypto";
import { query } from "../db/client";
import { err } from "../util/errors";
import { countSameCommitTransitions, flakeVerdict, computeFlakeScore, type CommitOutcome } from "../intelligence/flake";

export async function recomputeFlakyForCase(caseId: string): Promise<void> {
  const execs = await query(
    `SELECT e.status, b.commit_sha
     FROM test_executions e
     JOIN test_runs r ON r.id = e.run_id
     LEFT JOIN builds b ON b.id = r.build_id
     WHERE e.test_case_id = $1
     ORDER BY e.executed_at ASC`,
    [caseId],
  );
  const history: CommitOutcome[] = execs.rows.map((r) => ({
    outcome: r.status,
    commitSha: r.commit_sha ?? null,
  }));
  const recent = history.slice(-30);
  const totalRuns = recent.length;
  const transitions = countSameCommitTransitions(recent);
  const score = computeFlakeScore(totalRuns, transitions);
  const verdict = flakeVerdict(score);

  await query(
    `INSERT INTO flaky_signals (id, test_case_id, window_start, window_end, total_runs, transitions, flake_score, verdict, computed_at)
     VALUES ($1,$2,now() - interval '30 days', now(), $3, $4, $5, $6, now())
     ON CONFLICT (id) DO NOTHING`,
    [randomUUID(), caseId, totalRuns, transitions, score, verdict],
  );
}

export async function recomputeFlakyForProject(projectId: string): Promise<number> {
  const cases = await query("SELECT id FROM test_cases WHERE project_id = $1", [projectId]);
  for (const c of cases.rows) {
    await recomputeFlakyForCase(c.id);
  }
  return cases.rows.length;
}

export async function listFlaky(projectId: string) {
  const res = await query(
    `SELECT fs.test_case_id, fs.total_runs, fs.transitions, fs.flake_score, fs.verdict, fs.computed_at,
            c.ref, c.title, c.folder_path, c.automation_status,
            q.reason AS quarantine_reason, q.quarantined_at, q.linked_defect_id
     FROM flaky_signals fs
     JOIN test_cases c ON c.id = fs.test_case_id
     LEFT JOIN quarantine q ON q.test_case_id = c.id AND q.released_at IS NULL
     WHERE c.project_id = $1
       AND fs.id = (SELECT id FROM flaky_signals WHERE test_case_id = c.id ORDER BY computed_at DESC LIMIT 1)
     ORDER BY fs.flake_score DESC`,
    [projectId],
  );
  return res.rows.map((f) => ({
    testCaseId: f.test_case_id,
    ref: f.ref,
    title: f.title,
    folderPath: f.folder_path,
    flakeScore: Number(f.flake_score),
    verdict: f.verdict,
    totalRuns: f.total_runs,
    transitions: f.transitions,
    computedAt: f.computed_at,
    quarantined: !!f.quarantine_reason,
    quarantineReason: f.quarantine_reason ?? null,
  }));
}

export async function quarantineCase(input: {
  projectId: string;
  caseId: string;
  reason: string;
  actorId?: string | null;
  linkedDefectId?: string | null;
}) {
  const c = await query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [input.caseId, input.projectId]);
  if (c.rows.length === 0) throw err.notFound("Test case not found");
  const existing = await query("SELECT id FROM quarantine WHERE test_case_id = $1 AND released_at IS NULL", [input.caseId]);
  if (existing.rows.length > 0) throw err.conflict("Case is already quarantined");
  await query(
    "INSERT INTO quarantine (id, test_case_id, reason, quarantined_by, linked_defect_id) VALUES ($1,$2,$3,$4,$5)",
    [randomUUID(), input.caseId, input.reason, input.actorId ?? null, input.linkedDefectId ?? null],
  );
  return { testCaseId: input.caseId, quarantined: true };
}

export async function releaseQuarantine(projectId: string, caseId: string) {
  const c = await query("SELECT id FROM test_cases WHERE id = $1 AND project_id = $2", [caseId, projectId]);
  if (c.rows.length === 0) throw err.notFound("Test case not found");
  await query("UPDATE quarantine SET released_at = now() WHERE test_case_id = $1 AND released_at IS NULL", [caseId]);
  return { testCaseId: caseId, quarantined: false };
}

export async function getQuarantine(projectId: string, caseId: string) {
  const res = await query(
    "SELECT * FROM quarantine WHERE test_case_id = $1 AND released_at IS NULL",
    [caseId],
  );
  return res.rows[0]
    ? { testCaseId: caseId, quarantined: true, reason: res.rows[0].reason, quarantinedAt: res.rows[0].quarantined_at }
    : { testCaseId: caseId, quarantined: false };
}

export async function listQuarantinedCaseIds(projectId: string): Promise<string[]> {
  const res = await query(
    `SELECT q.test_case_id FROM quarantine q
     JOIN test_cases c ON c.id = q.test_case_id
     WHERE c.project_id = $1 AND q.released_at IS NULL`,
    [projectId],
  );
  return res.rows.map((r) => r.test_case_id);
}
