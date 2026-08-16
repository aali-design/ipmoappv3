import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { setDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seed } from "../../src/db/seed";
import { createApp } from "../../src/app";
import { createPGliteDb } from "./pglite";
import type { DB } from "../../src/db/types";

const fixture = (name: string) => readFileSync(join(__dirname, "..", "fixtures", name), "utf8");

let app: ReturnType<typeof createApp>;
let db: DB;
let close: () => Promise<void>;
let adminToken: string;
let testerToken: string;

let projectId: string;
let environmentId: string;
let reqIds: string[] = [];
let caseIds: string[] = [];
let runId: string;
let executionIds: string[] = [];

describe("QA acceptance (§10 happy path over real HTTP)", () => {
  beforeAll(async () => {
    const created = await createPGliteDb();
    db = created.db;
    close = created.close;
    setDb(db);
    await runMigrations(db);
    await seed(db, { demoData: false });
    app = createApp();

    const login = await request(app).post("/api/auth/login").send({ email: "admin@qa.local", password: "admin-password" });
    expect(login.status).toBe(200);
    adminToken = login.body.accessToken;

    // Create a second user (tester) for the self-verification check.
    await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({
      email: "tester@qa.local",
      password: "tester-password",
      fullName: "Tester",
      role: "tester",
    });
    const testerLogin = await request(app).post("/api/auth/login").send({ email: "tester@qa.local", password: "tester-password" });
    testerToken = testerLogin.body.accessToken;
  });

  afterAll(async () => {
    await close();
  });

  it("1. health returns ok/db up", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.db).toBe("up");
  });

  it("2. admin login works", () => {
    expect(adminToken).toBeTruthy();
  });

  it("3. creates a project", async () => {
    const res = await request(app).post("/api/projects").set("Authorization", `Bearer ${adminToken}`).send({ key: "WEB", name: "Web App" });
    expect(res.status).toBe(201);
    projectId = res.body.id;
  });

  it("adds tester to project and creates an environment", async () => {
    await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ email: "tester@qa.local", projectRole: "tester" });
    const env = await request(app).post(`/api/projects/${projectId}/environments`).set("Authorization", `Bearer ${adminToken}`).send({ name: "staging" });
    expect(env.status).toBe(201);
    environmentId = env.body.id;
  });

  it("4. creates two requirements", async () => {
    for (const [ref, title] of [["REQ-001", "Login"], ["REQ-002", "Checkout"]]) {
      const res = await request(app).post(`/api/projects/${projectId}/requirements`).set("Authorization", `Bearer ${adminToken}`).send({ ref, title, criticality: "high" });
      expect(res.status).toBe(201);
      reqIds.push(res.body.id);
    }
  });

  it("5. creates three cases with steps (current_version 1) and links them", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post(`/api/projects/${projectId}/cases`).set("Authorization", `Bearer ${adminToken}`).send({
        title: `Case ${i + 1}`,
        steps: [{ index: 1, action: "Given x", expected: "y" }],
        type: "functional",
        priority: "high",
      });
      expect(res.status).toBe(201);
      expect(res.body.currentVersion).toBe(1);
      caseIds.push(res.body.id);
      // Link to REQ-001 only; REQ-002 stays uncovered (for traceability gaps).
      await request(app).post(`/api/cases/${res.body.id}/requirements`).set("Authorization", `Bearer ${adminToken}`).send({ requirementIds: [reqIds[0]] });
    }
  });

  it("6. editing a case creates version 2; version 1 is immutable", async () => {
    const patch = await request(app).patch(`/api/cases/${caseIds[0]}`).set("Authorization", `Bearer ${adminToken}`).send({
      steps: [{ index: 1, action: "Given x (updated)", expected: "z" }],
    });
    expect(patch.status).toBe(200);
    expect(patch.body.currentVersion).toBe(2);

    const v1 = await request(app).get(`/api/cases/${caseIds[0]}/versions/1`).set("Authorization", `Bearer ${adminToken}`);
    expect(v1.status).toBe(200);
    expect(v1.body.steps[0].action).toBe("Given x");
    expect(v1.body.steps[0].expected).toBe("y");
  });

  it("7. creates a run from a suite, pinned to current versions", async () => {
    const suite = await request(app).post(`/api/projects/${projectId}/suites`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Smoke" });
    await request(app).post(`/api/suites/${suite.body.id}/cases`).set("Authorization", `Bearer ${adminToken}`).send({ caseIds });

    const res = await request(app).post(`/api/projects/${projectId}/runs`).set("Authorization", `Bearer ${adminToken}`).send({
      suiteId: suite.body.id,
      environmentId,
      name: "Smoke run",
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("planned");
    expect(res.body.executionCount).toBe(3);
    runId = res.body.id;

    const execs = await request(app).get(`/api/runs/${runId}/executions`).set("Authorization", `Bearer ${adminToken}`);
    executionIds = execs.body.map((e: any) => e.id);
    expect(executionIds).toHaveLength(3);
  });

  it("8. completing a planned run with untested executions is rejected", async () => {
    const res = await request(app).post(`/api/runs/${runId}/complete`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect([409, 422]).toContain(res.status);
    expect(res.body.error).toMatch(/InvalidTransition|RuleViolation/);
  });

  it("9. starts, executes, and completes the run with correct stats", async () => {
    await request(app).post(`/api/runs/${runId}/start`).set("Authorization", `Bearer ${adminToken}`).send({});

    await request(app).patch(`/api/executions/${executionIds[0]}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "passed" });
    await request(app).patch(`/api/executions/${executionIds[1]}`).set("Authorization", `Bearer ${adminToken}`).send({
      status: "failed",
      comment: "AssertionError: expected 200 but got 500",
      stepResults: [{ index: 1, action: "Given x", status: "failed", actual: "500", stack: "at test.ts:42" }],
    });
    await request(app).patch(`/api/executions/${executionIds[2]}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "blocked" });

    const complete = await request(app).post(`/api/runs/${runId}/complete`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("completed");
    expect(complete.body.stats.passed).toBe(1);
    expect(complete.body.stats.failed).toBe(1);
    expect(complete.body.stats.blocked).toBe(1);
  });

  it("10. completed run executions are immutable (423 RunCompleted)", async () => {
    const res = await request(app).patch(`/api/executions/${executionIds[0]}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "failed" });
    expect(res.status).toBe(423);
    expect(res.body.error).toBe("RunCompleted");
  });

  it("11. creates a defect from the failed execution with evidence links", async () => {
    const res = await request(app).post("/api/defects").set("Authorization", `Bearer ${adminToken}`).send({
      projectId,
      fromExecutionIds: [executionIds[1]],
      severity: "critical",
    });
    expect(res.status).toBe(201);
    expect(res.body.description).toContain("AssertionError");
    expect(res.body.linkedExecutions).toHaveLength(1);
  });

  it("12. defect self-verification is forbidden (409)", async () => {
    const defectId = (await request(app).get(`/api/projects/${projectId}/defects`).set("Authorization", `Bearer ${adminToken}`)).body[0].id;

    // new -> in_progress -> resolved (as admin/owner)
    await request(app).patch(`/api/defects/${defectId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "in_progress" });
    await request(app).patch(`/api/defects/${defectId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "resolved" });

    const selfVerify = await request(app).patch(`/api/defects/${defectId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "verified" });
    expect(selfVerify.status).toBe(409);
    expect(selfVerify.body.error).toBe("SelfVerificationForbidden");

    const otherVerify = await request(app).patch(`/api/defects/${defectId}`).set("Authorization", `Bearer ${testerToken}`).send({ status: "verified" });
    expect(otherVerify.status).toBe(200);
  });

  describe("CI ingestion + gate", () => {
    let apiKey: string;
    let mainBuildId: string;

    it("13. ingests a JUnit report with an API key", async () => {
      const keyRes = await request(app).post("/api/api-keys").set("Authorization", `Bearer ${adminToken}`).send({ name: "ci" });
      apiKey = keyRes.body.key;

      const res = await request(app)
        .post(`/api/ingest/junit?projectKey=WEB&buildLabel=2.0.0&commitSha=abcdef1234567890&branch=main&environment=ci&autoCreateCases=true`)
        .set("X-API-Key", apiKey)
        .set("Content-Type", "application/xml")
        .send(fixture("junit-10-tests-2-failures.xml"));

      expect(res.status).toBe(202);
      expect(res.body.deduplicated).toBe(false);
      expect(res.body.parsed).toBe(10);
      expect(res.body.matched + res.body.unmatched).toBe(10);

      const batch = await request(app).get(`/api/ingest/batches/${res.body.batchId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(batch.status).toBe(200);
      expect(batch.body.matchedCount + batch.body.unmatchedCount).toBe(10);
      mainBuildId = batch.body.buildId;

      // A source:ci run with 10 executions exists for this build.
      const runs = await request(app).get(`/api/projects/${projectId}/runs?buildId=${mainBuildId}`).set("Authorization", `Bearer ${adminToken}`);
      const ciRun = runs.body.find((r: any) => r.source === "ci");
      expect(ciRun).toBeTruthy();
      const execs = await request(app).get(`/api/runs/${ciRun.id}/executions`).set("Authorization", `Bearer ${adminToken}`);
      expect(execs.body).toHaveLength(10);
    });

    it("14. re-posting the identical report is idempotent", async () => {
      const res = await request(app)
        .post(`/api/ingest/junit?projectKey=WEB&buildLabel=2.0.0&commitSha=abcdef1234567890&branch=main&environment=ci&autoCreateCases=true`)
        .set("X-API-Key", apiKey)
        .set("Content-Type", "application/xml")
        .send(fixture("junit-10-tests-2-failures.xml"));
      expect(res.status).toBe(200);
      expect(res.body.deduplicated).toBe(true);
    });

    it("15. alternating results on the same commit mark a case flaky", async () => {
      // Distinct `time` attributes keep each report's content hash unique so
      // the idempotency check does not collapse the three ingests.
      const pass1 = `<testsuites><testsuite name="Flaky"><testcase classname="flaky.Widget" name="test_toggle" time="0.1"/></testsuite></testsuites>`;
      const fail = `<testsuites><testsuite name="Flaky"><testcase classname="flaky.Widget" name="test_toggle" time="0.2"><failure message="boom">stack</failure></testcase></testsuite></testsuites>`;
      const pass2 = `<testsuites><testsuite name="Flaky"><testcase classname="flaky.Widget" name="test_toggle" time="0.3"/></testsuite></testsuites>`;

      for (const xml of [pass1, fail, pass2]) {
        const res = await request(app)
          .post(`/api/ingest/junit?projectKey=WEB&buildLabel=flaky-build&commitSha=sha-flaky&branch=main&environment=ci&autoCreateCases=true`)
          .set("X-API-Key", apiKey)
          .set("Content-Type", "application/xml")
          .send(xml);
        expect(res.status).toBe(202);
      }

      const flaky = await request(app).get(`/api/projects/${projectId}/flaky`).set("Authorization", `Bearer ${adminToken}`);
      const target = flaky.body.find((f: any) => f.title === "test_toggle");
      expect(target).toBeTruthy();
      expect(target.flakeScore).toBeGreaterThan(0.2);
      expect(target.verdict).toBe("flaky");
    });

    it("16. quarantining a case excludes it from gate pass-rate math", async () => {
      // Quarantine a PASSING case in the main build.
      const runs = await request(app).get(`/api/projects/${projectId}/runs?buildId=${mainBuildId}`).set("Authorization", `Bearer ${adminToken}`);
      const ciRun = runs.body.find((r: any) => r.source === "ci");
      const execs = await request(app).get(`/api/runs/${ciRun.id}/executions`).set("Authorization", `Bearer ${adminToken}`);
      const passed = execs.body.find((e: any) => e.status === "passed");
      const q = await request(app).post(`/api/cases/${passed.testCaseId}/quarantine`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "flaky in CI" });
      expect(q.status).toBe(201);
      expect(q.body.quarantined).toBe(true);
    });

    it("17. traceability returns a matrix with gaps", async () => {
      const res = await request(app).get(`/api/projects/${projectId}/traceability?buildId=${mainBuildId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.matrix).toBeTruthy();
      const gaps = res.body.gaps.map((g: any) => g.ref);
      expect(gaps).toContain("REQ-002");
    });

    it("18. gate evaluation fails with evidence, override -> waived, re-eval deterministic", async () => {
      const release = await request(app).post(`/api/projects/${projectId}/releases`).set("Authorization", `Bearer ${adminToken}`).send({
        name: "Release 2.0.0",
        targetBuildId: mainBuildId,
        gatePolicy: { minPassRate: 0.98, maxOpenCritical: 0 },
      });
      expect(release.status).toBe(201);
      const releaseId = release.body.id;
      await request(app).patch(`/api/releases/${releaseId}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "testing" });

      const evalRes = await request(app).post(`/api/releases/${releaseId}/gate/evaluate`).set("Authorization", `Bearer ${adminToken}`).send({});
      expect(evalRes.status).toBe(200);
      expect(evalRes.body.verdict).toBe("fail");
      expect(evalRes.body.blocking).toContain("minPassRate");
      const firstHash = evalRes.body.policyHash;
      const passRateCriterion = evalRes.body.criteria.find((c: any) => c.key === "minPassRate");
      expect(passRateCriterion.evidence).toHaveProperty("executed");
      expect(passRateCriterion.evidence.quarantinedExcluded).toBeGreaterThanOrEqual(1);

      const override = await request(app).post(`/api/releases/${releaseId}/gate/override`).set("Authorization", `Bearer ${adminToken}`).send({ justification: "known flaky infra, shipping" });
      expect(override.status).toBe(200);
      expect(override.body.verdict).toBe("waived");
      expect(override.body.waivedBy).toBeTruthy();

      const reEval = await request(app).post(`/api/releases/${releaseId}/gate/evaluate`).set("Authorization", `Bearer ${adminToken}`).send({});
      expect(reEval.body.policyHash).toBe(firstHash);
      expect(reEval.body.criteria).toEqual(evalRes.body.criteria);
    });

    it("19. a second organization's user gets 404 for everything", async () => {
      const reg = await request(app).post("/api/auth/register").send({
        email: "other@corp.io",
        password: "password-123",
        fullName: "Other",
        organizationName: "Other Corp",
      });
      expect(reg.status).toBe(201);
      const otherToken = reg.body.accessToken;

      expect((await request(app).get("/api/projects").set("Authorization", `Bearer ${otherToken}`)).body).toEqual([]);

      for (const path of [
        `/api/projects/${projectId}`,
        `/api/cases/${caseIds[0]}`,
        `/api/runs/${runId}`,
        `/api/projects/${projectId}/requirements`,
      ]) {
        const res = await request(app).get(path).set("Authorization", `Bearer ${otherToken}`);
        expect(res.status).toBe(404);
      }
    });
  });
});
