import { randomUUID, randomBytes, createHash } from "node:crypto";
import { config } from "../config";
import { hashPassword } from "../util/password";
import { log } from "../util/logger";
import type { DB } from "./types";
import { flakeScoreOf } from "../intelligence/flake";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForDb(db: DB, timeoutMs = 80000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await db.query("SELECT 1");
      return;
    } catch (e) {
      lastErr = e;
      await sleep(1500);
    }
  }
  throw new Error(`Database unreachable after ${timeoutMs}ms: ${String(lastErr)}`);
}

interface SeedContext {
  orgId: string;
  ownerId: string;
  leadId: string;
  tester1Id: string;
  tester2Id: string;
  devId: string;
  viewerId: string;
  projectIds: string[];
}

async function ensureDemoUsers(db: DB): Promise<SeedContext> {
  // Idempotency guard: if the demo org already exists, nothing to do.
  const existing = await db.query("SELECT id FROM organizations WHERE slug = 'demo'");
  if (existing.rows.length > 0) {
    const orgId = existing.rows[0].id as string;
    const users = await db.query(
      "SELECT id, email FROM users WHERE organization_id = $1",
      [orgId],
    );
    const byEmail = new Map(users.rows.map((r) => [r.email, r.id]));
    const ownerId = byEmail.get(config.adminEmail) ?? "";
    return {
      orgId,
      ownerId,
      leadId: byEmail.get("lead@qa.local") ?? "",
      tester1Id: byEmail.get("tester1@qa.local") ?? "",
      tester2Id: byEmail.get("tester2@qa.local") ?? "",
      devId: byEmail.get("dev@qa.local") ?? "",
      viewerId: byEmail.get("viewer@qa.local") ?? "",
      projectIds: [],
    };
  }

  const orgId = randomUUID();
  await db.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1, 'QA Demo', 'demo')",
    [orgId],
  );

  const users: Array<{ id: string; email: string; fullName: string; role: string; password: string }> = [
    { id: randomUUID(), email: config.adminEmail, fullName: "Demo Admin", role: "owner", password: config.adminPassword },
    { id: randomUUID(), email: "lead@qa.local", fullName: "QA Lead", role: "qa_lead", password: "lead-password" },
    { id: randomUUID(), email: "tester1@qa.local", fullName: "Tester One", role: "tester", password: "tester-password" },
    { id: randomUUID(), email: "tester2@qa.local", fullName: "Tester Two", role: "tester", password: "tester-password" },
    { id: randomUUID(), email: "dev@qa.local", fullName: "Dev Developer", role: "developer", password: "dev-password" },
    { id: randomUUID(), email: "viewer@qa.local", fullName: "Viewer Viewer", role: "viewer", password: "viewer-password" },
  ];

  for (const u of users) {
    const hash = await hashPassword(u.password);
    await db.query(
      `INSERT INTO users (id, organization_id, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [u.id, orgId, u.email, hash, u.fullName, u.role],
    );
  }

  const ownerId = users.find((u) => u.role === "owner")!.id;
  const leadId = users.find((u) => u.role === "qa_lead")!.id;
  const tester1Id = users.find((u) => u.role === "tester" && u.fullName === "Tester One")!.id;
  const tester2Id = users.find((u) => u.role === "tester" && u.fullName === "Tester Two")!.id;
  const devId = users.find((u) => u.role === "developer")!.id;
  const viewerId = users.find((u) => u.role === "viewer")!.id;

  return {
    orgId,
    ownerId,
    leadId,
    tester1Id,
    tester2Id,
    devId,
    viewerId,
    projectIds: [],
  };
}

async function seedDemoData(db: DB, ctx: SeedContext): Promise<void> {
  const existingProj = await db.query(
    "SELECT id FROM projects WHERE organization_id = $1 AND key = 'WEB'",
    [ctx.orgId],
  );
  if (existingProj.rows.length > 0) return; // already seeded

  const projWeb = randomUUID();
  const projApi = randomUUID();
  await db.query(
    `INSERT INTO projects (id, organization_id, key, name, description, settings_json)
     VALUES ($1,$2,'WEB','Web App','Customer-facing web application','{"riskWeights":{"requirementCriticality":0.3,"recentFailureRate":0.25,"recencyOfCodeChange":0.2,"casePriority":0.2,"flakePenalty":0.05}}'),
            ($3,$2,'API','Platform API','Backend services and APIs','{"riskWeights":{"requirementCriticality":0.3,"recentFailureRate":0.25,"recencyOfCodeChange":0.2,"casePriority":0.2,"flakePenalty":0.05}}')`,
    [projWeb, ctx.orgId, projApi],
  );

  // Members: owner is implicit owner; grant the rest on WEB (and viewer on API).
  for (const [uid, role] of [
    [ctx.leadId, "qa_lead"],
    [ctx.tester1Id, "tester"],
    [ctx.tester2Id, "tester"],
    [ctx.devId, "developer"],
    [ctx.viewerId, "viewer"],
  ] as Array<[string, string]>) {
    await db.query(
      "INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1,$2,$3)",
      [projWeb, uid, role],
    );
  }
  await db.query(
    "INSERT INTO project_members (project_id, user_id, project_role) VALUES ($1,$2,'viewer')",
    [projApi, ctx.viewerId],
  );

  const envWeb = randomUUID();
  const envWebProd = randomUUID();
  const envApi = randomUUID();
  await db.query(
    `INSERT INTO environments (id, project_id, name, base_url) VALUES
      ($1,$2,'staging','https://staging.example.com'),
      ($3,$2,'production','https://app.example.com'),
      ($4,$5,'staging','https://api-staging.example.com')`,
    [envWeb, projWeb, envWebProd, envApi, projApi],
  );

  // ---- Requirements (24) ----
  const reqIds: string[] = [];
  const crit = ["low", "medium", "high", "critical"];
  const reqTitles = [
    "User authentication", "Session management", "Password reset", "Role-based access",
    "Checkout flow", "Payment capture", "Refund processing", "Cart persistence",
    "Product catalog", "Search relevance", "Order history", "Email notifications",
    "API authentication", "Rate limiting", "Webhook delivery", "Data export",
    "Reporting dashboard", "Audit trail", "User profiles", "Notification preferences",
    "Performance SLAs", "Security compliance", "Localization", "Accessibility",
  ];
  for (let i = 0; i < 24; i++) {
    const id = randomUUID();
    const project = i < 16 ? projWeb : projApi;
    reqIds.push(id);
    await db.query(
      `INSERT INTO requirements (id, project_id, ref, title, description, criticality, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active')`,
      [
        id,
        project,
        `REQ-${String(i + 1).padStart(3, "0")}`,
        reqTitles[i],
        `Requirement ${i + 1}`,
        crit[i % 4],
      ],
    );
  }

  // ---- Test cases (120) ----
  const folders = ["/auth", "/checkout", "/catalog", "/billing", "/api", "/reporting", "/security"];
  const types = ["functional", "regression", "smoke", "integration", "e2e", "performance", "security"];
  const caseIds: string[] = [];
  const caseReqMap = new Map<string, string[]>(); // caseId -> [reqIds]
  for (let i = 0; i < 120; i++) {
    const id = randomUUID();
    const project = i % 20 < 14 ? projWeb : projApi;
    const automated = i % 3 === 0 && i < 60; // 40 automated (first 60, every 3rd)
    const automationKey = automated ? `suite.${folders[i % folders.length].slice(1)}#test_${String(i + 1).padStart(4, "0")}` : null;
    caseIds.push(id);
    await db.query(
      `INSERT INTO test_cases (id, project_id, ref, title, current_version, folder_path, priority, type, automation_status, automation_key, owner_id)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        project,
        `TC-${String(i + 1).padStart(4, "0")}`,
        `Test case ${i + 1}: ${reqTitles[i % 24].toLowerCase()}`,
        folders[i % folders.length],
        crit[i % 4],
        types[i % types.length],
        automated ? "automated" : "manual",
        automationKey,
        [ctx.leadId, ctx.tester1Id, ctx.tester2Id, ctx.devId][i % 4],
      ],
    );
    const steps = [
      { index: 1, action: "Given the system is in a known state", expected: "System ready" },
      { index: 2, action: "When the primary action is performed", expected: "Action succeeds" },
      { index: 3, action: "Then the expected outcome is observed", expected: "Outcome matches" },
    ];
    await db.query(
      `INSERT INTO test_case_versions (id, test_case_id, version, title, preconditions, steps_json, expected_result, tags, estimated_minutes, authored_by)
       VALUES ($1,$2,1,$3,'Environment provisioned',$4::jsonb,'Expected outcome',ARRAY['demo'],5,$5)`,
      [randomUUID(), id, `Test case ${i + 1}`, JSON.stringify(steps), ctx.leadId],
    );
    // Link each case to 1-2 requirements
    const linkedReqs = [reqIds[i % 24]];
    if (i % 3 === 0) linkedReqs.push(reqIds[(i + 7) % 24]);
    caseReqMap.set(id, linkedReqs);
    for (const r of linkedReqs) {
      await db.query(
        "INSERT INTO case_requirements (test_case_id, requirement_id) VALUES ($1,$2)",
        [id, r],
      );
    }
  }

  // ---- Suites (6) ----
  const suiteNames = ["Smoke", "Regression", "Checkout", "Auth", "API Core", "Security"];
  const suiteIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = randomUUID();
    suiteIds.push(id);
    const project = i < 4 ? projWeb : projApi;
    await db.query(
      "INSERT INTO test_suites (id, project_id, name, description) VALUES ($1,$2,$3,$4)",
      [id, project, suiteNames[i], `${suiteNames[i]} suite`],
    );
    const start = i * 15;
    for (let j = 0; j < 15; j++) {
      const caseId = caseIds[(start + j) % caseIds.length];
      const caseProject = (caseIds.indexOf(caseId)) % 20 < 14 ? projWeb : projApi;
      if (caseProject !== project) continue;
      await db.query(
        "INSERT INTO suite_cases (suite_id, test_case_id, position) VALUES ($1,$2,$3)",
        [id, caseId, j],
      );
    }
  }

  // ---- Builds (8, over last 30 days) ----
  const buildIds: string[] = [];
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    const id = randomUUID();
    buildIds.push(id);
    const project = i < 6 ? projWeb : projApi;
    const daysAgo = 30 - i * 4;
    await db.query(
      `INSERT INTO builds (id, project_id, version_label, commit_sha, branch, created_at)
       VALUES ($1,$2,$3,$4,'main',$5)`,
      [
        id,
        project,
        `2.${i + 1}.0-rc${i % 3 + 1}`,
        randomBytes(20).toString("hex").slice(0, 40),
        new Date(now - daysAgo * 86400000).toISOString(),
      ],
    );
  }

  // ---- Runs + executions (~900) ----
  const runIds: string[] = [];
  const flakyCaseIds: string[] = [];
  const flakySignals: Array<{ caseId: string; total: number; transitions: number; score: number }> = [];

  for (let r = 0; r < 12; r++) {
    const runId = randomUUID();
    runIds.push(runId);
    const project = r < 8 ? projWeb : projApi;
    const buildId = buildIds[r % buildIds.length];
    const envId = project === projWeb ? envWeb : envApi;
    const status = r % 6 === 5 ? "aborted" : "completed";
    await db.query(
      `INSERT INTO test_runs (id, project_id, build_id, environment_id, name, source, status, started_at, completed_at, created_by)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9)`,
      [
        runId,
        project,
        buildId,
        envId,
        `Run ${r + 1}`,
        status,
        new Date(now - (12 - r) * 86400000).toISOString(),
        new Date(now - (12 - r) * 86400000 + 3600000).toISOString(),
        ctx.leadId,
      ],
    );

    // Pick 3 flaky cases (first 3 automated) with alternating outcomes.
    if (r === 0) flakyCaseIds.push(caseIds[3], caseIds[6], caseIds[9]);

    const execCount = 75;
    for (let e = 0; e < execCount; e++) {
      const caseIdx = (r * 37 + e * 17) % caseIds.length;
      const caseId = caseIds[caseIdx];
      const caseProject = caseIdx % 20 < 14 ? projWeb : projApi;
      if (caseProject !== project) continue;
      const versionRes = await db.query(
        "SELECT id FROM test_case_versions WHERE test_case_id = $1 ORDER BY version DESC LIMIT 1",
        [caseId],
      );
      const caseVersionId = versionRes.rows[0]?.id;
      if (!caseVersionId) continue;

      let execStatus = "passed";
      let flakeFlip = false;
      if (flakyCaseIds.includes(caseId)) {
        // alternate pass/fail across runs on the same commit -> transitions
        execStatus = (r + e) % 2 === 0 ? "passed" : "failed";
        flakeFlip = true;
      } else if (e % 7 === 0) {
        execStatus = "failed";
      } else if (e % 11 === 0) {
        execStatus = "skipped";
      } else if (e % 13 === 0) {
        execStatus = "blocked";
      }

      const failureSig = execStatus === "failed" ? createHash("sha256").update(`signature-${caseIdx}-${r}-${e}`).digest("hex") : null;
      await db.query(
        `INSERT INTO test_executions (id, run_id, test_case_id, case_version_id, status, duration_ms, executed_by, executed_at, comment, failure_signature, attempt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)`,
        [
          randomUUID(),
          runId,
          caseId,
          caseVersionId,
          execStatus,
          500 + ((r * e) % 5000),
          ctx.tester1Id,
          new Date(now - (12 - r) * 86400000 + e * 1000).toISOString(),
          execStatus === "failed" ? "AssertionError: expected true to be false" : null,
          failureSig,
        ],
      );
      if (flakeFlip) {
        // Track transitions for flake scoring across runs for these cases.
      }
    }

    // Compute flake signals for the 3 flaky cases after all runs.
    if (r === 11) {
      for (const fc of flakyCaseIds) {
        const execs = await db.query(
          `SELECT status, executed_at FROM test_executions WHERE test_case_id = $1 ORDER BY executed_at ASC`,
          [fc],
        );
        const outcomes = execs.rows.map((x) => x.status as string);
        const total = outcomes.length;
        let transitions = 0;
        for (let i = 1; i < outcomes.length; i++) {
          const prev = outcomes[i - 1] === "passed";
          const cur = outcomes[i] === "passed";
          if (prev !== cur && (outcomes[i - 1] === "passed" || outcomes[i] === "passed")) {
            transitions++;
          }
        }
        const score = flakeScoreOf({ totalRuns: total, transitions });
        await db.query(
          `INSERT INTO flaky_signals (test_case_id, window_start, window_end, total_runs, transitions, flake_score, verdict)
           VALUES ($1, now() - interval '30 days', now(), $2, $3, $4, $5)`,
          [fc, total, transitions, score, score > 0.2 ? "flaky" : score >= 0.05 ? "suspect" : "stable"],
        );
      }
    }
  }

  // ---- Defects (18 across every status) ----
  const defectStatuses = [
    "new", "new", "triaged", "in_progress", "in_progress", "resolved",
    "verified", "closed", "closed", "reopened", "wont_fix", "duplicate",
    "new", "triaged", "resolved", "verified", "in_progress", "closed",
  ];
  const severities = ["trivial", "minor", "major", "critical", "blocker", "major", "critical", "minor", "major", "critical", "minor", "major", "critical", "major", "major", "minor", "critical", "blocker"];
  const defectIds: string[] = [];
  for (let i = 0; i < 18; i++) {
    const id = randomUUID();
    defectIds.push(id);
    const project = i < 13 ? projWeb : projApi;
    const status = defectStatuses[i];
    const isOpen = ["new", "triaged", "in_progress", "reopened"].includes(status);
    await db.query(
      `INSERT INTO defects (id, project_id, ref, title, description, severity, priority, status, reported_by, assigned_to, found_in_build_id, escaped_to_prod)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        project,
        `BUG-${String(i + 1).padStart(4, "0")}`,
        `Defect ${i + 1}`,
        `Description for defect ${i + 1}`,
        severities[i],
        i % 4 === 0 ? "urgent" : i % 3 === 0 ? "high" : i % 2 === 0 ? "medium" : "low",
        status,
        ctx.devId,
        isOpen ? [ctx.devId, ctx.leadId][i % 2] : null,
        buildIds[i % buildIds.length],
        i === 10, // one escaped-to-prod defect
      ],
    );
    await db.query(
      `INSERT INTO defect_events (id, defect_id, actor_id, from_status, to_status, comment)
       VALUES ($1,$2,$3,NULL,$4,'Created')`,
      [randomUUID(), id, ctx.devId, status],
    );
  }
  // duplicate link
  await db.query("UPDATE defects SET duplicate_of_id = $1, resolution = 'duplicate' WHERE id = $2", [
    defectIds[0],
    defectIds[11],
  ]);

  // ---- Release in `testing` whose gate fails on two criteria ----
  const releaseId = randomUUID();
  await db.query(
    `INSERT INTO releases (id, project_id, name, target_build_id, status, gate_policy_json)
     VALUES ($1,$2,'Release 2.15.0',$3,'testing',$4::jsonb)`,
    [
      releaseId,
      projWeb,
      buildIds[0],
      JSON.stringify({
        minPassRate: 0.98,
        maxOpenBlockers: 0,
        maxOpenCritical: 0,
        minRequirementCoverage: 0.9,
        maxFlakyInSuite: 3,
        requiredSuites: ["Smoke", "Regression"],
      }),
    ],
  );

  await db.query(
    "UPDATE projects SET default_environment_id = $1 WHERE id = $2",
    [envWeb, projWeb],
  );

  log.info("seeded demo data", { org: "demo", projects: 2, cases: caseIds.length, runs: 12 });
}

export async function seed(db: DB, opts: { demoData?: boolean } = {}): Promise<SeedContext> {
  await waitForDb(db);
  const ctx = await ensureDemoUsers(db);
  if (opts.demoData !== false) {
    await seedDemoData(db, ctx);
    log.info("seed complete", { adminEmail: config.adminEmail });
  } else {
    log.info("seed complete (admin only)", { adminEmail: config.adminEmail });
  }
  return ctx;
}
