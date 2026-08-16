import { createHash, randomUUID } from "node:crypto";
import { query, withTransaction } from "../db/client";
import { err } from "../util/errors";
import { parseReport, ParseError, type IngestFormat, type ParsedTest } from "../parsers";
import { failureSignature } from "../intelligence/signature";
import { refreshRunStats } from "./runService";
import { recomputeFlakyForCase } from "./flakyService";
import { dispatchWebhook } from "./webhookService";

export interface IngestInput {
  format: IngestFormat;
  content: Buffer;
  projectKey: string;
  buildLabel: string;
  commitSha?: string;
  branch?: string;
  environment: string;
  runName?: string;
  autoCreateCases?: boolean;
  apiKey: { id: string; organizationId: string; projectId: string | null };
}

const contentHash = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export async function ingest(input: IngestInput) {
  const hash = contentHash(input.content);

  const proj = await query(
    "SELECT id, organization_id, key FROM projects WHERE key = $1 AND organization_id = $2",
    [input.projectKey, input.apiKey.organizationId],
  );
  if (proj.rows.length === 0) throw err.notFound(`Project '${input.projectKey}' not found`);
  const projectId = proj.rows[0].id as string;
  if (input.apiKey.projectId && input.apiKey.projectId !== projectId) {
    throw err.forbidden("API key is not scoped to this project");
  }

  // ---- Parse (robust: 400 with position, never 500) ----
  let parsed;
  try {
    parsed = parseReport(input.format, input.content.toString("utf8"));
  } catch (e) {
    if (e instanceof ParseError) {
      throw err.badRequest(e.message, { position: e.position });
    }
    throw e;
  }

  // ---- Build (create or reuse by project + version_label) ----
  let buildId: string;
  const build = await query("SELECT id FROM builds WHERE project_id = $1 AND version_label = $2", [
    projectId,
    input.buildLabel,
  ]);
  if (build.rows.length > 0) {
    buildId = build.rows[0].id;
    await query(
      "UPDATE builds SET commit_sha = COALESCE($1, commit_sha), branch = COALESCE($2, branch) WHERE id = $3",
      [input.commitSha ?? null, input.branch ?? null, buildId],
    );
  } else {
    buildId = randomUUID();
    await query(
      "INSERT INTO builds (id, project_id, version_label, commit_sha, branch) VALUES ($1,$2,$3,$4,$5)",
      [buildId, projectId, input.buildLabel, input.commitSha ?? null, input.branch ?? null],
    );
  }

  // ---- Idempotency: same content for same build+format -> dedup ----
  const dup = await query(
    "SELECT id, run_id, parsed_count, matched_count, unmatched_count FROM ingestion_batches WHERE project_id = $1 AND build_id = $2 AND format = $3 AND content_hash = $4",
    [projectId, buildId, input.format, hash],
  );
  if (dup.rows.length > 0) {
    const d = dup.rows[0];
    return {
      deduplicated: true,
      batchId: d.id,
      runId: d.run_id,
      parsed: Number(d.parsed_count),
      matched: Number(d.matched_count),
      unmatched: Number(d.unmatched_count),
    };
  }

  // ---- Environment (find or create by name) ----
  let environmentId: string;
  const env = await query("SELECT id FROM environments WHERE project_id = $1 AND name = $2", [projectId, input.environment]);
  if (env.rows.length > 0) {
    environmentId = env.rows[0].id;
  } else {
    environmentId = randomUUID();
    await query("INSERT INTO environments (id, project_id, name) VALUES ($1,$2,$3)", [environmentId, projectId, input.environment]);
  }

  // ---- Case matching ----
  const cases = await query(
    "SELECT id, automation_key, ref, current_version FROM test_cases WHERE project_id = $1 AND is_archived = false",
    [projectId],
  );
  const byAutomationKey = new Map<string, { id: string; currentVersion: number }>();
  for (const c of cases.rows) {
    if (c.automation_key) byAutomationKey.set(c.automation_key, { id: c.id, currentVersion: c.current_version });
  }
  const byId = new Map<string, { id: string; currentVersion: number }>();
  for (const c of cases.rows) byId.set(c.id, { id: c.id, currentVersion: c.current_version });

  const unmatched: ParsedTest[] = [];
  const matched: Array<{ test: ParsedTest; caseId: string }> = [];

  for (const t of parsed.tests) {
    const key = t.automationKey || t.derivedKey;
    let hit = t.automationKey ? byAutomationKey.get(t.automationKey) : undefined;
    if (!hit) hit = byAutomationKey.get(t.derivedKey);
    if (!hit) hit = byAutomationKey.get(key);
    if (hit) {
      matched.push({ test: t, caseId: hit.id });
    } else {
      unmatched.push(t);
    }
  }

  // ---- Auto-create unmatched cases ----
  const batchId = randomUUID();
  const runId = randomUUID();

  await withTransaction(async (tx) => {
    if (input.autoCreateCases && unmatched.length) {
      for (const t of unmatched) {
        const caseId = randomUUID();
        const automationKey = t.automationKey || t.derivedKey;
        const existing = await tx.query("SELECT id FROM test_cases WHERE project_id = $1 AND automation_key = $2", [projectId, automationKey]);
        if (existing.rows.length > 0) {
          matched.push({ test: t, caseId: existing.rows[0].id });
          continue;
        }
        await tx.query(
          `INSERT INTO test_cases (id, project_id, ref, title, current_version, folder_path, priority, type, automation_status, automation_key)
           VALUES ($1,$2,$3,$4,1,'/_ingested','medium','functional','automated',$5)`,
          [caseId, projectId, `TC-ING-${randomUUID().slice(0, 8)}`, t.testName || "Ingested case", automationKey],
        );
        await tx.query(
          "INSERT INTO test_case_versions (id, test_case_id, version, title, steps_json) VALUES ($1,$2,1,$3,'[]'::jsonb)",
          [randomUUID(), caseId, t.testName || "Ingested case"],
        );
        matched.push({ test: t, caseId });
        byAutomationKey.set(automationKey, { id: caseId, currentVersion: 1 });
      }
      unmatched.length = 0;
    }

    await tx.query(
      `INSERT INTO test_runs (id, project_id, build_id, environment_id, name, source, status, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,'ci','completed',now(),now())`,
      [runId, projectId, buildId, environmentId, input.runName ?? `${input.format} ingest ${input.buildLabel}`],
    );

    await tx.query(
      `INSERT INTO ingestion_batches (id, project_id, build_id, run_id, format, raw_size_bytes, parsed_count, matched_count, unmatched_count, unmatched_json, status, content_hash, created_by_key_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'completed',$11,$12)`,
      [
        batchId,
        projectId,
        buildId,
        runId,
        input.format,
        input.content.length,
        parsed.tests.length,
        matched.length,
        unmatched.length,
        JSON.stringify(unmatched.map((u) => ({ key: u.automationKey || u.derivedKey, suite: u.suiteName, className: u.className, testName: u.testName, status: u.status }))),
        hash,
        input.apiKey.id,
      ],
    );

    for (const m of matched) {
      const versionRes = await tx.query(
        "SELECT id FROM test_case_versions WHERE test_case_id = $1 ORDER BY version DESC LIMIT 1",
        [m.caseId],
      );
      const caseVersionId = versionRes.rows[0]?.id;
      if (!caseVersionId) continue;
      const sig = m.test.status === "failed"
        ? failureSignature({
            errorType: "assertion",
            message: m.test.message ?? "failure",
            frames: m.test.stack ? [m.test.stack] : [],
          })
        : null;
      await tx.query(
        `INSERT INTO test_executions (id, run_id, test_case_id, case_version_id, status, duration_ms, executed_at, comment, step_results_json, automation_ref, failure_signature, attempt)
         VALUES ($1,$2,$3,$4,$5,$6,now(),$7,$8::jsonb,$9,$10,1)`,
        [
          randomUUID(),
          runId,
          m.caseId,
          caseVersionId,
          m.test.status,
          m.test.durationMs ?? null,
          m.test.status === "failed" ? m.test.message ?? null : null,
          JSON.stringify({ message: m.test.message ?? null, stack: m.test.stack ?? null }),
          m.test.automationKey || m.test.derivedKey,
          sig,
        ],
      );
    }
  });

  await refreshRunStats(runId);

  // Recompute flakiness for affected cases.
  const affected = new Set<string>(matched.map((m) => m.caseId));
  for (const caseId of affected) {
    await recomputeFlakyForCase(caseId);
  }

  await dispatchWebhook(
    "run.completed",
    {
      runId,
      projectId,
      buildId,
      parsed: parsed.tests.length,
      matched: matched.length,
      unmatched: unmatched.length,
    },
    input.apiKey.organizationId,
  );

  return {
    deduplicated: false,
    batchId,
    runId,
    parsed: parsed.tests.length,
    matched: matched.length,
    unmatched: unmatched.length,
  };
}

export async function getBatch(projectId: string, batchId: string) {
  const res = await query(
    "SELECT * FROM ingestion_batches WHERE id = $1 AND project_id = $2",
    [batchId, projectId],
  );
  if (res.rows.length === 0) throw err.notFound("Batch not found");
  const b = res.rows[0];
  return {
    id: b.id,
    projectId: b.project_id,
    buildId: b.build_id,
    runId: b.run_id,
    format: b.format,
    rawSizeBytes: b.raw_size_bytes,
    parsedCount: b.parsed_count,
    matchedCount: b.matched_count,
    unmatchedCount: b.unmatched_count,
    unmatched: b.unmatched_json,
    status: b.status,
    errorMessage: b.error_message,
    createdAt: b.created_at,
  };
}

export async function listBatches(projectId: string) {
  const res = await query(
    "SELECT id, project_id, build_id, run_id, format, parsed_count, matched_count, unmatched_count, status, created_at FROM ingestion_batches WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100",
    [projectId],
  );
  return res.rows.map((b) => ({
    id: b.id,
    buildId: b.build_id,
    runId: b.run_id,
    format: b.format,
    parsedCount: b.parsed_count,
    matchedCount: b.matched_count,
    unmatchedCount: b.unmatched_count,
    status: b.status,
    createdAt: b.created_at,
  }));
}
